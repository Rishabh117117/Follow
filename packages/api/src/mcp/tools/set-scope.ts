/**
 * MCP Tool: set_scope (Sprint MCP-1)
 *
 * Activates a project index for the current MCP session.
 * After calling this, query_index with scope='auto' uses the project index.
 */

import type { MCPToolDefinition, MCPToolResult, MCPSession, MCPDependencies } from '../types'
import { db } from '../../db/index'
import { eq, and } from 'drizzle-orm'
import { workspaces, workspaceMembers } from '../../db/schema/workspaces'
import { indexAccess } from '../../db/schema/sharing'
import { indexRecords } from '../../db/schema/semantic-index'
import { sql } from 'drizzle-orm'
import { setActiveProjectId } from '../../services/mcp/active-project'

export const setScopeTool: MCPToolDefinition = {
  name: 'set_scope',
  description:
    "Activate a project/workspace index for this session. After calling this, all queries with scope='auto' search the project index. Use project_id='personal' to switch back.",
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description:
          "The workspace ID to activate. Use 'personal' to switch back to personal index.",
      },
    },
    required: ['project_id'],
  },
  handler: setScopeHandler,
}

async function setScopeHandler(
  params: Record<string, unknown>,
  session: MCPSession,
  _deps: MCPDependencies
): Promise<MCPToolResult> {
  const projectId = params.project_id as string

  if (!projectId) {
    return {
      content: [{ type: 'text', text: 'Error: project_id is required.' }],
      isError: true,
    }
  }

  // Reset to personal
  if (projectId === 'personal') {
    session.activeProjectId = null
    session.activeProjectScope = 'personal'
    // Persist so this survives a server restart. Best-effort — a write
    // failure shouldn't block the in-memory switch.
    try {
      await setActiveProjectId(session.userId, session.workspaceId, null)
    } catch (err) {
      console.error('[set_scope] failed to persist personal scope:', err)
    }
    return {
      content: [
        {
          type: 'text',
          text: 'Switched to personal index. All queries will now search your personal knowledge base.',
        },
      ],
    }
  }

  // Verify workspace exists
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, projectId))
    .limit(1)

  if (!workspace) {
    return {
      content: [{ type: 'text', text: `Error: Workspace "${projectId}" not found.` }],
      isError: true,
    }
  }

  // Verify user has access
  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, projectId),
        eq(workspaceMembers.userId, session.userId),
        eq(workspaceMembers.status, 'active')
      )
    )
    .limit(1)

  // Also allow workspace owner
  const isOwner = workspace.ownerId === session.userId
  if (!membership && !isOwner) {
    return {
      content: [{ type: 'text', text: "You don't have access to this project." }],
      isError: true,
    }
  }

  // Check index lock state
  const [access] = await db
    .select()
    .from(indexAccess)
    .where(eq(indexAccess.workspaceId, projectId))
    .limit(1)

  if (access?.isLocked && access.passcodeHash) {
    return {
      content: [
        {
          type: 'text',
          text: "This project index is locked. Enter the passcode in Follow's management surface first.",
        },
      ],
      isError: true,
    }
  }

  // Get index stats
  const [stats] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(indexRecords)
    .where(eq(indexRecords.workspaceId, projectId))

  // Set session scope
  session.activeProjectId = projectId
  session.activeProjectScope = 'project'

  // Persist so the routing decision survives a server restart. Best-effort.
  try {
    await setActiveProjectId(session.userId, session.workspaceId, projectId)
  } catch (err) {
    console.error('[set_scope] failed to persist project scope:', err)
  }

  const recordCount = stats?.count ?? 0

  return {
    content: [
      {
        type: 'text',
        text: `Activated project index: ${workspace.name}. All queries will now search the shared project index.\n\nIndex contains ${recordCount} record(s).`,
      },
    ],
  }
}
