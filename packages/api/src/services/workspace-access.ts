/**
 * Workspace membership guard (security-gate-1).
 *
 * THE multi-tenant boundary: every read/write that takes a caller-supplied
 * workspaceId under identity-only auth must pass through here before touching
 * workspace-scoped data. Access = the workspace exists (not soft-deleted) AND
 * the caller is its owner OR holds an ACTIVE workspace_members row — the same
 * predicate set_scope has always used (mcp/tools/set-scope.ts).
 *
 * wsp_ API keys don't need this for their own workspace (api-key-auth pins
 * workspaceId from the key row, not from the request), but any handler that
 * accepts a workspaceId from the body/query still guards it here, so a key
 * can't name someone else's workspace either.
 */
import type { Context, MiddlewareHandler } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index'
import { workspaceMembers, workspaces } from '../db/schema/index'
import type { UserRole } from '@workspace/shared/types'

export type WorkspaceAccess =
  | { ok: true; role: UserRole }
  | { ok: false; status: 403 | 404; message: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function checkWorkspaceAccess(
  userId: string,
  workspaceId: string
): Promise<WorkspaceAccess> {
  // A non-UUID id (e.g. the legacy 'default' fallback, or garbage) is not a
  // workspace the caller can belong to. Reject before the query so it can't
  // blow up on the uuid cast — treat it as "not found".
  if (!userId || !workspaceId || !UUID_RE.test(workspaceId)) {
    return { ok: false, status: 404, message: 'Workspace not found' }
  }

  const [workspace] = await db
    .select({ id: workspaces.id, ownerId: workspaces.ownerId, deletedAt: workspaces.deletedAt })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)

  if (!workspace || workspace.deletedAt) {
    return { ok: false, status: 404, message: 'Workspace not found' }
  }

  if (workspace.ownerId === userId) {
    return { ok: true, role: 'owner' }
  }

  const [member] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, 'active')
      )
    )
    .limit(1)

  if (!member) {
    return { ok: false, status: 403, message: 'Not a member of this workspace' }
  }

  return { ok: true, role: member.role }
}

/**
 * Route-handler form: resolves to null when access is granted, otherwise the
 * ready-to-return error Response (400 missing id / 403 non-member / 404 gone),
 * in the standard `{ data, error }` envelope.
 *
 *   const denied = await assertWorkspaceAccess(c, workspaceId)
 *   if (denied) return denied
 *
 * Only call it on routes where a workspaceId is REQUIRED — for optional-scope
 * flows, guard the call site (`if (workspaceId) { ... }`).
 */
export async function assertWorkspaceAccess(
  c: Context,
  workspaceId: string | undefined | null
): Promise<Response | null> {
  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId required' } },
      400
    )
  }

  const userId = c.get('userId')
  if (!userId) {
    return c.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      401
    )
  }

  const access = await checkWorkspaceAccess(userId, workspaceId)
  if (!access.ok) {
    return c.json(
      {
        data: null,
        error: {
          code: access.status === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
          message: access.message,
        },
      },
      access.status
    )
  }

  return null
}

/**
 * Router-level guard for routers where EVERY endpoint operates on the header
 * workspace (`c.get('workspaceId')`). Mount with
 * `router.use('*', requireWorkspaceMembership)`. For endpoints that take
 * workspaceId from the body or query, guard in-handler with
 * assertWorkspaceAccess() instead — this middleware runs before the body is
 * parsed, so it only sees the header scope.
 */
export const requireWorkspaceMembership: MiddlewareHandler = async (c, next) => {
  const denied = await assertWorkspaceAccess(c, c.get('workspaceId'))
  if (denied) return denied
  await next()
}

/** MCP-tool form: null when granted, else the standard tool error payload. */
export async function checkWorkspaceAccessForTool(
  userId: string,
  workspaceId: string
): Promise<{ content: { type: 'text'; text: string }[]; isError: true } | null> {
  const access = await checkWorkspaceAccess(userId, workspaceId)
  if (access.ok) return null
  return {
    content: [
      {
        type: 'text' as const,
        text:
          access.status === 404
            ? `Workspace "${workspaceId}" not found.`
            : "You don't have access to this workspace.",
      },
    ],
    isError: true,
  }
}
