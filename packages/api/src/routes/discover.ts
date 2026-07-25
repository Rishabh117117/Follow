/**
 * Discover Routes (Sprint V41-DISCOVER-1)
 *
 *   POST   /api/discover/similar            — DiscoverParams → SimilarityResult
 *   GET    /api/discover/signature/:id      — IndexSignature (requires ownership or discoverable=true)
 *   PATCH  /api/discover/indexes/:id/discoverable
 *                                            — { discoverable, scope? } — opt-in toggle
 *   GET    /api/discover/suggestions        — curated top-5 for a source index
 *   GET    /api/discover/recent             — recently-added discoverable indexes
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../db/index'
import { spaces } from '../db/schema/spaces'
import { authMiddleware } from '../middleware/auth'
import { assertWorkspaceAccess } from '../services/workspace-access'
import {
  bulkSignatures,
  checkDiscoverableAllowed,
  computeIndexSignature,
  findSimilarIndexes,
  redactSignature,
  type PrivacyFloor,
} from '../services/discover'

export const discoverRouter = new Hono()
discoverRouter.use('*', authMiddleware)

// ─── Zod ────────────────────────────────────────────────────────────────────

const sourceSchema = z.object({
  kind: z.enum(['index', 'contributor', 'topic']),
  value: z.string().min(1),
})

const similarBodySchema = z.object({
  source: sourceSchema,
  scope: z
    .object({
      workspace: z.string().optional(),
      org: z.boolean().optional(),
      minRecordCount: z.number().int().min(0).optional(),
    })
    .optional(),
  privacyFloor: z.enum(['fingerprint_only', 'topics_only', 'full_signature']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

const patchDiscoverableSchema = z.object({
  discoverable: z.boolean(),
  scope: z.enum(['workspace', 'org', 'public']).optional(),
})

// ─── POST /api/discover/similar ────────────────────────────────────────────

discoverRouter.post('/similar', zValidator('json', similarBodySchema), async (c) => {
  const userId = c.get('userId')
  const denied = await assertWorkspaceAccess(c, c.get('workspaceId'))
  if (denied) return denied
  const workspaceId = c.get('workspaceId') ?? 'default'
  const body = c.req.valid('json')

  const result = await findSimilarIndexes(body, { userId, workspaceId })
  return c.json({ data: { result }, error: null })
})

// ─── GET /api/discover/signature/:id ───────────────────────────────────────

discoverRouter.get('/signature/:id', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const id = c.req.param('id')
  const privacyFloor = (c.req.query('privacyFloor') as PrivacyFloor | null) ?? 'topics_only'

  const allow = await checkDiscoverableAllowed({
    candidateIndexId: id,
    requestorId: userId,
    requestorWorkspaceId: workspaceId,
  })

  // Owner can always fetch full signature via the separate `isOwner` branch.
  const ownerRows = await db
    .select({ ownerId: spaces.createdBy })
    .from(spaces)
    .where(eq(spaces.id, id))
    .limit(1)
  const isOwner = ownerRows[0]?.ownerId === userId

  if (!allow.allowed && !isOwner) {
    return c.json({
      data: { signature: null, conflict: allow.conflict ?? null },
      error: null,
    })
  }

  const full = await computeIndexSignature(id)
  const redacted = redactSignature(full, privacyFloor, { isOwner })
  return c.json({ data: { signature: redacted }, error: null })
})

// ─── PATCH /api/discover/indexes/:id/discoverable ──────────────────────────

discoverRouter.patch(
  '/indexes/:id/discoverable',
  zValidator('json', patchDiscoverableSchema),
  async (c) => {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const body = c.req.valid('json')

    // Owner-only: only the space creator can toggle discoverability.
    const rows = await db
      .select({ createdBy: spaces.createdBy })
      .from(spaces)
      .where(eq(spaces.id, id))
      .limit(1)
    const row = rows[0]
    if (!row) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Index not found' } }, 404)
    }
    if (row.createdBy !== userId) {
      return c.json(
        {
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'Only the index owner can toggle discoverability.',
          },
        },
        403
      )
    }

    const updates: Record<string, unknown> = {
      discoverable: body.discoverable,
      discoverableAt: body.discoverable ? new Date() : null,
      updatedAt: new Date(),
    }
    if (body.scope) updates.discoverableScope = body.scope

    await db.update(spaces).set(updates).where(eq(spaces.id, id))
    return c.json({ data: { id, discoverable: body.discoverable }, error: null })
  }
)

// ─── GET /api/discover/suggestions?indexId=... ─────────────────────────────

discoverRouter.get('/suggestions', async (c) => {
  const userId = c.get('userId')
  const denied = await assertWorkspaceAccess(c, c.get('workspaceId'))
  if (denied) return denied
  const workspaceId = c.get('workspaceId') ?? 'default'
  const indexId = c.req.query('indexId')
  if (!indexId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'indexId query param required' } },
      400
    )
  }
  const privacyFloor = (c.req.query('privacyFloor') as PrivacyFloor | null) ?? 'topics_only'

  const result = await findSimilarIndexes(
    {
      source: { kind: 'index', value: indexId },
      privacyFloor,
      limit: 5,
    },
    { userId, workspaceId }
  )
  return c.json({ data: { result }, error: null })
})

// ─── GET /api/discover/recent?workspaceId=... ──────────────────────────────

discoverRouter.get('/recent', async (c) => {
  const userId = c.get('userId')
  const workspaceIdHdr = c.get('workspaceId') ?? 'default'
  const workspaceId = c.req.query('workspaceId') ?? workspaceIdHdr
  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const rows = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(
        eq(spaces.workspaceId, workspaceId),
        eq(spaces.discoverable, true),
        sql`${spaces.deletedAt} IS NULL`
      )
    )
    .orderBy(desc(spaces.discoverableAt))
    .limit(20)

  const allowedIds: string[] = []
  for (const r of rows) {
    const allow = await checkDiscoverableAllowed({
      candidateIndexId: r.id,
      requestorId: userId,
      requestorWorkspaceId: workspaceId,
    })
    if (allow.allowed) allowedIds.push(r.id)
  }

  const sigs = await bulkSignatures(allowedIds)
  const redacted = sigs.map((s) =>
    redactSignature(s, 'topics_only', { isOwner: s.ownerId === userId })
  )
  return c.json({ data: { signatures: redacted }, error: null })
})
