/**
 * Context Request Service (Sprint SH-2)
 *
 * Manages the lifecycle of context requests:
 *   create → pending → (approved | denied | expired)
 *
 * Approval triggers `buildSharedSlice` to actually run the request
 * against the responder's index. The slice insert + the status update
 * are sequenced (slice first, then mark approved) so a slice without
 * an approved request never appears.
 */

import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../db/index'
import { contextRequests } from '../../db/schema/sharing'
import { buildSharedSlice } from './slice-builder'
import type { ScopeType } from './slice-builder'

// ─── Types ───────────────────────────────────────────────────────────────────

export type Urgency = 'low' | 'normal' | 'high'

export interface CreateRequestInput {
  requesterId: string
  responderId: string
  workspaceId: string
  scopeType: ScopeType
  scopeRefId?: string
  query: string
  urgency?: Urgency
  reason?: string
  expiresInMinutes?: number
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Create a new context request from requester to responder.
 * Defaults to 24-hour expiry if `expiresInMinutes` is not provided.
 */
export async function createContextRequest(input: CreateRequestInput): Promise<{ id: string }> {
  const expiresAt = new Date(Date.now() + (input.expiresInMinutes ?? 24 * 60) * 60 * 1000)

  const inserted = await db
    .insert(contextRequests)
    .values({
      requesterId: input.requesterId,
      responderId: input.responderId,
      workspaceId: input.workspaceId,
      scopeType: input.scopeType,
      scopeRefId: input.scopeRefId ?? null,
      query: input.query,
      urgency: input.urgency ?? 'normal',
      reason: input.reason ?? null,
      expiresAt,
      status: 'pending',
    })
    .returning({ id: contextRequests.id })

  return { id: inserted[0]!.id }
}

// ─── Approve ─────────────────────────────────────────────────────────────────

/**
 * Approve a pending request and build the shared slice.
 * The responder's session token must be valid (passcode unlocked).
 */
export async function approveContextRequest(params: {
  requestId: string
  responderId: string
  sessionToken: string
}): Promise<{ success: boolean; sliceId?: string; reason?: string }> {
  // 1. Load the request
  const rows = await db
    .select()
    .from(contextRequests)
    .where(eq(contextRequests.id, params.requestId))
    .limit(1)

  const request = rows[0]
  if (!request) return { success: false, reason: 'Request not found' }
  if (request.responderId !== params.responderId) {
    return { success: false, reason: 'Not your request to approve' }
  }
  if (request.status !== 'pending') {
    return { success: false, reason: `Request is ${request.status}` }
  }
  if (request.expiresAt && request.expiresAt < new Date()) {
    await db
      .update(contextRequests)
      .set({ status: 'expired' })
      .where(eq(contextRequests.id, params.requestId))
    return { success: false, reason: 'Request expired' }
  }

  // 2. Build the slice (validates session, runs filters, inserts row)
  const sliceResult = await buildSharedSlice({
    requestId: params.requestId,
    fromUserId: request.responderId,
    toUserId: request.requesterId,
    workspaceId: request.workspaceId,
    sessionToken: params.sessionToken,
    scopeType: request.scopeType as ScopeType,
    scopeRefId: request.scopeRefId ?? undefined,
    query: request.query,
  })

  if (!sliceResult.success) {
    return { success: false, reason: sliceResult.reason }
  }

  // 3. Mark request approved (only after the slice is safely inserted)
  await db
    .update(contextRequests)
    .set({ status: 'approved', respondedAt: new Date() })
    .where(eq(contextRequests.id, params.requestId))

  return { success: true, sliceId: sliceResult.sliceId }
}

// ─── Deny ────────────────────────────────────────────────────────────────────

/**
 * Deny a pending request. Optional reason is stored for audit.
 */
export async function denyContextRequest(params: {
  requestId: string
  responderId: string
  reason?: string
}): Promise<{ success: boolean }> {
  const rows = await db
    .select()
    .from(contextRequests)
    .where(eq(contextRequests.id, params.requestId))
    .limit(1)

  if (!rows[0] || rows[0].responderId !== params.responderId) {
    return { success: false }
  }

  await db
    .update(contextRequests)
    .set({
      status: 'denied',
      respondedAt: new Date(),
      reason: params.reason ?? null,
    })
    .where(eq(contextRequests.id, params.requestId))

  return { success: true }
}

// ─── Listing ─────────────────────────────────────────────────────────────────

/**
 * Get pending requests addressed to a responder (their inbox).
 * Optionally scoped to a single workspace.
 */
export async function getPendingRequests(responderId: string, workspaceId?: string) {
  const conditions = [
    eq(contextRequests.responderId, responderId),
    eq(contextRequests.status, 'pending'),
  ]
  if (workspaceId) {
    conditions.push(eq(contextRequests.workspaceId, workspaceId))
  }
  return db
    .select()
    .from(contextRequests)
    .where(and(...conditions))
    .orderBy(desc(contextRequests.createdAt))
}

/**
 * Get a requester's outgoing requests (all statuses).
 */
export async function getOutgoingRequests(requesterId: string, workspaceId?: string) {
  const conditions = [eq(contextRequests.requesterId, requesterId)]
  if (workspaceId) {
    conditions.push(eq(contextRequests.workspaceId, workspaceId))
  }
  return db
    .select()
    .from(contextRequests)
    .where(and(...conditions))
    .orderBy(desc(contextRequests.createdAt))
}
