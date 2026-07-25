/**
 * MCP Tool: send_message (Sprint MCP-2)
 *
 * Sends a directed message to a teammate through the shared project index.
 */

import type { MCPToolDefinition, MCPToolResult, MCPSession } from '../types'
import { db } from '../../db/index'
import { eq, and, ilike } from 'drizzle-orm'
import { workspaceMembers, workspaces } from '../../db/schema/workspaces'
import { users } from '../../db/schema/users'

export const sendMessageTool: MCPToolDefinition = {
  name: 'send_message',
  description:
    "Send a directed message to a teammate in the active project. They'll see it when they query the project index.",
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: "Recipient's name or user ID",
      },
      content: {
        type: 'string',
        description: 'The message content',
      },
      reference_items: {
        type: 'array',
        description: 'Optional index record IDs to attach as context',
        items: { type: 'string' },
      },
    },
    required: ['to', 'content'],
  },
  handler: sendMessageHandler,
}

async function sendMessageHandler(
  params: Record<string, unknown>,
  session: MCPSession
): Promise<MCPToolResult> {
  if (!session.activeProjectId) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: No project scope is active. Call set_scope first.',
        },
      ],
      isError: true,
    }
  }

  const to = params.to as string
  const content = params.content as string

  if (!to || !content) {
    return {
      content: [{ type: 'text', text: 'Error: both "to" and "content" are required.' }],
      isError: true,
    }
  }

  // Resolve recipient
  const recipientId = await resolveRecipient(to, session.activeProjectId)

  if (typeof recipientId !== 'string') {
    return recipientId // error or ambiguous result
  }

  // Get recipient name
  const [recipient] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, recipientId))
    .limit(1)
  const recipientName = recipient?.name ?? to

  // Create context request as directed message
  try {
    const { createContextRequest } = await import(
      '../../services/sharing/context-request'
    )

    await createContextRequest({
      requesterId: session.userId,
      responderId: recipientId,
      workspaceId: session.activeProjectId,
      scopeType: 'topic',
      query: content,
      reason: 'Directed message via MCP',
      urgency: 'normal',
    })

    return {
      content: [
        {
          type: 'text',
          text: `Message sent to ${recipientName}. They'll see it when they query the project index.`,
        },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return {
      content: [{ type: 'text', text: `Failed to send message: ${msg}` }],
      isError: true,
    }
  }
}

async function resolveRecipient(
  to: string,
  projectId: string
): Promise<string | MCPToolResult> {
  // If UUID-like, use directly
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (uuidPattern.test(to)) return to

  // Search by name in project members
  const members = await db
    .select({
      userId: workspaceMembers.userId,
      userName: users.name,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(
      and(
        eq(workspaceMembers.workspaceId, projectId),
        ilike(users.name, `%${to}%`)
      )
    )
    .limit(5)

  if (members.length === 0) {
    return {
      content: [
        { type: 'text', text: `"${to}" is not a member of this project.` },
      ],
      isError: true,
    }
  }

  if (members.length === 1 && members[0]!.userId) {
    return members[0]!.userId
  }

  // Ambiguous
  let text = `Multiple matches for "${to}":\n`
  for (const m of members) {
    text += `- ${m.userName} (ID: ${m.userId})\n`
  }
  text += '\nSpecify which one by providing the user ID.'
  return { content: [{ type: 'text', text }] }
}
