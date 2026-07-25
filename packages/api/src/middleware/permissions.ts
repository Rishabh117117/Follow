import type { MiddlewareHandler } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index'
import { workspaceMembers, workspaces } from '../db/schema/index'
import type { UserRole } from '@workspace/shared/types'

const ROLE_HIERARCHY: Record<UserRole, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
}

export function hasPermission(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole]
}

export function requirePermission(requiredRole: UserRole): MiddlewareHandler {
  return async (c, next) => {
    const userId = c.get('userId')
    const workspaceId = c.req.param('id') || c.req.param('workspaceId') || c.get('workspaceId')

    if (!userId) {
      return c.json(
        { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        401
      )
    }

    if (!workspaceId) {
      return c.json(
        { data: null, error: { code: 'BAD_REQUEST', message: 'Workspace ID required' } },
        400
      )
    }

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))

    if (!workspace || workspace.deletedAt) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Workspace not found' } },
        404
      )
    }

    if (workspace.ownerId === userId) {
      c.set('memberRole' as never, 'owner')
      await next()
      return
    }

    const [member] = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.status, 'active')
        )
      )

    if (!member) {
      return c.json(
        { data: null, error: { code: 'FORBIDDEN', message: 'Not a member of this workspace' } },
        403
      )
    }

    if (!hasPermission(member.role, requiredRole)) {
      return c.json(
        {
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: `Requires ${requiredRole} role or higher`,
          },
        },
        403
      )
    }

    c.set('memberRole' as never, member.role)
    await next()
  }
}
