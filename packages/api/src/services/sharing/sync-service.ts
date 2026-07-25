/**
 * Live Sync Service (Sprint SH-3)
 *
 * Manages the three slice states:
 *   'shared' — static snapshot (default from SH-2)
 *   'live'   — auto-sync channel; updates push through privacy filters
 *   'paused' — temporarily suspended (schema-defined, behaviour TBD)
 *
 * Revoked slices are already handled in SH-2 and cannot be synced.
 *
 * State transitions:
 *   shared → live     — sharer approves (requires valid session token)
 *   live → shared     — either party, unilateral
 *   shared|live → revoked — sharer only (via SH-2 revokeSlice)
 *
 * Sync flow (syncLiveSlice):
 *   1. Load slice + guards (exists, not revoked, status=live)
 *   2. IX-10 check: is the sharer's index in a live state?
 *   3. Query index_records added since lastSyncedAt within scope
 *   4. Apply privacy filters per record
 *   5. Append new content to slice (with `--- sync vN ---` separator)
 *   6. Bump syncVersion, update lastSyncedAt, merge metadata
 *   7. Log content_sync event with full audit details
 */

import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { db } from '../../db/index'
import { indexRecords } from '../../db/schema/semantic-index'
import { sharedSlices, sliceSyncEvents } from '../../db/schema/sharing'
import { applyPrivacyFilters } from './privacy-filter'

// ─── Upgrade / Downgrade ─────────────────────────────────────────────────────

/**
 * Upgrade a shared slice from `shared` to `live`.
 * Only the sharer (fromUserId) can approve, and their session must be
 * unlocked (passcode validated via SH-1 `validateSession`).
 */
export async function upgradeToLive(params: {
  sliceId: string
  approvedByUserId: string
  sessionToken: string
}): Promise<{ success: boolean; reason?: string }> {
  // Validate sharer's session (SH-1 passcode lock)
  const { validateSession } = await import('./passcode')
  const valid = await validateSession({
    userId: params.approvedByUserId,
    sessionToken: params.sessionToken,
  })
  if (!valid) return { success: false, reason: 'Session invalid or index locked' }

  const rows = await db
    .select()
    .from(sharedSlices)
    .where(eq(sharedSlices.id, params.sliceId))
    .limit(1)

  const slice = rows[0]
  if (!slice) return { success: false, reason: 'Slice not found' }
  if (slice.fromUserId !== params.approvedByUserId) {
    return { success: false, reason: 'Only the sharer can approve live sync' }
  }
  if (slice.revokedAt) return { success: false, reason: 'Slice is revoked' }
  if (slice.syncStatus === 'live') return { success: false, reason: 'Already live' }

  await db
    .update(sharedSlices)
    .set({ syncStatus: 'live' })
    .where(eq(sharedSlices.id, params.sliceId))

  await db.insert(sliceSyncEvents).values({
    sliceId: params.sliceId,
    eventType: 'upgrade_to_live',
    triggeredBy: 'user_from',
  })

  return { success: true }
}

/**
 * Downgrade from `live` to `shared`. Either party (sharer or recipient)
 * can do this unilaterally — no session token required because downgrade
 * only STOPS the flow, it doesn't open a new channel.
 */
export async function downgradeToShared(params: {
  sliceId: string
  userId: string
}): Promise<{ success: boolean; reason?: string }> {
  const rows = await db
    .select()
    .from(sharedSlices)
    .where(eq(sharedSlices.id, params.sliceId))
    .limit(1)

  const slice = rows[0]
  if (!slice) return { success: false, reason: 'Slice not found' }
  if (slice.fromUserId !== params.userId && slice.toUserId !== params.userId) {
    return { success: false, reason: 'Not a party to this slice' }
  }

  await db
    .update(sharedSlices)
    .set({ syncStatus: 'shared' })
    .where(eq(sharedSlices.id, params.sliceId))

  const triggeredBy: 'user_from' | 'user_to' =
    slice.fromUserId === params.userId ? 'user_from' : 'user_to'

  await db.insert(sliceSyncEvents).values({
    sliceId: params.sliceId,
    eventType: 'downgrade_to_shared',
    triggeredBy,
  })

  return { success: true }
}

// ─── Sync Execution ──────────────────────────────────────────────────────────

export interface SyncResult {
  synced: boolean
  reason: string
  newVersion?: number
}

/**
 * Sync a live slice — rebuild its content from the sharer's current
 * index, append new items since lastSyncedAt, bump syncVersion.
 *
 * Called by:
 *   - `triggerSyncForNewRecords` (indexer hook, event-driven)
 *   - `sync-scheduler` periodic pass (catch-up for missed events)
 *   - Manual `POST /api/sharing/slices/:id/sync` (testing / explicit refresh)
 */
export async function syncLiveSlice(sliceId: string): Promise<SyncResult> {
  // 1. Load slice + guards
  const rows = await db
    .select()
    .from(sharedSlices)
    .where(eq(sharedSlices.id, sliceId))
    .limit(1)

  const slice = rows[0]
  if (!slice) return { synced: false, reason: 'not found' }
  if (slice.revokedAt) return { synced: false, reason: 'revoked' }
  if (slice.syncStatus !== 'live') return { synced: false, reason: 'not live' }

  // 2. IX-10 heuristic: was the most recent state capture live or static?
  // Proper user-level live/static toggle comes in a future sprint; for now
  // we expose this as a metadata flag on the sync event.
  let indexIsLive = true
  try {
    const { indexRecordStates } = await import('../../db/schema/semantic-index')
    const recent = await db
      .select({ stateType: indexRecordStates.stateType })
      .from(indexRecordStates)
      .where(eq(indexRecordStates.capturedBy, 'indexer'))
      .orderBy(desc(indexRecordStates.capturedAt))
      .limit(1)
    if (recent[0]?.stateType === 'static') indexIsLive = false
  } catch {
    // IX-10 table missing or query failed — default to live
  }

  // 3. Find new index records in scope since lastSyncedAt
  const conditions = [
    eq(indexRecords.workspaceId, slice.workspaceId),
    eq(indexRecords.userId, slice.fromUserId),
    gt(indexRecords.indexedAt, slice.lastSyncedAt),
  ]
  if (slice.scopeType === 'document' && slice.scopeRefId) {
    conditions.push(eq(indexRecords.sourceFileId, slice.scopeRefId))
  }
  // 'topic' scope: no efficient filter — fetch recent records and rely on
  //   privacy-filter to drop irrelevant ones. A future iteration could add
  //   ilike on embeddingText if topic strings are stored on the slice.
  // 'temporal' scope: new records are by definition recent — fetch all.

  const newRecords = await db
    .select()
    .from(indexRecords)
    .where(and(...conditions))
    .orderBy(desc(indexRecords.indexedAt))
    .limit(30)

  if (newRecords.length === 0) {
    return { synced: false, reason: 'no new records in scope' }
  }

  // 4. Apply privacy filters per record
  interface FilteredSyncItem {
    content: string
    citation: {
      sourceFileId?: string | null
      sourceVersion?: number | null
      sourceContentHash?: string | null
      timestamp?: string
      label: string
    }
  }
  const filteredItems: FilteredSyncItem[] = []
  let totalRedactions = 0

  for (const r of newRecords) {
    const filtered = await applyPrivacyFilters({
      userId: slice.fromUserId,
      workspaceId: slice.workspaceId,
      content: {
        text: r.embeddingText ?? '',
        sourceType: r.threadType ?? 'index',
        topic: r.sectionAlias ?? undefined,
        timestamp: r.indexedAt ?? undefined,
      },
      documentId: slice.scopeRefId ?? undefined,
    })

    if (filtered.text === '') continue // fully excluded

    totalRedactions += filtered.redactionCount
    filteredItems.push({
      content: filtered.text,
      citation: {
        sourceFileId: r.sourceFileId,
        sourceVersion: r.sourceVersion,
        sourceContentHash: r.sourceContentHash,
        timestamp: r.indexedAt?.toISOString?.(),
        label:
          r.sourceVersion != null
            ? `Index record (source v${r.sourceVersion})`
            : `Index record (${r.indexedAt?.toISOString?.()?.substring(0, 10) ?? '?'})`,
      },
    })
  }

  if (filteredItems.length === 0) {
    return { synced: false, reason: 'new records filtered out by privacy rules' }
  }

  // 5. Rebuild slice content (append new items with version separator)
  const newVersion = slice.syncVersion + 1
  const existingContent = slice.sliceContent ?? ''
  const appended = filteredItems
    .map((item) => `[${item.citation.label}]\n${item.content}`)
    .join('\n\n')
  const updatedContent =
    existingContent + '\n\n--- sync v' + newVersion + ' ---\n\n' + appended

  // 6. Merge metadata (accumulate sources + counts)
  const existingMeta = (slice.sliceMetadata ?? {}) as Record<string, unknown>
  const existingSources = Array.isArray(existingMeta.sources)
    ? (existingMeta.sources as unknown[])
    : []
  const newSources = filteredItems.map((item) => item.citation)
  const updatedMetadata: Record<string, unknown> = {
    ...existingMeta,
    sources: [...existingSources, ...newSources],
    redactionCount:
      ((existingMeta.redactionCount as number | undefined) ?? 0) + totalRedactions,
    itemCount: ((existingMeta.itemCount as number | undefined) ?? 0) + filteredItems.length,
    lastSyncReason: `${filteredItems.length} new records`,
  }

  // 7. Update the slice
  await db
    .update(sharedSlices)
    .set({
      sliceContent: updatedContent,
      sliceMetadata: updatedMetadata,
      lastSyncedAt: new Date(),
      syncVersion: newVersion,
      redactionCount: (slice.redactionCount ?? 0) + totalRedactions,
    })
    .where(eq(sharedSlices.id, sliceId))

  // 8. Log the sync event
  await db.insert(sliceSyncEvents).values({
    sliceId,
    eventType: 'content_sync',
    triggeredBy: 'indexer',
    previousVersion: slice.syncVersion,
    newVersion,
    itemsChanged: filteredItems.length,
    redactionCount: totalRedactions,
    indexStateLive: indexIsLive,
  })

  return { synced: true, reason: `${filteredItems.length} items synced`, newVersion }
}

// ─── Listing Helpers ─────────────────────────────────────────────────────────

/**
 * Find all live, non-revoked slices — the scheduler's work queue.
 */
export async function getLiveSlicesForSync() {
  return db
    .select({
      id: sharedSlices.id,
      fromUserId: sharedSlices.fromUserId,
      workspaceId: sharedSlices.workspaceId,
      scopeType: sharedSlices.scopeType,
      scopeRefId: sharedSlices.scopeRefId,
      lastSyncedAt: sharedSlices.lastSyncedAt,
    })
    .from(sharedSlices)
    .where(and(eq(sharedSlices.syncStatus, 'live'), isNull(sharedSlices.revokedAt)))
}

/**
 * Get the sync event history for a slice (audit / debug).
 */
export async function getSyncEvents(sliceId: string) {
  return db
    .select()
    .from(sliceSyncEvents)
    .where(eq(sliceSyncEvents.sliceId, sliceId))
    .orderBy(desc(sliceSyncEvents.createdAt))
}
