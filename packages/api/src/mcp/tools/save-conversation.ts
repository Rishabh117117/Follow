/**
 * MCP Tool: save_conversation (Sprint MCP-1, idempotent rewrite Sprint MCP-3)
 *
 * Imports a conversation from an external AI tool into Follow.
 *
 * Idempotency model:
 *   - `contentHash` is computed over a normalized payload (role + content +
 *     rich_content + attachment ids + tool_calls). It captures everything the
 *     user would consider "the same conversation, semantically."
 *   - `threadHash` is a weaker signature over (first user message + first 3
 *     turns) that identifies a conversation across content edits. Stored in
 *     `metadata.threadHash` on conversations.
 *
 * Three paths:
 *   1. (workspace, user, source, contentHash) match → no-op, return existing
 *      conversation id with `updated: false`.
 *   2. metadata.threadHash match → update path: write snapshot of current
 *      state, supersede old messages via supersededByMessageId, insert new
 *      messages, bump version, refresh contentHash + title + metadata.
 *   3. No match → create path.
 *
 * Each assistant message can include a `reasoning` payload (chain-of-thought,
 * plan steps, tool calls, sources, model + token info) which lands in the
 * existing `chatMessages.metadata` jsonb column. Rich content artifacts of
 * type file_card / code_sandbox / canvas_embed are extracted to rawFiles +
 * queued for indexing so they're searchable on their own.
 */

import { createHash } from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { MCPToolDefinition, MCPToolResult, MCPSession, MCPDependencies } from '../types'
import { db } from '../../db/index'
import {
  chatConversations,
  chatMessages,
  chatConversationSnapshots,
} from '../../db/schema/chat'

// ─── Input shape ────────────────────────────────────────────────────────────

interface ToolCallInput {
  name: string
  args?: Record<string, unknown>
  result?: unknown
  duration_ms?: number
  started_at?: string
}

interface ReasoningInput {
  thinking?: string
  agent_intent?: string
  plan_steps?: string[]
  tool_calls?: ToolCallInput[]
  sources?: Array<{ label: string; type: string; id?: string }>
  model?: string
  tokens_in?: number
  tokens_out?: number
  latency_ms?: number
}

interface RichContentInput {
  type: string
  data: Record<string, unknown>
}

interface AttachmentInput {
  fileId?: string
  fileName?: string
  fileType?: string
  thumbnailUrl?: string
  imageData?: string
  imageSource?: string
  metadata?: Record<string, unknown>
}

interface MessageInput {
  role: string
  content: string
  rich_content?: RichContentInput[]
  attachments?: AttachmentInput[]
  reasoning?: ReasoningInput
}

// ─── Tool definition ───────────────────────────────────────────────────────

export const saveConversationTool: MCPToolDefinition = {
  name: 'save_conversation',
  description:
    "Save a conversation from Claude, ChatGPT, Cursor, or another AI tool into your Follow knowledge index. Re-calling with the same content is a no-op (returns the existing id); calling with edited content updates the existing conversation in place and writes the prior state to the version history. IMPORTANT: when you are continuing an ongoing chat that you already saved earlier, pass the previously-returned `conversation_id` so new turns append to the existing row instead of creating a separate conversation.",
  inputSchema: {
    type: 'object',
    properties: {
      messages: {
        type: 'array',
        description: 'Array of conversation messages to save. When appending to an existing conversation (conversation_id provided), send the FULL up-to-date transcript — the stored conversation is replaced with this set and prior state is kept in version history.',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['user', 'assistant', 'system'] },
            content: { type: 'string' },
            rich_content: {
              type: 'array',
              description:
                'Optional rich content blocks attached to this message (charts, tables, file cards, code sandboxes, canvas embeds, etc.)',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  data: { type: 'object', additionalProperties: true },
                },
                required: ['type'],
                additionalProperties: true,
              },
            },
            attachments: {
              type: 'array',
              description: 'Optional file attachments associated with this message',
              items: {
                type: 'object',
                properties: {
                  fileId: { type: 'string' },
                  fileName: { type: 'string' },
                  fileType: { type: 'string' },
                  thumbnailUrl: { type: 'string' },
                  imageData: { type: 'string' },
                  imageSource: { type: 'string' },
                  metadata: { type: 'object', additionalProperties: true },
                },
                additionalProperties: true,
              },
            },
            reasoning: {
              type: 'object',
              description:
                "Optional reasoning trail for assistant turns. Captures chain-of-thought, planner steps, tool invocations, retrieved sources, and model/token/latency info. Lands in the message's metadata column.",
              properties: {
                thinking: { type: 'string' },
                agent_intent: { type: 'string' },
                plan_steps: { type: 'array', items: { type: 'string' } },
                tool_calls: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      args: { type: 'object', additionalProperties: true },
                      result: {},
                      duration_ms: { type: 'number' },
                      started_at: { type: 'string' },
                    },
                    required: ['name'],
                    additionalProperties: true,
                  },
                },
                sources: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      type: { type: 'string' },
                      id: { type: 'string' },
                    },
                    required: ['label', 'type'],
                    additionalProperties: true,
                  },
                },
                model: { type: 'string' },
                tokens_in: { type: 'number' },
                tokens_out: { type: 'number' },
                latency_ms: { type: 'number' },
              },
              additionalProperties: true,
            },
          },
          required: ['role', 'content'],
        },
      },
      source_type: {
        type: 'string',
        enum: ['claude', 'chatgpt', 'cursor', 'custom'],
        description: 'Which AI tool this conversation is from',
      },
      title: { type: 'string', description: 'Optional title for the conversation' },
      save_to: {
        type: 'string',
        enum: ['personal', 'project', 'both'],
        description: "Where to save. 'project' requires active scope. Default: 'personal'",
      },
      conversation_id: {
        type: 'string',
        description:
          'Optional. The conversation id returned by a previous save_conversation call. When provided, new messages are appended to that conversation (version bump + snapshot of prior state) regardless of whether the first user turn matches. Use this to keep a growing chat as one row instead of creating a new one per save.',
      },
    },
    required: ['messages', 'source_type'],
  },
  handler: saveConversationHandler,
}

// ─── Hashing ────────────────────────────────────────────────────────────────

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function normalizeMessageForHash(msg: MessageInput): unknown {
  return {
    role: msg.role,
    content: (msg.content ?? '').trim(),
    rich: (msg.rich_content ?? []).map((r) => ({ type: r.type, data: r.data })),
    attach: (msg.attachments ?? []).map((a) => a.fileId ?? a.fileName ?? a.thumbnailUrl ?? null),
    tools: (msg.reasoning?.tool_calls ?? []).map((t) => ({
      name: t.name,
      args: t.args ?? null,
    })),
  }
}

function computeContentHash(messages: MessageInput[]): string {
  return sha256(JSON.stringify(messages.map(normalizeMessageForHash)))
}

/**
 * Weaker signature: identifies "the same thread" across content edits.
 * Built from the FIRST user turn only. Assistant outputs are deliberately
 * excluded (same prompt can produce different responses each run), and
 * later user turns are excluded so appending a follow-up still resolves
 * to the same thread instead of starting a fresh one.
 *
 * Collision risk: two genuinely-different conversations that happen to
 * open with the same first user message will be merged. This is acceptable
 * because the user pick was "content hash only" dedup without an external
 * id; the first-user-turn is the strongest stable anchor available.
 */
function computeThreadHash(messages: MessageInput[]): string {
  const firstUser = messages.find((m) => m.role === 'user')?.content?.trim() ?? ''
  return sha256(firstUser)
}

// ─── Mapping ────────────────────────────────────────────────────────────────

function buildMessageMetadata(msg: MessageInput, orderIndex: number): Record<string, unknown> {
  const base: Record<string, unknown> = { orderIndex }
  // The schema description uses prose like "chain-of-thought" and "tool
  // invocations", which leads clients (Claude in particular) to send those
  // exact field names instead of the typed `thinking` / `tool_calls`. Accept
  // both so the data actually lands in the DB either way.
  const r = (msg.reasoning ?? {}) as ReasoningInput & Record<string, unknown>
  const thinking = (r.thinking ?? (r['chain_of_thought'] as string | undefined)) || null
  const agentIntent = (r.agent_intent ?? (r['intent'] as string | undefined)) || null
  const planSteps =
    (r.plan_steps ?? (r['plan'] as string[] | undefined) ?? []) as string[]
  const toolCalls =
    (r.tool_calls ??
      (r['tool_invocations'] as typeof r.tool_calls) ??
      []) as ToolCallInput[]
  const rawSources =
    (r.sources ?? (r['citations'] as typeof r.sources) ?? []) as unknown[]
  const model = r.model || (r['model_id'] as string | undefined) || null
  const tokensIn =
    (typeof r.tokens_in === 'number' ? r.tokens_in : undefined) ??
    (typeof r['input_tokens'] === 'number' ? (r['input_tokens'] as number) : undefined)
  const tokensOut =
    (typeof r.tokens_out === 'number' ? r.tokens_out : undefined) ??
    (typeof r['output_tokens'] === 'number' ? (r['output_tokens'] as number) : undefined)
  const latencyMs =
    (typeof r.latency_ms === 'number' ? r.latency_ms : undefined) ??
    (typeof r['latency'] === 'number' ? (r['latency'] as number) : undefined)

  if (thinking) base.thinking = thinking
  if (agentIntent) base.agentIntent = agentIntent
  if (planSteps.length > 0) base.planSteps = planSteps
  if (toolCalls.length > 0) {
    base.toolCalls = toolCalls.map((t) => ({
      name: t.name,
      args: t.args ?? {},
      result: t.result,
      durationMs: t.duration_ms ?? 0,
      startedAt: t.started_at,
    }))
  }
  if (rawSources.length > 0) base.sources = normalizeSources(rawSources)
  if (model) base.model = model
  if (typeof tokensIn === 'number') base.tokensIn = tokensIn
  if (typeof tokensOut === 'number') base.tokensOut = tokensOut
  if (typeof latencyMs === 'number') base.latencyMs = latencyMs
  return base
}

/**
 * Coerce whatever a client sent in `reasoning.sources` into the canonical
 * `{label, type, id?}` shape. Seen in the wild: plain strings ("Follow docs"),
 * {title, url} objects from OpenAI-style citations, {name, kind} from ad-hoc
 * clients. We extract the best human label and type we can and drop the rest.
 */
function normalizeSources(input: unknown[]): Array<{ label: string; type: string; id?: string }> {
  return input
    .map((s): { label: string; type: string; id?: string } | null => {
      if (typeof s === 'string') {
        const trimmed = s.trim()
        if (!trimmed) return null
        const isUrl = /^https?:\/\//i.test(trimmed)
        return { label: trimmed, type: isUrl ? 'url' : 'text' }
      }
      if (s && typeof s === 'object') {
        const o = s as Record<string, unknown>
        const label =
          (o['label'] as string) ||
          (o['title'] as string) ||
          (o['name'] as string) ||
          (o['url'] as string) ||
          (o['id'] as string) ||
          ''
        if (!label) return null
        const type =
          (o['type'] as string) ||
          (o['kind'] as string) ||
          (typeof o['url'] === 'string' ? 'url' : 'text')
        const id = typeof o['id'] === 'string' ? (o['id'] as string) : undefined
        return id ? { label, type, id } : { label, type }
      }
      return null
    })
    .filter((s): s is { label: string; type: string; id?: string } => s !== null)
}

// ─── Artifact extraction ───────────────────────────────────────────────────

interface ExtractedArtifact {
  rawFileId: string
  blockType: string
}

const ARTIFACT_TYPES = new Set(['file_card', 'code_sandbox', 'canvas_embed'])

function pickArtifactBody(block: RichContentInput): { name: string; mime: string; body: string } | null {
  const data = block.data ?? {}
  if (block.type === 'code_sandbox') {
    const code = (data.code as string) ?? (data.source as string) ?? null
    if (!code) return null
    const lang = (data.language as string) ?? 'plaintext'
    const name = (data.title as string) ?? `code-${lang}.txt`
    const mime = 'text/plain'
    return { name, mime, body: code }
  }
  if (block.type === 'file_card') {
    const text = (data.text as string) ?? (data.preview as string) ?? null
    if (!text) return null
    const name = (data.name as string) ?? (data.title as string) ?? 'attachment.txt'
    const mime = (data.mimeType as string) ?? 'text/plain'
    return { name, mime, body: text }
  }
  if (block.type === 'canvas_embed') {
    const json = JSON.stringify(data, null, 2)
    const name = (data.title as string) ?? 'canvas-embed.json'
    return { name, mime: 'application/json', body: json }
  }
  return null
}

async function extractArtifacts(params: {
  userId: string
  workspaceId: string
  conversationId: string
  messages: MessageInput[]
}): Promise<Record<number, ExtractedArtifact[]>> {
  const out: Record<number, ExtractedArtifact[]> = {}
  let storeRawFile: typeof import('../../services/raw-file-store').storeRawFile | null = null
  let queueFileIndex: typeof import('../../services/indexing/file-indexer').queueFileIndex | null = null
  try {
    ;({ storeRawFile } = await import('../../services/raw-file-store'))
    ;({ queueFileIndex } = await import('../../services/indexing/file-indexer'))
  } catch (err) {
    console.warn('[save_conversation] artifact store unavailable, skipping extraction:', err)
    return out
  }

  for (let i = 0; i < params.messages.length; i++) {
    const msg = params.messages[i]
    const blocks = msg?.rich_content ?? []
    for (const block of blocks) {
      if (!ARTIFACT_TYPES.has(block.type)) continue
      const picked = pickArtifactBody(block)
      if (!picked) continue
      try {
        const record = await storeRawFile({
          userId: params.userId,
          workspaceId: params.workspaceId,
          fileName: picked.name,
          mimeType: picked.mime,
          content: Buffer.from(picked.body, 'utf-8'),
          sourceType: 'chat_artifact',
          sourceRef: `conversation:${params.conversationId}:msg:${i}`,
        })
        ;(out[i] ??= []).push({ rawFileId: record.id, blockType: block.type })
        if (record.extractedText && record.extractedText.length > 0) {
          try {
            queueFileIndex({
              fileId: record.id,
              workspaceId: params.workspaceId,
              content: record.extractedText,
              isNew: record.version === 1,
              // MCP save_conversation is an explicit ingestion path — not
              // subject to the user's auto-index toggle.
              bypassAutoIndex: true,
            })
          } catch {
            /* non-fatal */
          }
        }
      } catch (err) {
        console.warn('[save_conversation] artifact extraction failed for block', block.type, err)
      }
    }
  }
  return out
}

// ─── Handler ────────────────────────────────────────────────────────────────

async function saveConversationHandler(
  params: Record<string, unknown>,
  session: MCPSession,
  _deps: MCPDependencies
): Promise<MCPToolResult> {
  const messages = params.messages as MessageInput[] | undefined
  const sourceType = params.source_type as string
  const title = (params.title as string) ?? `${sourceType} conversation`
  const saveTo = (params.save_to as string) ?? 'personal'

  if (!messages || messages.length === 0) {
    return {
      content: [{ type: 'text', text: 'Error: messages array is required and must not be empty.' }],
      isError: true,
    }
  }

  for (const msg of messages) {
    if (!msg.role || typeof msg.content !== 'string') {
      return {
        content: [
          { type: 'text', text: 'Error: each message must have role and content fields.' },
        ],
        isError: true,
      }
    }
  }

  if ((saveTo === 'project' || saveTo === 'both') && !session.activeProjectId) {
    return {
      content: [
        {
          type: 'text',
          text: "Error: No project scope is active. Call set_scope first to activate a project, or use save_to='personal'.",
        },
      ],
      isError: true,
    }
  }

  const workspaceId =
    saveTo === 'project' && session.activeProjectId
      ? session.activeProjectId
      : session.workspaceId

  const contentHash = computeContentHash(messages)
  const threadHash = computeThreadHash(messages)
  const explicitConversationId =
    typeof params.conversation_id === 'string' && params.conversation_id.trim().length > 0
      ? params.conversation_id.trim()
      : null

  try {
    // ── Path 0: explicit conversation_id → always update in place ───────
    // Claude passes this when continuing an ongoing chat so the new turns
    // land on the same row instead of creating a sibling conversation.
    if (explicitConversationId) {
      const [existing] = await db
        .select()
        .from(chatConversations)
        .where(
          and(
            eq(chatConversations.id, explicitConversationId),
            eq(chatConversations.userId, session.userId)
          )
        )
        .limit(1)
      if (existing) {
        // Short-circuit the no-op case so we don't needlessly bump version.
        if (existing.contentHash === contentHash) {
          return {
            content: [
              {
                type: 'text',
                text: `No-op: conversation_id ${existing.id} already matches this exact content at version ${existing.version}.`,
              },
            ],
          }
        }
        return await updateConversationInPlace({
          conversation: existing,
          messages,
          contentHash,
          threadHash,
          title,
          sourceType,
          userId: session.userId,
          workspaceId: existing.workspaceId,
        })
      }
      // Fall through if the id was wrong — don't silently create a dupe;
      // surface the mismatch so Claude can correct it.
      return {
        content: [
          {
            type: 'text',
            text: `Error: conversation_id ${explicitConversationId} not found for this user. Drop conversation_id to create a new conversation, or pass the correct id.`,
          },
        ],
        isError: true,
      }
    }

    // ── Path 1: identical-content match → no-op ────────────────────────
    const [exact] = await db
      .select()
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.workspaceId, workspaceId),
          eq(chatConversations.userId, session.userId),
          eq(chatConversations.chatSourceType, sourceType),
          eq(chatConversations.contentHash, contentHash)
        )
      )
      .limit(1)

    if (exact) {
      return {
        content: [
          {
            type: 'text',
            text: `No-op: this exact conversation is already saved as "${exact.title}" (id: ${exact.id}, version ${exact.version}). Nothing to do.`,
          },
        ],
      }
    }

    // ── Path 2: same thread, different content → update in place ────────
    const candidates = await db
      .select()
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.workspaceId, workspaceId),
          eq(chatConversations.userId, session.userId),
          eq(chatConversations.chatSourceType, sourceType)
        )
      )
    const sameThread = candidates.find(
      (c) => (c.metadata as { threadHash?: string } | null)?.threadHash === threadHash
    )

    if (sameThread) {
      return await updateConversationInPlace({
        conversation: sameThread,
        messages,
        contentHash,
        threadHash,
        title,
        sourceType,
        userId: session.userId,
        workspaceId,
      })
    }

    // ── Path 3: brand new ───────────────────────────────────────────────
    // Set spaceId explicitly when saving to a project scope. Without this,
    // chat_conversations.space_id stays null and the project index's
    // counts/queries that filter by space_id don't pick up the row.
    const spaceId =
      saveTo === 'project' && session.activeProjectId ? session.activeProjectId : null
    return await createConversation({
      messages,
      contentHash,
      threadHash,
      title,
      sourceType,
      userId: session.userId,
      workspaceId,
      spaceId,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return {
      content: [{ type: 'text', text: `Failed to save conversation: ${message}` }],
      isError: true,
    }
  }
}

// ─── Create path ───────────────────────────────────────────────────────────

interface ConversationRow {
  id: string
  title: string
  version: number
  metadata: Record<string, unknown> | null
  workspaceId: string
  userId: string
}

async function createConversation(params: {
  messages: MessageInput[]
  contentHash: string
  threadHash: string
  title: string
  sourceType: string
  userId: string
  workspaceId: string
  spaceId: string | null
}): Promise<MCPToolResult> {
  const [conversation] = await db
    .insert(chatConversations)
    .values({
      workspaceId: params.workspaceId,
      spaceId: params.spaceId,
      userId: params.userId,
      title: params.title,
      type: 'standard',
      chatSourceType: params.sourceType,
      contentHash: params.contentHash,
      version: 1,
      metadata: {
        importedVia: 'mcp',
        originalMessageCount: params.messages.length,
        threadHash: params.threadHash,
      },
    })
    .returning()

  if (!conversation) {
    return {
      content: [{ type: 'text', text: 'Error: Failed to create conversation record.' }],
      isError: true,
    }
  }

  const artifacts = await extractArtifacts({
    userId: params.userId,
    workspaceId: params.workspaceId,
    conversationId: conversation.id,
    messages: params.messages,
  })

  await insertMessages({
    conversationId: conversation.id,
    userId: params.userId,
    messages: params.messages,
    artifacts,
  })

  triggerIndexing(conversation.id, params.workspaceId, params.userId, params.messages).catch(
    (err) => console.warn('[save_conversation] background indexing failed:', err)
  )

  return {
    content: [
      {
        type: 'text',
        text: `Saved ${params.messages.length} messages from ${params.sourceType} as "${params.title}" (id: ${conversation.id}, version 1). Intelligence pipeline running in the background.`,
      },
    ],
  }
}

// ─── Update path ───────────────────────────────────────────────────────────

async function updateConversationInPlace(params: {
  conversation: typeof chatConversations.$inferSelect
  messages: MessageInput[]
  contentHash: string
  threadHash: string
  title: string
  sourceType: string
  userId: string
  workspaceId: string
}): Promise<MCPToolResult> {
  const conv = params.conversation

  // Fetch the current live messages so we can snapshot them and chain
  // supersede pointers from old → new.
  const currentMessages = await db
    .select()
    .from(chatMessages)
    .where(
      and(eq(chatMessages.conversationId, conv.id), isNull(chatMessages.supersededByMessageId))
    )
    .orderBy(chatMessages.createdAt)

  // Snapshot the OLD state at its current version (so the history viewer
  // can render version N exactly as it was).
  await db.insert(chatConversationSnapshots).values({
    conversationId: conv.id,
    version: conv.version,
    title: conv.title,
    messagesJson: currentMessages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      richContent: m.richContent,
      attachments: m.attachments,
      metadata: m.metadata,
      createdAt: m.createdAt,
    })) as Record<string, unknown>[],
    contentHash: conv.contentHash ?? 'unknown',
  })

  const nextVersion = conv.version + 1

  const artifacts = await extractArtifacts({
    userId: params.userId,
    workspaceId: params.workspaceId,
    conversationId: conv.id,
    messages: params.messages,
  })

  // Insert the new messages so we have their ids; then chain old → new by
  // index. Old messages get supersededByMessageId set to the new message
  // at the same position (or to the last new message if shorter).
  const insertedNew = await insertMessages({
    conversationId: conv.id,
    userId: params.userId,
    messages: params.messages,
    artifacts,
  })

  if (currentMessages.length > 0 && insertedNew.length > 0) {
    const lastNewId = insertedNew[insertedNew.length - 1]!.id
    for (let i = 0; i < currentMessages.length; i++) {
      const old = currentMessages[i]!
      const replacement = insertedNew[i] ?? insertedNew[insertedNew.length - 1]!
      const supersedeId = replacement?.id ?? lastNewId
      await db
        .update(chatMessages)
        .set({ supersededByMessageId: supersedeId })
        .where(eq(chatMessages.id, old.id))
    }
  }

  // Update the conversation header.
  const nextMetadata = {
    ...((conv.metadata as Record<string, unknown> | null) ?? {}),
    threadHash: params.threadHash,
    importedVia: 'mcp',
    originalMessageCount: params.messages.length,
    lastUpdatedAt: new Date().toISOString(),
  }

  await db
    .update(chatConversations)
    .set({
      title: params.title,
      contentHash: params.contentHash,
      version: nextVersion,
      metadata: nextMetadata,
      updatedAt: new Date(),
    })
    .where(eq(chatConversations.id, conv.id))

  triggerIndexing(conv.id, params.workspaceId, params.userId, params.messages).catch((err) =>
    console.warn('[save_conversation] background indexing failed:', err)
  )

  return {
    content: [
      {
        type: 'text',
        text: `Updated existing conversation "${params.title}" (id: ${conv.id}). Bumped to version ${nextVersion}; previous version ${conv.version} preserved in history.`,
      },
    ],
  }
}

// ─── Insert helper ──────────────────────────────────────────────────────────

async function insertMessages(params: {
  conversationId: string
  userId: string
  messages: MessageInput[]
  artifacts: Record<number, ExtractedArtifact[]>
}): Promise<Array<{ id: string }>> {
  if (params.messages.length === 0) return []

  const values = params.messages.map((msg, idx) => {
    const meta = buildMessageMetadata(msg, idx)
    const artifactsForMsg = params.artifacts[idx]
    if (artifactsForMsg && artifactsForMsg.length > 0) {
      meta.artifactIds = artifactsForMsg.map((a) => a.rawFileId)
    }
    return {
      conversationId: params.conversationId,
      userId: msg.role === 'user' ? params.userId : null,
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
      richContent:
        msg.rich_content && msg.rich_content.length > 0
          ? (msg.rich_content as unknown as Record<string, unknown>[])
          : null,
      attachments: (msg.attachments ?? []) as unknown as Record<string, unknown>[],
      metadata: meta,
    }
  })

  const inserted = await db.insert(chatMessages).values(values).returning({ id: chatMessages.id })
  return inserted
}

// ─── Background indexing (unchanged thread-event pipeline) ─────────────────

async function triggerIndexing(
  conversationId: string,
  workspaceId: string,
  userId: string,
  messages: MessageInput[]
): Promise<void> {
  try {
    const { indexThreadEvents } = await import('../../services/indexing/thread-event-indexer')

    const events = messages
      .filter((m) => (m.content ?? '').trim().length > 0)
      .map((msg, idx) => ({
        id: `mcp-${conversationId}-${idx}`,
        threadId: conversationId,
        workspaceId,
        label: msg.content.slice(0, 500),
        contextNotes: `${msg.role} message from MCP-imported conversation`,
        type: msg.role === 'assistant' ? 'ai_response' : 'user_prompt',
        magnitude: 'medium',
      }))

    if (events.length > 0) {
      await indexThreadEvents(events)
    }
  } catch (err) {
    console.warn('[save_conversation] thread event indexing failed:', err)
  }

  // Refresh the chat_artifact raw_file wrapper + requeue it. This is the
  // same path the "Index" button triggers: storeRawFile upserts by content
  // hash, queueFileIndex runs chunking/enriching/embedding, and the post-
  // index hook fires chat-fact-extractor to keep index_records current.
  // Without this, save_conversation updates the DB but the wrapper stays
  // stale — the UI badge keeps reading the old wrapper's status and the
  // semantic index never sees the new messages.
  try {
    await syncConversationWrapper({ conversationId, workspaceId, userId, messages })
  } catch (err) {
    console.warn('[save_conversation] wrapper sync + requeue failed:', err)
  }
}

async function syncConversationWrapper(params: {
  conversationId: string
  workspaceId: string
  userId: string
  messages: MessageInput[]
}): Promise<void> {
  const transcript = params.messages
    .filter((m) => (m.content ?? '').trim().length > 0)
    .map((m) => `[${m.role}] ${m.content}`)
    .join('\n\n')
  if (transcript.length === 0) return

  const { storeRawFile } = await import('../../services/raw-file-store')
  const { queueFileIndex } = await import('../../services/indexing/file-indexer')

  // storeRawFile dedups by content hash: identical payload → returns the
  // existing row and increments nothing; changed content → new version.
  const wrapped = await storeRawFile({
    userId: params.userId,
    workspaceId: params.workspaceId,
    fileName: `conversation-${params.conversationId}.txt`,
    mimeType: 'text/plain',
    content: Buffer.from(transcript, 'utf-8'),
    sourceType: 'chat_artifact',
    sourceRef: params.conversationId,
  })

  if (!wrapped.extractedText || wrapped.extractedText.length === 0) return
  queueFileIndex({
    fileId: wrapped.id,
    workspaceId: params.workspaceId,
    content: wrapped.extractedText,
    // If version > 1 the content changed — treat as a full re-index so
    // chunks + embeddings + index_records all get replaced cleanly.
    isNew: wrapped.version === 1,
    fileName: wrapped.fileName,
    fileSize: wrapped.fileSize,
    filePath: wrapped.filePath,
    // save_conversation is an explicit user-driven ingestion; honor it
    // even if the global auto-index toggle is off.
    bypassAutoIndex: true,
  })
}

