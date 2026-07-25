/**
 * Index Record State Capture Service (Sprint IX-10)
 *
 * Decouples mutable index state from frozen audit snapshots.
 *
 *   live   — current mutable view; new ones supersede the prior live row
 *            (linked via `supersededBy`). Captured by indexer + engagement updater.
 *   static — frozen audit snapshot, never modified. Captured when evidence
 *            is created or a slice is shared (the "what did the AI know
 *            when this happened?" record).
 *
 * Hash-based dedup: capturing identical state is a no-op. The hash covers
 * every field that affects retrieval/citation, including a digest of the
 * embedding text so content changes are detected.
 *
 * **All capture calls are non-throwing.** Indexing, engagement updates, and
 * evidence capture must NEVER fail because of a state capture error. Callers
 * use this service fire-and-forget.
 */

import { createHash } from 'crypto'
import { and, desc, eq, lte } from 'drizzle-orm'
import { db } from '../../db/index'
import { indexRecords, indexRecordStates } from '../../db/schema/semantic-index'

// ─── Types ───────────────────────────────────────────────────────────────────

export type IndexRecordStateType = 'live' | 'static'
export type StateCapturedBy = 'indexer' | 'reference_agent' | 'manual' | 'share_event'

export interface CaptureStateOptions {
  indexRecordId: string
  stateType: IndexRecordStateType
  capturedBy: StateCapturedBy
  captureReason?: string
}

export interface CaptureStateResult {
  id: string
  stateHash: string
  isNew: boolean
}

// ─── Capture ─────────────────────────────────────────────────────────────────

/**
 * Capture a state snapshot of an index_record.
 * Returns the snapshot row id + hash, or `null` on any error (non-throwing).
 */
export async function captureIndexRecordState(
  options: CaptureStateOptions
): Promise<CaptureStateResult | null> {
  try {
    // 1. Fetch current state of the index_record
    const records = await db
      .select()
      .from(indexRecords)
      .where(eq(indexRecords.id, options.indexRecordId))
      .limit(1)

    const record = records[0]
    if (!record) {
      console.warn(`[StateCapture] Index record ${options.indexRecordId} not found`)
      return null
    }

    // 2. Serialize relevant fields for hashing
    const stateForHash = {
      engagementDepth: record.engagementDepth,
      isKeyChange: record.isKeyChange,
      hasEvidence: record.hasEvidence,
      documentId: record.documentId,
      documentTitle: record.documentTitle,
      sectionAlias: record.sectionAlias,
      sourceFileId: record.sourceFileId,
      sourceVersion: record.sourceVersion,
      sourceContentHash: record.sourceContentHash,
      // Embedding text digest so content changes flip the hash
      embeddingTextHash: record.embeddingText
        ? createHash('sha256').update(record.embeddingText).digest('hex').substring(0, 16)
        : null,
    }
    const stateHash = createHash('sha256').update(JSON.stringify(stateForHash)).digest('hex')

    // 3. Dedup: identical-hash state of the same type already exists?
    const existing = await db
      .select({ id: indexRecordStates.id })
      .from(indexRecordStates)
      .where(
        and(
          eq(indexRecordStates.indexRecordId, options.indexRecordId),
          eq(indexRecordStates.stateHash, stateHash),
          eq(indexRecordStates.stateType, options.stateType)
        )
      )
      .limit(1)

    if (existing[0]) {
      return { id: existing[0].id, stateHash, isNew: false }
    }

    // 4. If new live state, find prior live to supersede
    let previousLiveId: string | null = null
    if (options.stateType === 'live') {
      const prior = await db
        .select({ id: indexRecordStates.id })
        .from(indexRecordStates)
        .where(
          and(
            eq(indexRecordStates.indexRecordId, options.indexRecordId),
            eq(indexRecordStates.stateType, 'live')
          )
        )
        .orderBy(desc(indexRecordStates.capturedAt))
        .limit(1)
      if (prior[0]) previousLiveId = prior[0].id
    }

    // 5. Insert the new state
    const inserted = await db
      .insert(indexRecordStates)
      .values({
        indexRecordId: options.indexRecordId,
        stateType: options.stateType,
        stateHash,
        engagementDepth: record.engagementDepth ?? null,
        isKeyChange: record.isKeyChange ?? null,
        hasEvidence: record.hasEvidence ?? null,
        documentId: record.documentId ?? null,
        documentTitle: record.documentTitle ?? null,
        sectionAlias: record.sectionAlias ?? null,
        embeddingText: record.embeddingText ?? null,
        metadata: (record.metadata ?? null) as Record<string, unknown> | null,
        sourceFileId: record.sourceFileId ?? null,
        sourceVersion: record.sourceVersion ?? null,
        sourceContentHash: record.sourceContentHash ?? null,
        capturedBy: options.capturedBy,
        captureReason: options.captureReason ?? null,
      })
      .returning({ id: indexRecordStates.id })

    const newId = inserted[0]!.id

    // 6. Link the prior live state to the new one (chain)
    if (previousLiveId) {
      await db
        .update(indexRecordStates)
        .set({ supersededBy: newId })
        .where(eq(indexRecordStates.id, previousLiveId))
    }

    return { id: newId, stateHash, isNew: true }
  } catch (err) {
    console.warn('[StateCapture] Failed (non-fatal):', err)
    return null
  }
}

// ─── Retrieval Helpers ───────────────────────────────────────────────────────

/**
 * Get the state of an index_record at a specific point in time.
 * Returns the nearest captured state (any type) at or before the timestamp.
 */
export async function getStateAtTimestamp(
  indexRecordId: string,
  timestamp: Date
): Promise<typeof indexRecordStates.$inferSelect | null> {
  const rows = await db
    .select()
    .from(indexRecordStates)
    .where(
      and(
        eq(indexRecordStates.indexRecordId, indexRecordId),
        lte(indexRecordStates.capturedAt, timestamp)
      )
    )
    .orderBy(desc(indexRecordStates.capturedAt))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Get the current (latest) live state of an index_record.
 */
export async function getCurrentLiveState(
  indexRecordId: string
): Promise<typeof indexRecordStates.$inferSelect | null> {
  const rows = await db
    .select()
    .from(indexRecordStates)
    .where(
      and(
        eq(indexRecordStates.indexRecordId, indexRecordId),
        eq(indexRecordStates.stateType, 'live')
      )
    )
    .orderBy(desc(indexRecordStates.capturedAt))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Get all static states for an index_record (full audit trail, newest first).
 */
export async function getStaticStates(
  indexRecordId: string
): Promise<Array<typeof indexRecordStates.$inferSelect>> {
  return db
    .select()
    .from(indexRecordStates)
    .where(
      and(
        eq(indexRecordStates.indexRecordId, indexRecordId),
        eq(indexRecordStates.stateType, 'static')
      )
    )
    .orderBy(desc(indexRecordStates.capturedAt))
}

/**
 * Batch capture: create initial live states for multiple records.
 * Used by the indexer after bulk insert. Sequential to avoid hammering the DB.
 */
export async function batchCaptureInitialStates(
  recordIds: string[],
  capturedBy: StateCapturedBy = 'indexer'
): Promise<void> {
  for (const id of recordIds) {
    await captureIndexRecordState({
      indexRecordId: id,
      stateType: 'live',
      capturedBy,
      captureReason: 'initial index',
    })
  }
}
