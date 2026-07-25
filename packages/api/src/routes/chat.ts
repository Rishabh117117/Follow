import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../db/index'
import {
  chatConversations,
  chatMessages,
  chatConversationMembers,
  chatConversationSnapshots,
  deepDiveBookmarks,
  users,
} from '../db/schema/index'
import { authMiddleware } from '../middleware/auth'
import { streamSSE } from 'hono/streaming'
import type { ToolCallRecord } from '@workspace/shared/types'

const chatRouter = new Hono()
chatRouter.use('*', authMiddleware)

// ─── Schemas ───────────────────────────────────────────────────────

const CreateConversationSchema = z.object({
  workspaceId: z.string().uuid(),
  spaceId: z.string().uuid().optional(),
  title: z.string().optional(),
  type: z
    .enum(['standard', 'deep_dive', 'agent_initiated', 'capture_ask', 'group'])
    .default('standard'),
  contextObjectId: z.string().uuid().optional(),
  contextObjectType: z.string().optional(),
  parentConversationId: z.string().uuid().optional(),
  /** For type='group' — initial member user IDs (excluding creator, who is auto-added). */
  memberIds: z.array(z.string().uuid()).optional(),
  chatSourceType: z.string().optional(),
})

const UpdateConversationSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  status: z.enum(['active', 'archived']).optional(),
  isPinned: z.boolean().optional(),
})

const SendMessageSchema = z.object({
  content: z.string().min(1),
  attachments: z
    .array(
      z.object({
        fileId: z.string().optional(),
        fileName: z.string().optional(),
        fileType: z.string().optional(),
        thumbnailUrl: z.string().optional(),
        /** Base64 data URL for inline images (screenshot & ask, web capture, extension) */
        imageData: z.string().optional(),
        /** Provenance of the image */
        imageSource: z.enum(['screenshot', 'upload', 'capture', 'canvas']).optional(),
        /** Web extension metadata */
        metadata: z
          .object({
            url: z.string().optional(),
            title: z.string().optional(),
            capturedAt: z.string().optional(),
          })
          .optional(),
      })
    )
    .default([]),
  /** Optional model ID to use for this completion (e.g. 'claude-sonnet-4-5-20250929') */
  modelId: z.string().optional(),
  /** Source of the message (for web extension context) */
  source: z.enum(['in_app', 'web_extension']).optional(),
  /** Navigation context from client-side intent detection */
  navContext: z
    .object({
      resolvedUrl: z.string().optional(),
      topic: z.string().optional(),
      sectionTarget: z.string().optional(),
      navType: z.string().optional(),
    })
    .optional(),
  /** Current section the user is viewing (for document context) */
  currentSection: z
    .object({
      index: z.number(),
      title: z.string(),
    })
    .optional(),
  /** Document text content sent from frontend (fallback when Yjs server offline) */
  documentContent: z.string().max(100000).optional(),
  /** Recent word-level document edits for AI context (what the user changed recently) */
  recentDocumentEdits: z
    .array(
      z.object({
        editType: z.enum(['insertion', 'deletion', 'replacement']),
        removedText: z.string(),
        addedText: z.string(),
        context: z.string(),
        time: z.string(),
      })
    )
    .optional(),
  /** Chat scope for context bar: 'all' searches everything, 'doc' scopes to current doc, 'pinned' scopes to pinned items */
  chatScope: z.enum(['all', 'doc', 'pinned']).optional(),
  /** Pinned item IDs for scoped retrieval (used when chatScope is 'pinned') */
  pinnedItemIds: z.array(z.string()).optional(),
})

const ThreadReplySchema = z.object({
  content: z.string().min(1),
})

const BookmarkSchema = z.object({
  note: z.string().optional(),
})

const FeedbackSchema = z.object({
  feedback: z.enum(['positive', 'negative']),
})

// ─── Conversations ─────────────────────────────────────────────────

// Create conversation
chatRouter.post('/conversations', zValidator('json', CreateConversationSchema), async (c) => {
  const userId = c.get('userId')
  const body = c.req.valid('json')

  const [conversation] = await db
    .insert(chatConversations)
    .values({
      workspaceId: body.workspaceId,
      userId,
      spaceId: body.spaceId ?? null,
      title: body.title ?? 'New Chat',
      type: body.type,
      contextObjectId: body.contextObjectId ?? null,
      contextObjectType: body.contextObjectType ?? null,
      parentConversationId: body.parentConversationId ?? null,
      chatSourceType: body.chatSourceType ?? 'follow-web',
      metadata: body.type === 'group' ? { createdBy: userId } : {},
    })
    .returning()

  // For group chats: add creator as owner + invited members + send notifications
  if (body.type === 'group' && conversation) {
    const memberIds = Array.from(new Set([...(body.memberIds ?? []), userId]))
    await db
      .insert(chatConversationMembers)
      .values(
        memberIds.map((uid) => ({
          conversationId: conversation.id,
          userId: uid,
          role: uid === userId ? ('owner' as const) : ('member' as const),
        }))
      )
      .onConflictDoNothing()

    // Notify invited members (non-blocking)
    if (memberIds.length > 1) {
      try {
        const { emitNotification } = await import('../services/notifications/emit')
        const [creator] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
        const creatorName = creator?.name ?? 'Someone'
        const groupTitle = conversation.title || 'a group chat'

        for (const memberId of memberIds) {
          if (memberId === userId) continue
          await emitNotification({
            workspaceId: body.workspaceId,
            userId: memberId,
            type: 'invite',
            title: `${creatorName} added you to ${groupTitle}`,
            body: '',
            link: `/workspace/${body.workspaceId}/chat?conversation=${conversation.id}`,
            metadata: { conversationId: conversation.id, addedBy: userId },
          })
        }
      } catch (err) {
        console.warn('[Chat] Group invite notification failed:', err)
      }
    }
  }

  return c.json({ data: conversation, error: null }, 201)
})

// Update conversation (rename, pin, archive)
chatRouter.patch('/conversations/:id', zValidator('json', UpdateConversationSchema), async (c) => {
  const conversationId = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId))
    .limit(1)

  if (!existing) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Conversation not found' } },
      404
    )
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (body.title !== undefined) updates.title = body.title
  if (body.status !== undefined) updates.status = body.status
  if (body.isPinned !== undefined) {
    const currentMeta = (existing.metadata ?? {}) as Record<string, unknown>
    updates.metadata = { ...currentMeta, isPinned: body.isPinned }
  }

  const [updated] = await db
    .update(chatConversations)
    .set(updates)
    .where(eq(chatConversations.id, conversationId))
    .returning()

  return c.json({ data: updated, error: null })
})

// List conversations
chatRouter.get('/conversations', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId')
  const limit = parseInt(c.req.query('limit') ?? '30', 10)
  const cursor = c.req.query('cursor') // cursor = createdAt ISO string
  const statusParam = c.req.query('status') ?? 'active' // 'active' | 'archived' | 'all'

  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId required' } },
      400
    )
  }

  // Conversations the user owns OR is a group member of
  const memberRows = await db
    .select({ conversationId: chatConversationMembers.conversationId })
    .from(chatConversationMembers)
    .where(eq(chatConversationMembers.userId, userId))
  const memberConversationIds = memberRows.map((r) => r.conversationId)

  const ownershipFilter =
    memberConversationIds.length > 0
      ? sql`(${chatConversations.userId} = ${userId} OR ${chatConversations.id} IN ${memberConversationIds})`
      : eq(chatConversations.userId, userId)

  const conditions = [eq(chatConversations.workspaceId, workspaceId), ownershipFilter]

  if (statusParam !== 'all') {
    conditions.push(eq(chatConversations.status, statusParam as 'active' | 'archived'))
  }

  if (cursor) {
    conditions.push(lt(chatConversations.createdAt, new Date(cursor)))
  }

  const conversations = await db
    .select()
    .from(chatConversations)
    .where(and(...conditions))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(limit)

  // Get last message for each conversation
  const conversationsWithPreview = await Promise.all(
    conversations.map(async (conv) => {
      const [lastMsg] = await db
        .select({
          content: chatMessages.content,
          role: chatMessages.role,
          createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conv.id))
        .orderBy(desc(chatMessages.createdAt))
        .limit(1)

      return { ...conv, lastMessage: lastMsg ?? null }
    })
  )

  return c.json({ data: conversationsWithPreview, error: null })
})

// Get conversation with messages.
// Sprint MCP-3: also returns `history`, an ordered list of {version, createdAt}
// for any prior versions stored in chat_conversation_snapshots. The frontend
// uses this to render a version chip + revision viewer.
chatRouter.get('/conversations/:id', async (c) => {
  const conversationId = c.req.param('id')

  const [conversation] = await db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId))
    .limit(1)

  if (!conversation) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Conversation not found' } },
      404
    )
  }

  const messages = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.conversationId, conversationId),
        isNull(chatMessages.parentMessageId),
        isNull(chatMessages.supersededByMessageId)
      )
    )
    .orderBy(chatMessages.createdAt)
    .limit(100)

  const history = await db
    .select({
      version: chatConversationSnapshots.version,
      createdAt: chatConversationSnapshots.createdAt,
      snapshotId: chatConversationSnapshots.id,
    })
    .from(chatConversationSnapshots)
    .where(eq(chatConversationSnapshots.conversationId, conversationId))
    .orderBy(desc(chatConversationSnapshots.version))

  return c.json({ data: { ...conversation, messages, history }, error: null })
})

// Get a single historical snapshot of a conversation (Sprint MCP-3).
chatRouter.get('/conversations/:id/history/:version', async (c) => {
  const conversationId = c.req.param('id')
  const version = parseInt(c.req.param('version') ?? '', 10)
  if (!Number.isFinite(version)) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'version must be a number' } },
      400
    )
  }
  const [snap] = await db
    .select()
    .from(chatConversationSnapshots)
    .where(
      and(
        eq(chatConversationSnapshots.conversationId, conversationId),
        eq(chatConversationSnapshots.version, version)
      )
    )
    .limit(1)
  if (!snap) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Snapshot not found' } }, 404)
  }
  return c.json({ data: snap, error: null })
})

// Delete conversation (hard delete; cascades messages and members)
chatRouter.delete('/conversations/:id', async (c) => {
  const conversationId = c.req.param('id')

  await db.delete(chatConversations).where(eq(chatConversations.id, conversationId))

  return c.json({ data: { success: true }, error: null })
})

// ─── Group conversation members ──────────────────────────────────────

chatRouter.get('/conversations/:id/members', async (c) => {
  const conversationId = c.req.param('id')

  const members = await db
    .select({
      userId: chatConversationMembers.userId,
      role: chatConversationMembers.role,
      joinedAt: chatConversationMembers.joinedAt,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(chatConversationMembers)
    .leftJoin(users, eq(chatConversationMembers.userId, users.id))
    .where(eq(chatConversationMembers.conversationId, conversationId))

  return c.json({ data: members, error: null })
})

chatRouter.post(
  '/conversations/:id/members',
  zValidator('json', z.object({ userId: z.string().uuid() })),
  async (c) => {
    const conversationId = c.req.param('id')
    const body = c.req.valid('json')

    const [conversation] = await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.id, conversationId))
      .limit(1)
    if (!conversation) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Conversation not found' } },
        404
      )
    }

    await db
      .insert(chatConversationMembers)
      .values({ conversationId, userId: body.userId, role: 'member' })
      .onConflictDoNothing()

    return c.json({ data: { success: true }, error: null }, 201)
  }
)

chatRouter.delete('/conversations/:id/members/:userId', async (c) => {
  const conversationId = c.req.param('id')
  const memberUserId = c.req.param('userId')

  await db
    .delete(chatConversationMembers)
    .where(
      and(
        eq(chatConversationMembers.conversationId, conversationId),
        eq(chatConversationMembers.userId, memberUserId)
      )
    )

  return c.json({ data: { success: true }, error: null })
})

// ─── Messages ──────────────────────────────────────────────────────

// Get messages (paginated). Filters out messages superseded by a newer
// version so the live view only shows the current revision; older versions
// are accessible via /conversations/:id/history/:version.
chatRouter.get('/conversations/:id/messages', async (c) => {
  const conversationId = c.req.param('id')
  const limit = parseInt(c.req.query('limit') ?? '50', 10)
  const cursor = c.req.query('cursor')

  const conditions = [
    eq(chatMessages.conversationId, conversationId),
    isNull(chatMessages.parentMessageId),
    isNull(chatMessages.supersededByMessageId),
  ]

  if (cursor) {
    conditions.push(lt(chatMessages.createdAt, new Date(cursor)))
  }

  const messages = await db
    .select()
    .from(chatMessages)
    .where(and(...conditions))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit)

  return c.json({ data: messages.reverse(), error: null })
})

// Send message (main endpoint — calls Claude with streaming)
chatRouter.post('/conversations/:id/messages', zValidator('json', SendMessageSchema), async (c) => {
  const userId = c.get('userId')
  const conversationId = c.req.param('id')
  const body = c.req.valid('json')

  // 1. Verify conversation exists before inserting message (prevents FK violation)
  const [conversation] = await db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId))
    .limit(1)

  if (!conversation) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Conversation not found' } },
      404
    )
  }

  // 2. Save user message
  await db.insert(chatMessages).values({
    conversationId,
    userId,
    role: 'user',
    content: body.content,
    attachments: body.attachments,
    metadata: {},
  })

  // Update AI state — chat is active (non-blocking, Sprint IX-4)
  try {
    const { updateChatState } = await import('../services/ai-state/immediate-updater')
    const workspaceId = conversation.workspaceId
    if (workspaceId) {
      await updateChatState(userId, workspaceId, conversationId, true)
    }
  } catch {
    // non-blocking
  }

  // 2b. Auto-register document as "recent" when chatting from extension on a Google Doc
  if (body.source === 'web_extension' && body.attachments?.length) {
    const docAttachment = body.attachments.find(
      (a: { type: string; metadata?: { url?: string; title?: string } }) =>
        a.metadata?.url &&
        /docs\.google\.com\/(document|spreadsheets|presentation)/.test(a.metadata.url)
    )
    if (docAttachment?.metadata?.url) {
      const workspaceId = c.get('workspaceId') as string
      if (workspaceId) {
        try {
          // Extract Google Doc ID from URL
          const urlMatch = docAttachment.metadata.url.match(/\/d\/([a-zA-Z0-9_-]+)/)
          const externalDocId = urlMatch?.[1]
          if (externalDocId) {
            const { externalDocuments } = await import('../db/schema/external-documents')
            const { ensureWorkspaceExists } = await import('./gws')

            await ensureWorkspaceExists(workspaceId, userId)

            // Check if already registered
            const [existing] = await db
              .select()
              .from(externalDocuments)
              .where(
                and(
                  eq(externalDocuments.externalDocId, externalDocId),
                  eq(externalDocuments.workspaceId, workspaceId)
                )
              )
              .limit(1)

            if (!existing) {
              // Determine doc type from URL
              const typeMatch = docAttachment.metadata.url.match(
                /\/(document|spreadsheets|presentation)\//
              )
              const docType =
                typeMatch?.[1] === 'spreadsheets'
                  ? 'google_sheets'
                  : typeMatch?.[1] === 'presentation'
                    ? 'google_slides'
                    : 'google_docs'

              await db.insert(externalDocuments).values({
                workspaceId,
                userId,
                externalDocId,
                docType,
                title: docAttachment.metadata.title || 'Untitled',
                isActive: false, // Just a "recent" — not actively tracked
                metadata: {
                  signalCount: 0,
                  lastKnownTitle: docAttachment.metadata.title || 'Untitled',
                  collaboratorCount: 0,
                  source: 'chat',
                },
              })
            } else {
              // Update last accessed time
              await db
                .update(externalDocuments)
                .set({
                  updatedAt: new Date(),
                  metadata: {
                    ...(existing.metadata as Record<string, unknown>),
                    lastKnownTitle: docAttachment.metadata.title || existing.title,
                  },
                })
                .where(eq(externalDocuments.id, existing.id))
            }
          }
        } catch (err) {
          console.warn('[Chat] Auto-register recent doc failed (non-fatal):', err)
        }
      }
    }
  }

  // 3. Update conversation updatedAt
  await db
    .update(chatConversations)
    .set({ updatedAt: new Date() })
    .where(eq(chatConversations.id, conversationId))

  // 4. Get conversation history
  const history = await db
    .select()
    .from(chatMessages)
    .where(
      and(eq(chatMessages.conversationId, conversationId), isNull(chatMessages.parentMessageId))
    )
    .orderBy(chatMessages.createdAt)
    .limit(50)

  // 5. Stream AI response via SSE
  return streamSSE(c, async (stream) => {
    const startTime = Date.now()
    let fullContent = ''
    const toolCalls: ToolCallRecord[] = []

    try {
      // Dynamic import of the agent
      const { createChatCompletion } = await import('../services/chat/completion')

      // ── Diagnostic logging for GWS edit pipeline ──
      console.info('[Chat] Message received:', {
        conversationId,
        contextObjectType: conversation.contextObjectType,
        contextObjectId: conversation.contextObjectId,
        hasDocumentContent: !!body.documentContent,
        documentContentLength: body.documentContent?.length ?? 0,
        messagePreview: body.content?.slice(0, 100),
      })

      // Extract web context from screenshot attachment metadata (for Chrome extension)
      const screenshotAttachment = body.attachments.find(
        (a: Record<string, unknown>) =>
          a.imageSource === 'screenshot' && a.metadata && typeof a.metadata === 'object'
      )
      const webContext = screenshotAttachment?.metadata
        ? {
            url: (screenshotAttachment.metadata as Record<string, string>).url,
            title: (screenshotAttachment.metadata as Record<string, string>).title,
          }
        : undefined

      const result = await createChatCompletion({
        conversation: {
          id: conversation.id,
          workspaceId: conversation.workspaceId,
          userId: conversation.userId,
          title: conversation.title,
          type: conversation.type,
          contextObjectId: conversation.contextObjectId,
          contextObjectType: conversation.contextObjectType,
        },
        messages: history.map((m) => ({
          role: m.role,
          content: m.content,
          userId: m.userId,
          metadata: m.metadata,
        })),
        attachments: body.attachments,
        userId,
        modelId: body.modelId,
        webContext,
        currentSection: body.currentSection,
        documentContent: body.documentContent,
        recentDocumentEdits: body.recentDocumentEdits,
        navContext: body.navContext,
        onToken: async (token: string) => {
          fullContent += token
          await stream.writeSSE({
            data: JSON.stringify({ type: 'token', content: token }),
            event: 'message',
          })
        },
        onToolStart: async (toolName: string) => {
          console.info(`[Chat] Tool called: ${toolName}`)
          await stream.writeSSE({
            data: JSON.stringify({ type: 'tool_start', tool: toolName }),
            event: 'message',
          })
        },
        onToolEnd: async (toolName: string, toolResult: unknown, durationMs: number) => {
          toolCalls.push({ tool: toolName, params: {}, result: toolResult, durationMs })
          await stream.writeSSE({
            data: JSON.stringify({ type: 'tool_end', tool: toolName }),
            event: 'message',
          })
          // Emit annotation data for frontend mark application
          if (
            (toolName === 'annotate_document' || toolName === 'annotate_google_doc') &&
            toolResult &&
            typeof toolResult === 'object'
          ) {
            const result = toolResult as Record<string, unknown>
            await stream.writeSSE({
              data: JSON.stringify({
                type: 'annotations',
                annotations: result.annotations,
                summary: result.summary,
                source: result.source ?? 'native',
              }),
              event: 'message',
            })
          }
          // Emit GWS action queued events so frontend/extension can react
          if (
            (toolName === 'propose_document_edit' ||
              toolName === 'edit_google_doc' ||
              toolName === 'edit_google_sheet') &&
            toolResult &&
            typeof toolResult === 'object'
          ) {
            const result = toolResult as Record<string, unknown>
            if (result.queued) {
              await stream.writeSSE({
                data: JSON.stringify({
                  type: 'gws_action_queued',
                  actionId: result.actionId,
                  message: result.message,
                }),
                event: 'message',
              })
            }
          }
          // Emit draft_preview so extension can show ghost draft inline
          if (
            (toolName === 'propose_document_edit' || toolName === 'edit_google_doc') &&
            toolResult &&
            typeof toolResult === 'object'
          ) {
            const result = toolResult as Record<string, unknown>
            const actionData = (result._actionData ?? {}) as Record<string, unknown>
            const newText = actionData.newText as string | undefined
            if (newText) {
              await stream.writeSSE({
                data: JSON.stringify({
                  type: 'draft_preview',
                  action: (actionData.action as string) ?? 'append',
                  findText: (actionData.findText as string) ?? null,
                  newText,
                  summary: (actionData.summary as string) ?? null,
                }),
                event: 'message',
              })
            }
          }
        },
        onRichContent: async (richContent: Record<string, unknown>) => {
          await stream.writeSSE({
            data: JSON.stringify({ type: 'rich_content', content: richContent }),
            event: 'message',
          })
        },
      })

      fullContent = result.content || fullContent
      const latencyMs = Date.now() - startTime

      // 6. Save assistant message
      // Sprint FE-5 (Gap 1): persist RA-2's versionCitations + agentIntent
      // into the message metadata so the FE-4 chat citation block can render
      // version pills below the response. Pulled directly off the
      // CompletionResult shape — populated by the reference agent in RA-2,
      // empty when the simple-query fast path bypassed the agent.
      const completionExtras = result as unknown as {
        versionCitations?: Array<Record<string, unknown>>
        agentIntent?: string | null
      }
      const [assistantMessage] = await db
        .insert(chatMessages)
        .values({
          conversationId,
          userId: null,
          role: 'assistant',
          content: fullContent,
          richContent: (result.richContent as Record<string, unknown>[] | null) ?? null,
          metadata: {
            model: result.model ?? 'claude-haiku-3-5-20241022',
            tokensIn: result.tokensIn ?? 0,
            tokensOut: result.tokensOut ?? 0,
            latencyMs,
            toolCalls: toolCalls as unknown as Record<string, unknown>[],
            ...(completionExtras.versionCitations && completionExtras.versionCitations.length > 0
              ? { versionCitations: completionExtras.versionCitations }
              : {}),
            ...(completionExtras.agentIntent ? { agentIntent: completionExtras.agentIntent } : {}),
          },
        })
        .returning()

      // 7. Auto-generate title for new conversations
      if (history.length <= 2 && conversation.title === 'New Chat') {
        const titleContent = body.content.slice(0, 100)
        const autoTitle =
          titleContent.length > 50 ? titleContent.slice(0, 50) + '...' : titleContent
        await db
          .update(chatConversations)
          .set({ title: autoTitle })
          .where(eq(chatConversations.id, conversationId))
      }

      // Emit sources used during this completion (retrieval results, doc sections, strand events)
      const usedSources = (
        result as unknown as { sources?: Array<{ label: string; type: string; id?: string }> }
      ).sources
      if (usedSources && usedSources.length > 0) {
        await stream.writeSSE({
          data: JSON.stringify({ type: 'sources', sources: usedSources }),
          event: 'message',
        })

        // Persist sources into message metadata so they survive reload
        if (assistantMessage?.id) {
          await db
            .update(chatMessages)
            .set({
              metadata: sql`jsonb_set(coalesce(metadata, '{}'), '{sources}', ${JSON.stringify(usedSources)}::jsonb)`,
            })
            .where(eq(chatMessages.id, assistantMessage.id))
        }
      }

      const msgId = assistantMessage?.id ?? 'unknown'
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'done',
          messageId: msgId,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
        }),
        event: 'message',
      })
    } catch (err) {
      console.error('[Chat] Completion error:', err)

      // ── Dev fallback: stream a helpful response when AI is unavailable ──
      const lastUserMsg = [...history].reverse().find((m) => m.role === 'user')
      const userText = lastUserMsg?.content ?? body.content ?? '(empty message)'
      const errMsg = err instanceof Error ? err.message : String(err)
      const errStatus = (err as { status?: number })?.status

      const hasKey = !!(process.env['OPENROUTER_API_KEY'] ?? '')
      const errorHint = hasKey
        ? 'Your API key may be invalid or expired. Check your `OPENROUTER_API_KEY`.'
        : 'Set `OPENROUTER_API_KEY` in `packages/api/.env.local`.'

      const { MODEL_TIERS } = await import('../config/models')
      const modelUsed = body.modelId ?? MODEL_TIERS.CHAT_AGENT
      const errorBlock = `\n\n**Error:** \`${errStatus ?? '???'} — ${errMsg}\`\n**Model:** \`${modelUsed}\``

      const devResponse = `**[Dev Mode — AI unavailable]**\n\nI received your message: "${userText.slice(0, 200)}"\n\n${errorHint}${errorBlock}`

      // Stream the fallback word by word
      const words = devResponse.split(' ')
      for (let i = 0; i < words.length; i++) {
        const token = (i === 0 ? '' : ' ') + words[i]
        fullContent += token
        await stream.writeSSE({
          data: JSON.stringify({ type: 'token', content: token }),
          event: 'message',
        })
      }

      // Save the fallback response as an assistant message
      const [fallbackMsg] = await db
        .insert(chatMessages)
        .values({
          conversationId,
          userId: null,
          role: 'assistant',
          content: fullContent,
          metadata: {
            model: 'dev-fallback',
            error: err instanceof Error ? err.message : 'Unknown',
          },
        })
        .returning()

      await stream.writeSSE({
        data: JSON.stringify({
          type: 'done',
          messageId: fallbackMsg?.id ?? 'fallback',
          tokensIn: 0,
          tokensOut: 0,
        }),
        event: 'message',
      })
    }
  })
})

// Thread reply
chatRouter.post(
  '/conversations/:id/messages/:messageId/thread',
  zValidator('json', ThreadReplySchema),
  async (c) => {
    const userId = c.get('userId')
    const conversationId = c.req.param('id')
    const parentMessageId = c.req.param('messageId')
    const body = c.req.valid('json')

    const [message] = await db
      .insert(chatMessages)
      .values({
        conversationId,
        userId,
        role: 'user',
        content: body.content,
        parentMessageId,
        metadata: {},
      })
      .returning()

    return c.json({ data: message, error: null }, 201)
  }
)

// Message feedback
chatRouter.post(
  '/conversations/:id/messages/:messageId/feedback',
  zValidator('json', FeedbackSchema),
  async (c) => {
    const messageId = c.req.param('messageId')
    const body = c.req.valid('json')

    await db
      .update(chatMessages)
      .set({
        metadata: sql`jsonb_set(coalesce(metadata, '{}'), '{feedback}', ${JSON.stringify(body.feedback)}::jsonb)`,
      })
      .where(eq(chatMessages.id, messageId))

    return c.json({ data: { success: true }, error: null })
  }
)

// ─── Bookmarks ─────────────────────────────────────────────────────

chatRouter.post(
  '/conversations/:id/messages/:messageId/bookmark',
  zValidator('json', BookmarkSchema),
  async (c) => {
    const userId = c.get('userId')
    const conversationId = c.req.param('id')
    const messageId = c.req.param('messageId')
    const body = c.req.valid('json')

    const [bookmark] = await db
      .insert(deepDiveBookmarks)
      .values({
        conversationId,
        messageId,
        userId,
        note: body.note ?? null,
      })
      .returning()

    return c.json({ data: bookmark, error: null }, 201)
  }
)

chatRouter.delete('/conversations/:id/bookmarks/:bookmarkId', async (c) => {
  const bookmarkId = c.req.param('bookmarkId')

  await db.delete(deepDiveBookmarks).where(eq(deepDiveBookmarks.id, bookmarkId))

  return c.json({ data: { success: true }, error: null })
})

chatRouter.get('/conversations/:id/bookmarks', async (c) => {
  const conversationId = c.req.param('id')

  const bookmarks = await db
    .select()
    .from(deepDiveBookmarks)
    .where(eq(deepDiveBookmarks.conversationId, conversationId))
    .orderBy(deepDiveBookmarks.createdAt)

  return c.json({ data: bookmarks, error: null })
})

export { chatRouter }
