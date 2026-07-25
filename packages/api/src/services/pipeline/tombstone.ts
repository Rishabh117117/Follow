/**
 * Tombstone Helper (2026-04-29)
 *
 * Soft-deletes an index_records row + its derived rows in one transaction,
 * writes a hash-chained evidence_records audit entry, and decrements the
 * episode counter. Hard delete only happens later via the GC scheduler.
 *
 * Why tombstones (per v5.2 §06):
 *   - Ground truth never mutates — supersession over delete
 *   - Provenance survives deletion: every removal leaves an audit trail
 *   - Reversible within the retention window (default 30 days)
 *   - Pipeline reads filter `deleted_at IS NULL`; GC drops rows past retention
 *
 * What it does NOT do:
 *   - Touch raw_files: that's a separate operation (the file may have other
 *     records pointing at it)
 *   - Update user_patterns.supportingRecordIds: stale UUIDs are validated
 *     and dropped on the Profiler's next run; explicit cleanup is GC's job
 *   - Touch llm_usage: cost/call history is preserved unconditionally
 */

import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../db/index'
import {
  indexRecords,
  semanticLinks,
  indexRecordStates,
  evidenceRecords,
  episodes,
} from '../../db/schema/semantic-index'
import { computeRecordHash, getLastEvidenceHash } from '../semantic-index/hash-chain'

export type DeletionReason = 'user' | 'gdpr' | 'expiry' | 'cascade'
export type DeletionScope = 'record' | 'source' | 'episode'

export interface TombstoneInput {
  recordId: string
  /** Who performed the action — for the audit row + the deleted_by column. */
  deletedBy: string
  /** Defaults to 'user'. */
  reason?: DeletionReason
  /** Defaults to 'record' (just this row, not its siblings). */
  scope?: DeletionScope
  /** Optional context that ends up in evidence_records.metadata. */
  context?: Record<string, unknown>
}

export interface TombstoneResult {
  recordId: string
  alreadyTombstoned: boolean
  edgesTombstoned: number
  stateRowsTombstoned: number
  evidenceId: string | null
  episodeId: string | null
}

/**
 * Tombstone one index_records row.
 *
 *   1. UPDATE index_records SET deleted_at, deleted_by, deletion_reason, deletion_scope
 *   2. UPDATE semantic_links SET deleted_at WHERE source = id OR target = id
 *   3. UPDATE index_record_states SET deleted_at WHERE index_record_id = id
 *   4. INSERT evidence_records (hash-chained, evidence_type='user_redaction')
 *   5. UPDATE episodes.record_count = record_count - 1 WHERE id = record.episodeId
 *
 * Idempotent: re-running on an already-tombstoned record is a no-op (returns
 * `alreadyTombstoned: true`). The audit row is only written on the first call.
 */
export async function tombstoneRecord(input: TombstoneInput): Promise<TombstoneResult> {
  const reason: DeletionReason = input.reason ?? 'user'
  const scope: DeletionScope = input.scope ?? 'record'

  // Fetch the record so we have the documentId for hash chaining + the
  // episodeId for counter decrement. Skip if it's already tombstoned.
  const [record] = await db
    .select({
      id: indexRecords.id,
      workspaceId: indexRecords.workspaceId,
      userId: indexRecords.userId,
      documentId: indexRecords.documentId,
      episodeId: indexRecords.episodeId,
      embeddingText: indexRecords.embeddingText,
      deletedAt: indexRecords.deletedAt,
    })
    .from(indexRecords)
    .where(eq(indexRecords.id, input.recordId))
    .limit(1)

  if (!record) {
    return {
      recordId: input.recordId,
      alreadyTombstoned: false,
      edgesTombstoned: 0,
      stateRowsTombstoned: 0,
      evidenceId: null,
      episodeId: null,
    }
  }
  if (record.deletedAt) {
    return {
      recordId: record.id,
      alreadyTombstoned: true,
      edgesTombstoned: 0,
      stateRowsTombstoned: 0,
      evidenceId: null,
      episodeId: record.episodeId,
    }
  }

  const now = new Date()

  // Hash-chain audit row. Capture `contentBefore` so a reader can see what
  // was tombstoned without touching the live data layer.
  const prevHash = await getLastEvidenceHash(record.documentId)
  const recordHash = computeRecordHash(
    {
      contentBefore: record.embeddingText,
      contentAfter: null,
      userId: input.deletedBy,
      timestamp: now.toISOString(),
    },
    prevHash
  )

  // One transaction so the audit row + the four UPDATEs land atomically.
  const result = await db.transaction(async (tx) => {
    // 1. The record itself.
    await tx
      .update(indexRecords)
      .set({
        deletedAt: now,
        deletedBy: input.deletedBy,
        deletionReason: reason,
        deletionScope: scope,
      })
      .where(and(eq(indexRecords.id, record.id), isNull(indexRecords.deletedAt)))

    // 2. Adjacent edges (both directions).
    const edgeUpdate = await tx
      .update(semanticLinks)
      .set({ deletedAt: now, deletedBy: input.deletedBy, deletionReason: reason })
      .where(
        and(
          or(
            eq(semanticLinks.sourceRecordId, record.id),
            eq(semanticLinks.targetRecordId, record.id)
          ),
          isNull(semanticLinks.deletedAt)
        )
      )
      .returning({ id: semanticLinks.id })

    // 3. Live state rows (the supersession chain stays queryable for audit).
    const stateUpdate = await tx
      .update(indexRecordStates)
      .set({ deletedAt: now, deletedBy: input.deletedBy, deletionReason: reason })
      .where(
        and(
          eq(indexRecordStates.indexRecordId, record.id),
          isNull(indexRecordStates.deletedAt)
        )
      )
      .returning({ id: indexRecordStates.id })

    // 4. Hash-chained evidence row.
    const [evidence] = await tx
      .insert(evidenceRecords)
      .values({
        workspaceId: record.workspaceId,
        indexRecordId: record.id,
        documentId: record.documentId,
        userId: input.deletedBy,
        evidenceType:
          reason === 'gdpr' ? 'gdpr_redact' : reason === 'expiry' ? 'expiry' : 'user_redaction',
        contentBefore: record.embeddingText,
        contentAfter: null,
        hashChainPrev: prevHash,
        recordHash,
        ownershipTier: 'user',
        retentionPolicy: reason === 'gdpr' ? 'redacted' : 'recoverable_30d',
      })
      .returning({ id: evidenceRecords.id })

    // 5. Episode counter (avoid going negative on drift).
    if (record.episodeId) {
      await tx
        .update(episodes)
        .set({
          recordCount: sql`GREATEST(${episodes.recordCount} - 1, 0)`,
          updatedAt: now,
        })
        .where(eq(episodes.id, record.episodeId))
    }

    return {
      edgesTombstoned: edgeUpdate.length,
      stateRowsTombstoned: stateUpdate.length,
      evidenceId: evidence?.id ?? null,
    }
  })

  return {
    recordId: record.id,
    alreadyTombstoned: false,
    edgesTombstoned: result.edgesTombstoned,
    stateRowsTombstoned: result.stateRowsTombstoned,
    evidenceId: result.evidenceId,
    episodeId: record.episodeId,
  }
}

/**
 * Tombstone every record whose source_file_id matches the given source.
 * This is the "delete whole document" operation — opt-in, NOT the default
 * for a single-record delete.
 */
export async function tombstoneSource(input: {
  sourceFileId: string
  deletedBy: string
  reason?: DeletionReason
  context?: Record<string, unknown>
}): Promise<TombstoneResult[]> {
  const reason = input.reason ?? 'user'
  const siblings = await db
    .select({ id: indexRecords.id })
    .from(indexRecords)
    .where(
      and(
        eq(indexRecords.sourceFileId, input.sourceFileId),
        isNull(indexRecords.deletedAt)
      )
    )
  const results: TombstoneResult[] = []
  for (const s of siblings) {
    results.push(
      await tombstoneRecord({
        recordId: s.id,
        deletedBy: input.deletedBy,
        reason,
        scope: 'source',
        context: input.context,
      })
    )
  }
  return results
}

/**
 * Restore a tombstoned record. Clears deleted_at on the record + its
 * derived rows. Does NOT remove the evidence_records audit row — that's
 * the immutable trail.
 *
 * Returns false if the record can't be restored (already hard-deleted,
 * or not tombstoned in the first place).
 */
export async function restoreRecord(recordId: string): Promise<boolean> {
  const [record] = await db
    .select({ id: indexRecords.id, deletedAt: indexRecords.deletedAt })
    .from(indexRecords)
    .where(eq(indexRecords.id, recordId))
    .limit(1)
  if (!record || !record.deletedAt) return false

  await db.transaction(async (tx) => {
    await tx
      .update(indexRecords)
      .set({ deletedAt: null, deletedBy: null, deletionReason: null, deletionScope: null })
      .where(eq(indexRecords.id, recordId))
    await tx
      .update(semanticLinks)
      .set({ deletedAt: null, deletedBy: null, deletionReason: null })
      .where(
        or(
          eq(semanticLinks.sourceRecordId, recordId),
          eq(semanticLinks.targetRecordId, recordId)
        )
      )
    await tx
      .update(indexRecordStates)
      .set({ deletedAt: null, deletedBy: null, deletionReason: null })
      .where(eq(indexRecordStates.indexRecordId, recordId))
  })
  return true
}
