import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, eq, isNull, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { db } from '../db/index'
import { workspaces, workspaceMembers } from '../db/schema/workspaces'
import { users } from '../db/schema/users'
import { files } from '../db/schema/files'
import { authMiddleware } from '../middleware/auth'
import { requirePermission } from '../middleware/permissions'
import { EventBus } from '../events/EventBus'
import { redis } from '../redis/index'

const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
})

const UpdateWorkspaceSchema = CreateWorkspaceSchema.partial()

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'editor', 'viewer']),
})

const JoinSchema = z.object({
  token: z.string().min(1),
})

const UpdateMemberSchema = z.object({
  role: z.enum(['admin', 'editor', 'viewer']),
})

export const workspacesRouter = new Hono()

workspacesRouter.use('*', authMiddleware)

workspacesRouter.post('/', zValidator('json', CreateWorkspaceSchema), async (c) => {
  const body = c.req.valid('json')
  const userId = c.get('userId')

  const [workspace] = await db
    .insert(workspaces)
    .values({ name: body.name, slug: body.slug, ownerId: userId })
    .returning()

  const ws = workspace!

  await db.insert(workspaceMembers).values({
    workspaceId: ws.id,
    userId,
    role: 'owner',
    status: 'active',
  })

  await db.insert(files).values({
    workspaceId: ws.id,
    name: 'Root',
    type: 'folder',
    createdBy: userId,
  })

  await EventBus.emit({
    workspaceId: ws.id,
    userId,
    actionType: 'workspace_created',
    objectType: 'workspace',
    objectId: ws.id,
    payload: { name: body.name },
  })

  return c.json({ data: ws, error: null }, 201)
})

workspacesRouter.get('/', async (c) => {
  const userId = c.get('userId')

  const memberWorkspaces = await db
    .select({
      workspace: workspaces,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, 'active'),
        isNull(workspaces.deletedAt)
      )
    )

  const data = memberWorkspaces.map((mw) => ({
    ...mw.workspace,
    role: mw.role,
  }))

  return c.json({ data, error: null })
})

workspacesRouter.get('/:id', requirePermission('viewer'), async (c) => {
  const id = c.req.param('id')

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))

  if (!workspace) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Workspace not found' } }, 404)
  }

  const members = await db
    .select({
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      status: workspaceMembers.status,
      joinedAt: workspaceMembers.joinedAt,
      inviteEmail: workspaceMembers.inviteEmail,
      userName: users.name,
      userEmail: users.email,
      userAvatar: users.avatarUrl,
    })
    .from(workspaceMembers)
    .leftJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, id))

  return c.json({ data: { ...workspace, members }, error: null })
})

// ─── Presence (online members + active document) ────────────────────
workspacesRouter.get('/:id/presence', requirePermission('viewer'), async (c) => {
  const workspaceId = c.req.param('id')

  let keys: string[] = []
  try {
    keys = await redis.keys(`presence:${workspaceId}:*`)
  } catch {
    return c.json({ data: [], error: null })
  }

  if (keys.length === 0) {
    return c.json({ data: [], error: null })
  }

  const userIds = keys.map((k) => k.split(':')[2]).filter(Boolean) as string[]
  if (userIds.length === 0) return c.json({ data: [], error: null })

  let values: (string | null)[] = []
  try {
    values = await redis.mget(...keys)
  } catch {
    values = []
  }

  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(inArray(users.id, userIds))

  const result = userRows.map((u, idx) => {
    const raw = values[idx] ?? null
    let activeDocumentId: string | null = null
    if (raw && raw !== 'online') {
      try {
        const parsed = JSON.parse(raw) as { activeDocumentId?: string }
        activeDocumentId = parsed.activeDocumentId ?? null
      } catch {
        // raw was a non-JSON context string
      }
    }
    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl,
      activeDocumentId,
    }
  })

  return c.json({ data: result, error: null })
})

workspacesRouter.patch(
  '/:id',
  requirePermission('admin'),
  zValidator('json', UpdateWorkspaceSchema),
  async (c) => {
    const id = c.req.param('id')
    const body = c.req.valid('json')

    const [updated] = await db
      .update(workspaces)
      .set(body)
      .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))
      .returning()

    if (!updated) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Workspace not found' } },
        404
      )
    }

    return c.json({ data: updated, error: null })
  }
)

workspacesRouter.delete('/:id', requirePermission('owner'), async (c) => {
  const id = c.req.param('id')

  const [deleted] = await db
    .update(workspaces)
    .set({ deletedAt: new Date() })
    .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))
    .returning()

  if (!deleted) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Workspace not found' } }, 404)
  }

  return c.json({ data: deleted, error: null })
})

workspacesRouter.post(
  '/:id/invite',
  requirePermission('admin'),
  zValidator('json', InviteSchema),
  async (c) => {
    const workspaceId = c.req.param('id')
    const { email, role } = c.req.valid('json')
    const userId = c.get('userId')
    const inviteToken = nanoid(32)

    const [invite] = await db
      .insert(workspaceMembers)
      .values({
        workspaceId,
        role,
        inviteEmail: email,
        inviteToken,
        status: 'pending',
      })
      .returning()

    const inv = invite!
    await EventBus.emit({
      workspaceId,
      userId,
      actionType: 'member_invited',
      objectType: 'workspace_member',
      objectId: inv.id,
      payload: { email, role },
    })

    return c.json({ data: { ...inv, inviteToken }, error: null }, 201)
  }
)

workspacesRouter.post('/:id/join', zValidator('json', JoinSchema), async (c) => {
  const workspaceId = c.req.param('id')
  const { token } = c.req.valid('json')
  const userId = c.get('userId')

  const [invite] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.inviteToken, token),
        eq(workspaceMembers.status, 'pending')
      )
    )

  if (!invite) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Invalid or expired invite' } },
      404
    )
  }

  const [updated] = await db
    .update(workspaceMembers)
    .set({ userId, status: 'active', inviteToken: null, joinedAt: new Date() })
    .where(eq(workspaceMembers.id, invite.id))
    .returning()

  const member = updated!
  await EventBus.emit({
    workspaceId,
    userId,
    actionType: 'member_joined',
    objectType: 'workspace_member',
    objectId: member.id,
  })

  return c.json({ data: member, error: null })
})

workspacesRouter.get('/:id/members', requirePermission('viewer'), async (c) => {
  const workspaceId = c.req.param('id')

  const members = await db
    .select({
      id: workspaceMembers.id,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      status: workspaceMembers.status,
      inviteEmail: workspaceMembers.inviteEmail,
      joinedAt: workspaceMembers.joinedAt,
      userName: users.name,
      userEmail: users.email,
      userAvatar: users.avatarUrl,
    })
    .from(workspaceMembers)
    .leftJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))

  return c.json({ data: members, error: null })
})

workspacesRouter.patch(
  '/:id/members/:userId',
  requirePermission('admin'),
  zValidator('json', UpdateMemberSchema),
  async (c) => {
    const workspaceId = c.req.param('id')
    const targetUserId = c.req.param('userId')
    const { role } = c.req.valid('json')

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))

    if (workspace && workspace.ownerId === targetUserId) {
      return c.json(
        { data: null, error: { code: 'FORBIDDEN', message: 'Cannot change owner role' } },
        403
      )
    }

    const [updated] = await db
      .update(workspaceMembers)
      .set({ role })
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, targetUserId)
        )
      )
      .returning()

    if (!updated) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Member not found' } }, 404)
    }

    return c.json({ data: updated, error: null })
  }
)

// Revoke a pending invite by row ID (pending invites have user_id = null)
workspacesRouter.delete('/:id/invites/:inviteId', requirePermission('admin'), async (c) => {
  const workspaceId = c.req.param('id')
  const inviteId = c.req.param('inviteId')

  const [removed] = await db
    .update(workspaceMembers)
    .set({ status: 'removed', inviteToken: null })
    .where(
      and(
        eq(workspaceMembers.id, inviteId),
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.status, 'pending')
      )
    )
    .returning()

  if (!removed) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Invite not found' } }, 404)
  }

  return c.json({ data: removed, error: null })
})

workspacesRouter.delete('/:id/members/:userId', requirePermission('admin'), async (c) => {
  const workspaceId = c.req.param('id')
  const targetUserId = c.req.param('userId')

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))

  if (workspace && workspace.ownerId === targetUserId) {
    return c.json(
      { data: null, error: { code: 'FORBIDDEN', message: 'Cannot remove workspace owner' } },
      403
    )
  }

  const [removed] = await db
    .update(workspaceMembers)
    .set({ status: 'removed' })
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId))
    )
    .returning()

  if (!removed) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Member not found' } }, 404)
  }

  return c.json({ data: removed, error: null })
})
