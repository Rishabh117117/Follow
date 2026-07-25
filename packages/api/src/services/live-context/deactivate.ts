/**
 * Live Context Deactivation (Sprint SCOPE-LIVECTX-1)
 *
 * Thin wrappers around sharing/sync-service state transitions for the
 * self-slice backing a live scope.
 */

import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../db/index'
import { sharedSlices, sliceSyncEvents } from '../../db/schema/sharing'

async function findSelfSlice(params: {
  userId: string
  sessionToken: string
}): Promise<string | null> {
  const rows = await db
    .select({ id: sharedSlices.id, revokedAt: sharedSlices.revokedAt })
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
  return row.id
}

export async function pauseLiveContext(params: {
  userId: string
  sessionToken: string
}): Promise<void> {
  const sliceId = await findSelfSlice(params)
  if (!sliceId) return
  await db
    .update(sharedSlices)
    .set({ syncStatus: 'paused' })
    .where(eq(sharedSlices.id, sliceId))
  await db
    .insert(sliceSyncEvents)
    .values({ sliceId, eventType: 'pause', triggeredBy: 'user_from' })
}

export async function resumeLiveContext(params: {
  userId: string
  sessionToken: string
}): Promise<void> {
  const sliceId = await findSelfSlice(params)
  if (!sliceId) return
  await db
    .update(sharedSlices)
    .set({ syncStatus: 'live' })
    .where(eq(sharedSlices.id, sliceId))
  await db
    .insert(sliceSyncEvents)
    .values({ sliceId, eventType: 'resume', triggeredBy: 'user_from' })
}

export async function endLiveContext(params: {
  userId: string
  sessionToken: string
  reason?: string
}): Promise<void> {
  const sliceId = await findSelfSlice(params)
  if (!sliceId) return
  await db
    .update(sharedSlices)
    .set({
      revokedAt: new Date(),
      revokedReason: params.reason ?? 'scope_ended',
      syncStatus: 'shared',
    })
    .where(eq(sharedSlices.id, sliceId))
  await db
    .insert(sliceSyncEvents)
    .values({ sliceId, eventType: 'downgrade_to_shared', triggeredBy: 'user_from' })
}
