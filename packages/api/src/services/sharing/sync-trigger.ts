/**
 * Sync Trigger (Sprint SH-3)
 *
 * The event-driven half of the live-sync system. The indexer calls
 * `triggerSyncForNewRecords` fire-and-forget after each batch insert;
 * we look up any live slices from that user in that workspace and
 * fan-out a `syncLiveSlice` call for every slice whose scope overlaps
 * the newly indexed documents.
 *
 * The periodic scheduler (`sync-scheduler.ts`) is the catch-up path —
 * this trigger is the fast path.
 */

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db/index'
import { sharedSlices } from '../../db/schema/sharing'
import { syncLiveSlice } from './sync-service'

interface TriggerInput {
  workspaceId: string
  userId: string
  documentIds: Array<string | null | undefined>
}

/**
 * Find live slices from this user that might be affected by the new
 * records and sync them. Non-throwing per sprint guidance (indexer
 * calls this fire-and-forget).
 */
export async function triggerSyncForNewRecords(input: TriggerInput): Promise<void> {
  try {
    const slices = await db
      .select({
        id: sharedSlices.id,
        scopeType: sharedSlices.scopeType,
        scopeRefId: sharedSlices.scopeRefId,
      })
      .from(sharedSlices)
      .where(
        and(
          eq(sharedSlices.fromUserId, input.userId),
          eq(sharedSlices.workspaceId, input.workspaceId),
          eq(sharedSlices.syncStatus, 'live'),
          isNull(sharedSlices.revokedAt)
        )
      )

    if (slices.length === 0) return

    const documentIds = input.documentIds.filter(
      (d): d is string => typeof d === 'string' && d.length > 0
    )

    for (const slice of slices) {
      if (!isInScope(slice, documentIds)) continue
      try {
        await syncLiveSlice(slice.id)
      } catch (err) {
        console.warn(`[SyncTrigger] Slice ${slice.id} sync failed:`, err)
      }
    }
  } catch (err) {
    console.warn('[SyncTrigger] Scan failed (non-fatal):', err)
  }
}

/**
 * Check if newly indexed documents fall within a slice's scope.
 * - document scope: requires a matching documentId
 * - topic scope:    always sync (need to read content to know)
 * - temporal scope: always sync (new records are definitionally recent)
 */
export function isInScope(
  slice: { scopeType: string; scopeRefId: string | null },
  documentIds: string[]
): boolean {
  if (slice.scopeType === 'document') {
    return slice.scopeRefId != null && documentIds.includes(slice.scopeRefId)
  }
  if (slice.scopeType === 'topic') return true
  if (slice.scopeType === 'temporal') return true
  return false
}
