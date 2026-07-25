/**
 * Public routes — no auth middleware.
 * Used for invite acceptance and shared document viewing by unauthenticated users.
 */

import { Hono } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/index'
import { workspaces, workspaceMembers } from '../db/schema/workspaces'
import { users } from '../db/schema/users'
import { files } from '../db/schema/files'
import { fileShares } from '../db/schema/collaboration'

export const publicRouter = new Hono()

// ─── GET /api/public/invite/:token ────────────────────────────────────

publicRouter.get('/invite/:token', async (c) => {
  const token = c.req.param('token')

  const [invite] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.inviteToken, token), eq(workspaceMembers.status, 'pending'))
    )
    .limit(1)

  if (!invite) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Invite not found or expired' } },
      404
    )
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, invite.workspaceId))
    .limit(1)

  if (!workspace) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Workspace no longer exists' } },
      404
    )
  }

  const [owner] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, workspace.ownerId))
    .limit(1)

  return c.json({
    data: {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      inviterName: owner?.name ?? 'A teammate',
      role: invite.role,
      email: invite.inviteEmail,
    },
    error: null,
  })
})

// ─── GET /api/public/shared/:shareToken ───────────────────────────────

publicRouter.get('/shared/:shareToken', async (c) => {
  const shareToken = c.req.param('shareToken')

  const [share] = await db
    .select()
    .from(fileShares)
    .where(and(eq(fileShares.shareToken, shareToken), isNull(fileShares.userId)))
    .limit(1)

  if (!share) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Share link not found' } },
      404
    )
  }

  const [file] = await db
    .select()
    .from(files)
    .where(eq(files.id, share.fileId))
    .limit(1)

  if (!file || file.deletedAt) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Document not found' } },
      404
    )
  }

  const metadata = (file.metadata ?? {}) as Record<string, unknown>
  const tiptapContent = metadata['tiptapContent'] ?? null

  return c.json({
    data: {
      fileId: file.id,
      workspaceId: file.workspaceId,
      fileName: file.name,
      tiptapContent,
      permission: share.permission,
    },
    error: null,
  })
})
