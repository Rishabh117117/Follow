/**
 * Live Context Activation (Sprint SCOPE-LIVECTX-1)
 *
 * When a user opts their scope into live mode, we materialize the
 * in-scope slice as a self-slice (fromUser == toUser) in `shared_slices`
 * with syncStatus='live'. The existing sharing/sync-service + scheduler
 * then handles periodic re-sync when scope-relevant records change.
 *
 * The self-slice pattern lets us reuse sharing infrastructure without
 * forking it — the sync code doesn't care whether sender and recipient
 * are the same user; it just emits filtered deltas.
 */

import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../db/index'
import { sharedSlices, sliceSyncEvents } from '../../db/schema/sharing'
import type { Scope } from '../scope/types'

export interface ActivateParams {
  scope: Scope
  sessionToken: string
  userId: string
  workspaceId: string
}

export interface ActivateResult {
  sliceId: string
  created: boolean
}

export async function activateLiveContext(params: ActivateParams): Promise<ActivateResult> {
  // Re-use an existing active self-slice for this session if one exists.
  const existing = await db
    .select()
    .from(sharedSlices)
    .where(
      and(
        eq(sharedSlices.fromUserId, params.userId),
        eq(sharedSlices.toUserId, params.userId),
        eq(sharedSlices.scopeRefId, params.sessionToken)
      )
    )
    .orderBy(desc(sharedSlices.createdAt))
    .limit(1)

  if (existing[0] && !existing[0].revokedAt) {
    // If already live, nothing to do. Else upgrade.
    if (existing[0].syncStatus !== 'live') {
      await db
        .update(sharedSlices)
        .set({ syncStatus: 'live' })
        .where(eq(sharedSlices.id, existing[0].id))

      await db.insert(sliceSyncEvents).values({
        sliceId: existing[0].id,
        eventType: 'upgrade_to_live',
        triggeredBy: 'user_from',
      })
    }
    return { sliceId: existing[0].id, created: false }
  }

  // Create new self-slice. Initial content is the scope JSON + a notice;
  // the sync scheduler will overwrite/append with actual retrieved content.
  const initialContent = [
    `[LIVE CONTEXT — ${params.scope.name}]`,
    '',
    `Scope active as of ${new Date().toISOString()}.`,
    `Mode: ${params.scope.mode}`,
    `Boundaries: ${params.scope.boundaries.length} configured.`,
    '',
    'Content will populate on next sync tick (≤2 min).',
  ].join('\n')

  const rows = await db
    .insert(sharedSlices)
    .values({
      fromUserId: params.userId,
      toUserId: params.userId,
      workspaceId: params.workspaceId,
      sliceContent: initialContent,
      sliceMetadata: {
        sources: [],
        redactionCount: 0,
        excludedCount: 0,
        itemCount: 0,
        queryScope: {
          type: 'live_context',
          refId: params.sessionToken,
          query: params.scope.name,
        },
        scope: {
          scope_id: params.scope.scope_id,
          name: params.scope.name,
          boundaries: params.scope.boundaries,
        },
      },
      scopeType: 'live_context',
      scopeRefId: params.sessionToken,
      presetUsed: 'balanced',
      rulesApplied: 0,
      redactionCount: 0,
      syncStatus: 'live',
    })
    .returning({ id: sharedSlices.id })

  const firstRow = rows[0]
  if (!firstRow) throw new Error('activateLiveContext: insert returned no rows')
  const sliceId = firstRow.id

  await db.insert(sliceSyncEvents).values({
    sliceId,
    eventType: 'upgrade_to_live',
    triggeredBy: 'user_from',
  })

  return { sliceId, created: true }
}

/**
 * Look up the active self-slice for a given session token. Used by the
 * frontend live-context block to render current slice content.
 */
export async function getLiveContextSlice(params: {
  userId: string
  sessionToken: string
}): Promise<{
  id: string
  content: string
  itemCount: number
  redactionCount: number
  lastSyncedAt: Date
  syncStatus: string
} | null> {
  const rows = await db
    .select()
    .from(sharedSlices)
    .where(
      and(
        eq(sharedSlices.fromUserId, params.userId),
        eq(sharedSlices.toUserId, params.userId),
        eq(sharedSlices.scopeRefId, params.sessionToken)
      )
    )
    .orderBy(desc(sharedSlices.createdAt))
    .limit(1)

  const row = rows[0]
  if (!row || row.revokedAt) return null

  const meta = (row.sliceMetadata ?? {}) as { itemCount?: number; redactionCount?: number }
  return {
    id: row.id,
    content: row.sliceContent,
    itemCount: meta.itemCount ?? 0,
    redactionCount: meta.redactionCount ?? 0,
    lastSyncedAt: row.lastSyncedAt,
    syncStatus: row.syncStatus,
  }
}
