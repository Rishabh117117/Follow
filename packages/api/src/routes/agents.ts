/**
 * Desktop Agent Provisioning (STABILIZE-2)
 *
 * Endpoints used by the web app's Settings → Agents panel to connect
 * a desktop agent to the current user's workspace. The agent key is a
 * regular MCP API key named "desktop-agent-<workspaceId>" that is
 * auto-rotated on every connect click (so a second click always
 * returns a usable raw key — the old one is hard-deleted).
 */

import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { randomBytes, createHmac } from 'crypto'
import { db } from '../db/index'
import { apiKeys } from '../db/schema/collaboration'
import { authMiddleware } from '../middleware/auth'

export const agentsRouter = new Hono()
agentsRouter.use('*', authMiddleware)

const AGENT_KEY_NAME = 'desktop-agent'

/**
 * POST /api/agents/provision
 *   (Re)issues a Desktop Agent API key for the caller's workspace.
 *   Any existing key named "desktop-agent" for this user+workspace is
 *   revoked first, so the returned rawKey is always usable.
 *
 *   Response: { apiUrl, apiKey, workspaceId, rotated: boolean }
 */
agentsRouter.post('/provision', async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = c.get('workspaceId') as string

  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'NO_WORKSPACE', message: 'Active workspace required' } },
      400
    )
  }

  // Revoke any prior desktop-agent key for this user+workspace.
  const prior = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.createdBy, userId),
        eq(apiKeys.workspaceId, workspaceId),
        eq(apiKeys.name, AGENT_KEY_NAME)
      )
    )
  for (const row of prior) {
    await db.delete(apiKeys).where(eq(apiKeys.id, row.id))
  }

  // Mint a new one.
  const rawKey = `wsp_${randomBytes(32).toString('hex')}`
  const keyPrefix = rawKey.slice(0, 12)
  const keyHash = createHmac('sha256', 'workspace-api-keys').update(rawKey).digest('hex')

  const [created] = await db
    .insert(apiKeys)
    .values({
      workspaceId,
      name: AGENT_KEY_NAME,
      keyHash,
      keyPrefix,
      permissions: ['{mcp}'],
      createdBy: userId,
    })
    .returning()

  if (!created) {
    return c.json(
      { data: null, error: { code: 'INTERNAL', message: 'Failed to mint agent key' } },
      500
    )
  }

  const apiUrl = process.env['MCP_PUBLIC_URL'] || `http://localhost:${process.env['PORT'] ?? '3001'}`

  return c.json({
    data: {
      apiUrl,
      apiKey: rawKey,
      workspaceId,
      keyPrefix,
      rotated: prior.length > 0,
    },
    error: null,
  })
})

/**
 * GET /api/agents/status
 *   Lightweight check: does a desktop-agent key exist for this user+workspace?
 *   Used by the Settings UI to decide whether to render Connect vs. Rotate.
 */
agentsRouter.get('/status', async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = c.get('workspaceId') as string

  if (!workspaceId) {
    return c.json({ data: { connected: false }, error: null })
  }

  const [row] = await db
    .select({
      id: apiKeys.id,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.createdBy, userId),
        eq(apiKeys.workspaceId, workspaceId),
        eq(apiKeys.name, AGENT_KEY_NAME)
      )
    )
    .limit(1)

  return c.json({
    data: row
      ? { connected: true, keyPrefix: row.keyPrefix, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt }
      : { connected: false },
    error: null,
  })
})
