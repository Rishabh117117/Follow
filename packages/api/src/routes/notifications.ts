import { Hono } from 'hono'
import { eq, desc, and, sql } from 'drizzle-orm'
import { db } from '../db/index'
import { notifications } from '../db/schema/collaboration'
import { authMiddleware } from '../middleware/auth'
import { assertWorkspaceAccess } from '../services/workspace-access'

const app = new Hono()

app.use('*', authMiddleware)

// ─── List notifications ──────────────────────────────────────────────
app.get('/', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId')
  const unreadOnly = c.req.query('unreadOnly') === 'true'
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 100)
  const cursor = c.req.query('cursor')

  const conditions = [eq(notifications.userId, userId)]
  if (workspaceId) conditions.push(eq(notifications.workspaceId, workspaceId))
  if (unreadOnly) conditions.push(eq(notifications.read, false))
  if (cursor) conditions.push(sql`${notifications.createdAt} < ${cursor}`)

  const results = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit + 1)

  const hasMore = results.length > limit
  const items = results.slice(0, limit)

  return c.json({
    data: items,
    error: null,
    meta: {
      hasMore,
      nextCursor: hasMore ? items[items.length - 1]?.createdAt?.toISOString() : null,
    },
  })
})

// ─── Unread count ────────────────────────────────────────────────────
app.get('/unread-count', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId')

  const conditions = [eq(notifications.userId, userId), eq(notifications.read, false)]
  if (workspaceId) conditions.push(eq(notifications.workspaceId, workspaceId))

  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(...conditions))

  return c.json({ data: { count: result?.count ?? 0 }, error: null })
})

// ─── Mark as read ────────────────────────────────────────────────────
app.patch('/:id/read', async (c) => {
  const userId = c.get('userId')
  const [notif] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, c.req.param('id')), eq(notifications.userId, userId)))

  if (!notif) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Notification not found' } },
      404
    )
  }

  const [updated] = await db
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.id, notif.id))
    .returning()

  return c.json({ data: updated, error: null })
})

// ─── Mark all as read ────────────────────────────────────────────────
app.post('/mark-all-read', async (c) => {
  const userId = c.get('userId')
  const body = await c.req
    .json<{ workspaceId?: string }>()
    .catch(() => ({}) as { workspaceId?: string })

  const conditions = [eq(notifications.userId, userId), eq(notifications.read, false)]
  if (body.workspaceId) conditions.push(eq(notifications.workspaceId, body.workspaceId))

  await db
    .update(notifications)
    .set({ read: true })
    .where(and(...conditions))

  return c.json({ data: { success: true }, error: null })
})

// ─── Create notification (internal use) ──────────────────────────────
app.post('/', async (c) => {
  const body = await c.req.json<{
    workspaceId: string
    userId: string
    type: string
    title: string
    body?: string
    link?: string
    metadata?: Record<string, unknown>
  }>()

  if (!body.workspaceId || !body.userId || !body.type || !body.title) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'Missing required fields' } },
      400
    )
  }

  // A caller may only create notifications inside a workspace they belong to —
  // otherwise this injects arbitrary notifications into other tenants.
  const denied = await assertWorkspaceAccess(c, body.workspaceId)
  if (denied) return denied

  const [notif] = await db
    .insert(notifications)
    .values({
      workspaceId: body.workspaceId,
      userId: body.userId,
      type: body.type as
        | 'mention'
        | 'comment'
        | 'share'
        | 'invite'
        | 'agent_complete'
        | 'prompt_card'
        | 'system',
      title: body.title,
      body: body.body ?? '',
      link: body.link ?? null,
      metadata: body.metadata ?? {},
    })
    .returning()

  return c.json({ data: notif, error: null }, 201)
})

export const notificationsRouter = app
