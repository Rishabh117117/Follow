/**
 * Persistent storage for the MCP "active project" routing decision.
 *
 * The MCP transport keeps an in-memory session keyed by (userId, workspaceId)
 * with `activeProjectId` deciding where save_conversation / contribute land.
 * That state used to be lost on every server restart, silently dropping
 * subsequent writes back into the user's personal index. These helpers back
 * the in-memory copy with a one-row-per-(user, workspace) table so the
 * decision survives restarts.
 *
 * Read on session create (transport.getOrCreateSession), written by the
 * `set_scope` tool. Personal = NULL.
 */

import { eq, and } from 'drizzle-orm'
import { db } from '../../db/index'
import { mcpActiveProject } from '../../db/schema/mcp-active-project'

/**
 * Returns the persisted activeProjectId for (userId, workspaceId), or null
 * if the user has never set a project scope (i.e., still on personal).
 */
export async function getActiveProjectId(
  userId: string,
  workspaceId: string
): Promise<string | null> {
  if (!userId || !workspaceId) return null
  const [row] = await db
    .select({ activeProjectId: mcpActiveProject.activeProjectId })
    .from(mcpActiveProject)
    .where(
      and(
        eq(mcpActiveProject.userId, userId),
        eq(mcpActiveProject.workspaceId, workspaceId)
      )
    )
    .limit(1)
  return row?.activeProjectId ?? null
}

/**
 * Upsert the active project for (userId, workspaceId). Pass `null` to clear
 * the routing back to personal.
 */
export async function setActiveProjectId(
  userId: string,
  workspaceId: string,
  activeProjectId: string | null
): Promise<void> {
  if (!userId || !workspaceId) return
  await db
    .insert(mcpActiveProject)
    .values({ userId, workspaceId, activeProjectId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [mcpActiveProject.userId, mcpActiveProject.workspaceId],
      set: { activeProjectId, updatedAt: new Date() },
    })
}
