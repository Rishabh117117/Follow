/**
 * MCP Tool: send_conversation (Sprint MCP-2)
 *
 * Forwards a conversation (or filtered subset) to another user's index.
 */

import type { MCPToolDefinition, MCPToolResult, MCPSession } from '../types'
import { db } from '../../db/index'
import { eq, and, ilike } from 'drizzle-orm'
import { workspaceMembers } from '../../db/schema/workspaces'
import { users } from '../../db/schema/users'
import { chatConversations, chatMessages } from '../../db/schema/chat'

export const sendConversationTool: MCPToolDefinition = {
  name: 'send_conversation',
  description:
    'Forward a conversation to a teammate in the active project. Supports topic exclusion and summary-only mode.',
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: "Recipient's name or user ID",
      },
      exclude_topics: {
        type: 'array',
        description: 'Topics or keywords to exclude from the forwarded conversation',
        items: { type: 'string' },
      },
      summary_only: {
        type: 'boolean',
        description: 'If true, send an AI-generated summary instead of the full conversation. Default: false',
      },
      messages: {
        type: 'array',
        description: 'The conversation messages to forward.',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string' },
            content: { type: 'string' },
          },
        },
      },
    },
    required: ['to'],
  },
  handler: sendConversationHandler,
}

async function sendConversationHandler(
  params: Record<string, unknown>,
  session: MCPSession
): Promise<MCPToolResult> {
  if (!session.activeProjectId) {
    return {
      content: [
        { type: 'text', text: 'Error: No project scope is active. Call set_scope first.' },
      ],
      isError: true,
    }
  }

  const to = params.to as string
  const excludeTopics = (params.exclude_topics as string[]) ?? []
  const summaryOnly = (params.summary_only as boolean) ?? false
  const rawMessages = (params.messages as Array<{ role: string; content: string }>) ?? []

  if (!to) {
    return {
      content: [{ type: 'text', text: 'Error: "to" is required.' }],
      isError: true,
    }
  }

  if (rawMessages.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: messages array is required. Include the conversation messages you want to forward.',
        },
      ],
      isError: true,
    }
  }

  // Resolve recipient
  const recipientId = await resolveRecipient(to, session.activeProjectId)
  if (typeof recipientId !== 'string') return recipientId

  const [recipient] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, recipientId))
    .limit(1)
  const recipientName = recipient?.name ?? to

  // Filter by excluded topics
  let filteredMessages = rawMessages
  let excludedCount = 0
  if (excludeTopics.length > 0) {
    const lowerTopics = excludeTopics.map((t) => t.toLowerCase())
    filteredMessages = rawMessages.filter((msg) => {
      const lower = msg.content.toLowerCase()
      const shouldExclude = lowerTopics.some((topic) => lower.includes(topic))
      if (shouldExclude) excludedCount++
      return !shouldExclude
    })
  }

  if (filteredMessages.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'All messages were excluded by topic filters. Nothing to forward.',
        },
      ],
    }
  }

  // Summary mode
  let contentToSave: string
  if (summaryOnly) {
    contentToSave = `[Summary of ${filteredMessages.length} messages]\n\n`
    // Build a simple extractive summary
    const userMsgs = filteredMessages.filter((m) => m.role === 'user')
    const assistantMsgs = filteredMessages.filter((m) => m.role === 'assistant')
    contentToSave += `User discussed: ${userMsgs.map((m) => m.content.slice(0, 100)).join('; ')}\n`
    contentToSave += `Key points: ${assistantMsgs.map((m) => m.content.slice(0, 150)).join('; ')}`
  } else {
    contentToSave = filteredMessages.map((m) => `${m.role}: ${m.content}`).join('\n\n')
  }

  try {
    // Save conversation to project index
    const [conversation] = await db
      .insert(chatConversations)
      .values({
        workspaceId: session.activeProjectId,
        userId: session.userId,
        title: `Forwarded to ${recipientName}`,
        type: 'standard',
        chatSourceType: 'follow-web',
        metadata: {
          forwarded: true,
          forwardedBy: session.userId,
          forwardedTo: recipientId,
          excludedTopics: excludeTopics,
          summaryOnly,
        },
      })
      .returning()

    if (conversation) {
      const msgValues = filteredMessages.map((msg, idx) => ({
        conversationId: conversation.id,
        userId: msg.role === 'user' ? session.userId : null,
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        metadata: { orderIndex: idx },
      }))
      await db.insert(chatMessages).values(msgValues)
    }

    // Create directed context request
    const { createContextRequest } = await import(
      '../../services/sharing/context-request'
    )
    await createContextRequest({
      requesterId: session.userId,
      responderId: recipientId,
      workspaceId: session.activeProjectId,
      scopeType: 'topic',
      query: `Forwarded conversation: ${contentToSave.slice(0, 200)}`,
      reason: 'Conversation forwarded via MCP',
    })

    return {
      content: [
        {
          type: 'text',
          text: `Forwarded conversation to ${recipientName}. ${filteredMessages.length} messages sent${
            excludedCount > 0 ? `, ${excludedCount} excluded` : ''
          }${summaryOnly ? ' (summary only)' : ''}. They can ask their AI "what did ${session.userId} send me?" to see it.`,
        },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return {
      content: [{ type: 'text', text: `Failed to forward conversation: ${msg}` }],
      isError: true,
    }
  }
}

async function resolveRecipient(
  to: string,
  projectId: string
): Promise<string | MCPToolResult> {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (uuidPattern.test(to)) return to

  const members = await db
    .select({ userId: workspaceMembers.userId, userName: users.name })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(and(eq(workspaceMembers.workspaceId, projectId), ilike(users.name, `%${to}%`)))
    .limit(5)

  if (members.length === 0) {
    return { content: [{ type: 'text', text: `"${to}" is not a member of this project.` }], isError: true }
  }
  if (members.length === 1 && members[0]!.userId) return members[0]!.userId

  let text = `Multiple matches for "${to}":\n`
  for (const m of members) text += `- ${m.userName} (ID: ${m.userId})\n`
  text += '\nSpecify which one by providing the user ID.'
  return { content: [{ type: 'text', text }] }
}
