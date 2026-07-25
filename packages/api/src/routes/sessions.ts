/**
 * Sessions Routes (2026-04-29)
 *
 * Webapp lifecycle endpoints for the persisted sessions table. The MCP
 * transport calls services/sessions directly; the webapp uses these.
 *
 *   POST   /api/sessions                    open a session for the current tab
 *   POST   /api/sessions/:id/heartbeat      tab is still alive (every 60s)
 *   POST   /api/sessions/:id/close          tab is closing (sendBeacon)
 *
 * All three are best-effort — failures don't break the user-visible app.
 * The idle reaper closes any tabs that crash without calling /close.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { assertWorkspaceAccess } from '../services/workspace-access'
import { db } from '../db/index'
import { sessions } from '../db/schema/sessions'
import { openSession, heartbeat, closeSession } from '../services/sessions'

export const sessionsRouter = new Hono()
sessionsRouter.use('*', authMiddleware)

const OpenSchema = z.object({
  workspaceId: z.string().uuid(),
  /** Browser tab uuid (e.g. crypto.randomUUID() in the page on first load).
   *  Lets us collapse refresh/reconnect to one session per tab. */
  tabId: z.string().min(1).max(128),
  scopeSnapshot: z
    .object({
      indexes: z.array(z.string()).optional(),
      contributors: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      timeWindow: z.object({ start: z.string(), end: z.string() }).optional(),
    })
    .nullish(),
})

sessionsRouter.post('/', zValidator('json', OpenSchema), async (c) => {
  const userId = c.get('userId') as string
  const body = c.req.valid('json')
  const denied = await assertWorkspaceAccess(c, body.workspaceId)
  if (denied) return denied
  try {
    const session = await openSession({
      userId,
      workspaceId: body.workspaceId,
      surface: 'webapp',
      surfaceClientId: body.tabId,
      scopeSnapshot: body.scopeSnapshot ?? null,
    })
    return c.json({
      data: { sessionId: session.id, startedAt: session.startedAt },
      error: null,
    })
  } catch (e: unknown) {
    return c.json(
      {
        data: null,
        error: { code: 'OPEN_FAILED', message: e instanceof Error ? e.message : String(e) },
      },
      500
    )
  }
})

sessionsRouter.post('/:id/heartbeat', async (c) => {
  const id = c.req.param('id')
  const [session] = await db
    .select({ workspaceId: sessions.workspaceId })
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1)
  if (!session) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404)
  }
  const denied = await assertWorkspaceAccess(c, session.workspaceId)
  if (denied) return denied
  await heartbeat(id)
  return c.json({ data: { ok: true }, error: null })
})

const CloseSchema = z
  .object({
    reason: z.enum(['explicit', 'disconnect']).optional(),
  })
  .optional()

sessionsRouter.post('/:id/close', async (c) => {
  const id = c.req.param('id')
  const [session] = await db
    .select({ workspaceId: sessions.workspaceId })
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1)
  if (!session) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404)
  }
  const denied = await assertWorkspaceAccess(c, session.workspaceId)
  if (denied) return denied
  let reason: 'explicit' | 'disconnect' = 'explicit'
  try {
    const body = await c.req.json()
    const parsed = CloseSchema.parse(body)
    if (parsed?.reason) reason = parsed.reason
  } catch {
    /* sendBeacon often arrives without a body — fine, default to 'explicit' */
  }
  await closeSession(id, reason)
  return c.json({ data: { ok: true }, error: null })
})
