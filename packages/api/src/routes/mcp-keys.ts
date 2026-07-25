/**
 * MCP API Key Management (Sprint MCP-1)
 *
 * CRUD for MCP API keys. Reuses the existing apiKeys table from
 * collaboration schema with permissions=['mcp'].
 */

import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { randomBytes, createHmac } from 'crypto'
import { db } from '../db/index'
import { apiKeys } from '../db/schema/collaboration'
import { workspaceMembers } from '../db/schema/workspaces'
import { authMiddleware } from '../middleware/auth'
import { assertWorkspaceAccess } from '../services/workspace-access'

export const mcpKeysRouter = new Hono()
mcpKeysRouter.use('*', authMiddleware)

/**
 * POST /api/mcp/keys — Generate a new MCP API key.
 * Returns the raw key ONCE — it cannot be retrieved again.
 */
mcpKeysRouter.post('/', async (c) => {
  const userId = c.get('userId') as string
  const body = (await c.req.json().catch(() => ({}))) as { name?: string }

  // The auth middleware only sets workspaceId from an x-workspace-id header.
  // The connectors page doesn't send one, so fall back to the user's first
  // workspace membership — otherwise the insert below violates the
  // api_keys.workspace_id NOT NULL constraint.
  let workspaceId = c.get('workspaceId') as string | undefined
  if (!workspaceId) {
    const [membership] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
      .limit(1)
    workspaceId = membership?.workspaceId
  }
  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'NO_WORKSPACE', message: 'No workspace found for user' } },
      400
    )
  }

  // The membership fallback above always picks the caller's own workspace, but a
  // caller-supplied x-workspace-id header could name someone else's — the minted
  // wsp_ key would then grant them access to it. Guard the resolved workspace.
  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const name = body.name ?? 'MCP Key'
  const rawKey = `wsp_${randomBytes(32).toString('hex')}`
  const keyPrefix = rawKey.slice(0, 12)
  const keyHash = createHmac('sha256', 'workspace-api-keys').update(rawKey).digest('hex')

  const [key] = await db
    .insert(apiKeys)
    .values({
      workspaceId,
      name,
      keyHash,
      keyPrefix,
      permissions: ['{mcp}'],
      createdBy: userId,
    })
    .returning()

  if (!key) {
    return c.json(
      { data: null, error: { code: 'INTERNAL', message: 'Failed to create API key' } },
      500
    )
  }

  return c.json({
    data: {
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      rawKey, // Shown once only
      createdAt: key.createdAt,
    },
    error: null,
  })
})

/**
 * GET /api/mcp/keys — List active MCP API keys (no raw keys).
 */
mcpKeysRouter.get('/', async (c) => {
  const userId = c.get('userId') as string

  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.createdBy, userId))

  return c.json({ data: keys, error: null })
})

/**
 * DELETE /api/mcp/keys/:id — Revoke an API key.
 */
mcpKeysRouter.delete('/:id', async (c) => {
  const userId = c.get('userId') as string
  const keyId = c.req.param('id')

  const [key] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.createdBy, userId)))
    .limit(1)

  if (!key) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404)
  }

  await db.delete(apiKeys).where(eq(apiKeys.id, keyId))

  return c.json({ data: { ok: true }, error: null })
})
