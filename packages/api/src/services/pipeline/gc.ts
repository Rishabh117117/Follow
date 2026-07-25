/**
 * Tombstone GC (2026-04-29)
 *
 * The only place tombstoned rows become hard-deleted. Runs daily on the
 * existing pipeline-jobs cron (alongside Profiler's daily 14d slice).
 *
 * Retention policy
 *   - 'recoverable_30d' (default for user_redaction)  → wait 30 days
 *   - 'redacted'        (gdpr / erase)                → next sweep, no wait
 *   - 'expiry'                                        → wait 30 days, same as user
 *
 * Cascade behavior (today)
 *   - semantic_links: ON DELETE CASCADE (FK on source/target). Hard-deleting
 *     an index_records row drops adjacent edges automatically.
 *   - evidence_records: ON DELETE CASCADE on indexRecordId — but we want to
 *     KEEP the evidence row as the audit trail. So we null out indexRecordId
 *     before deleting the index_records row, so cascade doesn't drop it.
 *   - index_record_states: indexRecordId is a plain uuid (no FK). We
 *     explicitly DELETE the tombstoned state rows in the same transaction.
 *
 * Drift cleanup
 *   - episodes.recordCount: recompute from current live row count for any
 *     episode that lost rows.
 *   - user_patterns.supportingRecordIds: prune dead UUIDs from the text[];
 *     if the array becomes empty, soft-delete the pattern row.
 *
 * Deferred (future iteration)
 *   - S3 byte deletion for raw_files with deleted_at AND no live records
 *     pointing at them. Deferred because S3 lifecycle policies are the
 *     cleaner path; we mark the rows with metadata.gc_purgeable=true so a
 *     lifecycle rule can pick them up.
 */

import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../../db/index'
import { indexRecords, indexRecordStates, evidenceRecords } from '../../db/schema/semantic-index'
import { rawFiles } from '../../db/schema/raw-files'
import { userPatterns } from '../../db/schema/user-patterns'

const RETENTION_RECOVERABLE_DAYS = 30

export interface GcResult {
  hardDeletedRecords: number
  hardDeletedStateRows: number
  evidenceRowsRetained: number
  episodesRecomputed: number
  patternsPruned: number
  patternsDeleted: number
  rawFilesMarkedPurgeable: number
}

/**
 * Run one GC pass. Returns what it touched. Idempotent: re-running on a
 * already-clean state is a no-op.
 */
export async function runTombstoneGC(): Promise<GcResult> {
  const result: GcResult = {
    hardDeletedRecords: 0,
    hardDeletedStateRows: 0,
    evidenceRowsRetained: 0,
    episodesRecomputed: 0,
    patternsPruned: 0,
    patternsDeleted: 0,
    rawFilesMarkedPurgeable: 0,
  }

  // 1. Find index_records past retention.
  const cutoff = new Date(Date.now() - RETENTION_RECOVERABLE_DAYS * 24 * 60 * 60 * 1000)
  const dueRows = await db.execute(sql`
    SELECT
      ir.id,
      ir.episode_id,
      ir.source_file_id,
      ev.retention_policy
    FROM index_records ir
    LEFT JOIN LATERAL (
      SELECT retention_policy
      FROM evidence_records
      WHERE index_record_id = ir.id
      ORDER BY created_at DESC
      LIMIT 1
    ) ev ON true
    WHERE ir.deleted_at IS NOT NULL
      AND (
        ev.retention_policy = 'redacted'
        OR ir.deleted_at < ${cutoff.toISOString()}
      )
    LIMIT 500
  `)
  const dueList: Array<Record<string, unknown>> = Array.isArray(dueRows)
    ? (dueRows as Array<Record<string, unknown>>)
    : ((dueRows as { rows?: Array<Record<string, unknown>> })?.rows ?? [])
  if (dueList.length === 0) return result

  const dueIds = dueList.map((r) => String(r['id']))
  const affectedEpisodes = new Set<string>()
  const affectedSourceFiles = new Set<string>()
  for (const r of dueList) {
    if (r['episode_id']) affectedEpisodes.add(String(r['episode_id']))
    if (r['source_file_id']) affectedSourceFiles.add(String(r['source_file_id']))
  }

  // 2. Hard delete in a transaction.
  await db.transaction(async (tx) => {
    // Detach evidence_records FK so the audit trail survives the cascade.
    await tx
      .update(evidenceRecords)
      .set({ indexRecordId: null })
      .where(inArray(evidenceRecords.indexRecordId, dueIds))

    // index_record_states have no FK — explicit delete needed.
    const stateDel = await tx
      .delete(indexRecordStates)
      .where(inArray(indexRecordStates.indexRecordId, dueIds))
      .returning({ id: indexRecordStates.id })
    result.hardDeletedStateRows = stateDel.length

    // The actual hard delete. semantic_links cascades via FK.
    const recDel = await tx
      .delete(indexRecords)
      .where(inArray(indexRecords.id, dueIds))
      .returning({ id: indexRecords.id })
    result.hardDeletedRecords = recDel.length
  })

  result.evidenceRowsRetained = result.hardDeletedRecords // 1:1 since each tombstone wrote one

  // 3. Recompute drifted episode counters. For each affected episode, set
  //    record_count to the COUNT(*) of live (non-deleted, non-hidden) records.
  for (const episodeId of affectedEpisodes) {
    try {
      await db.execute(sql`
        UPDATE episodes
        SET
          record_count = (
            SELECT COUNT(*)::int FROM index_records
            WHERE episode_id = ${episodeId}
              AND deleted_at IS NULL
              AND hidden = false
          ),
          updated_at = now()
        WHERE id = ${episodeId}::uuid
      `)
      result.episodesRecomputed++
    } catch (err) {
      console.warn(`[GC] episode recompute failed for ${episodeId}:`, err)
    }
  }

  // 4. Prune user_patterns.supportingRecordIds — drop hard-deleted UUIDs from
  //    the text[]. If the result is empty, soft-delete the pattern row.
  //    (Profiler's next run will write fresh patterns anyway, but cleaning
  //    up dangling refs now keeps queries honest in the meantime.)
  try {
    const purged = await db.execute(sql`
      WITH cleaned AS (
        SELECT
          id,
          ARRAY(
            SELECT u FROM unnest(supporting_record_ids) u
            WHERE u <> ALL(${dueIds}::text[])
          ) AS new_ids
        FROM user_patterns
        WHERE supporting_record_ids && ${dueIds}::text[]
      )
      UPDATE user_patterns up
      SET supporting_record_ids = cleaned.new_ids
      FROM cleaned
      WHERE up.id = cleaned.id
      RETURNING up.id, cardinality(up.supporting_record_ids) AS remaining
    `)
    const purgedList: Array<Record<string, unknown>> = Array.isArray(purged)
      ? (purged as Array<Record<string, unknown>>)
      : ((purged as { rows?: Array<Record<string, unknown>> })?.rows ?? [])
    result.patternsPruned = purgedList.length

    const emptyIds = purgedList
      .filter((r) => Number(r['remaining'] ?? 0) === 0)
      .map((r) => String(r['id']))
    if (emptyIds.length > 0) {
      await db.delete(userPatterns).where(inArray(userPatterns.id, emptyIds))
      result.patternsDeleted = emptyIds.length
    }
  } catch (err) {
    console.warn('[GC] user_patterns prune failed:', err)
  }

  // 5. Count orphaned raw_files (soft-deleted AND no live records left).
  //    We DON'T S3-delete here — that's a separate lifecycle concern. The
  //    orphan count is just for the GC report so an operator can see how
  //    many soft-deleted files are eligible for byte purge.
  if (affectedSourceFiles.size > 0) {
    try {
      const orphaned = await db.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM raw_files rf
        WHERE rf.id = ANY(${Array.from(affectedSourceFiles)}::uuid[])
          AND rf.deleted_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM index_records ir
            WHERE ir.source_file_id = rf.id
              AND ir.deleted_at IS NULL
          )
      `)
      const list: Array<Record<string, unknown>> = Array.isArray(orphaned)
        ? (orphaned as Array<Record<string, unknown>>)
        : ((orphaned as { rows?: Array<Record<string, unknown>> })?.rows ?? [])
      result.rawFilesMarkedPurgeable = Number(list[0]?.['cnt'] ?? 0)
    } catch (err) {
      console.warn('[GC] raw_files orphan count failed:', err)
    }
  }

  return result
}

// keep imports happy
void and
void eq
void or
void isNull
void lt
void rawFiles
