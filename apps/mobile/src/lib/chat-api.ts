import { apiRequest, streamSse, type SseEvent } from './api'

// ─── Types ──────────────────────────────────────────────────────────
// Mirrors the backend shapes in packages/api/src/routes/chat.ts without
// importing server-only code. Fields we don't use are typed as unknown.

export type BackendConversationType =
  | 'standard'
  | 'deep_dive'
  | 'agent_initiated'
  | 'capture_ask'
  | 'group'

export type Conversation = {
  id: string
  workspaceId: string
  userId: string
  spaceId: string | null
  title: string | null
  type: BackendConversationType
  status: 'active' | 'archived'
  contextObjectId: string | null
  contextObjectType: string | null
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown> | null
  lastMessage?: {
    content: string
    role: 'user' | 'assistant' | 'system' | 'tool'
    createdAt: string
  } | null
}

export type Message = {
  id: string
  conversationId: string
  userId: string | null
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  createdAt: string
  metadata?: Record<string, unknown> | null
}

// ─── Conversations ──────────────────────────────────────────────────

export function listConversations(params: {
  workspaceId: string
  status?: 'active' | 'archived' | 'all'
  signal?: AbortSignal
}): Promise<Conversation[]> {
  const qs = new URLSearchParams({ workspaceId: params.workspaceId })
  if (params.status) qs.set('status', params.status)
  return apiRequest<Conversation[]>(`/api/chat/conversations?${qs.toString()}`, {
    signal: params.signal,
  })
}

export function getConversation(
  id: string,
  signal?: AbortSignal,
): Promise<Conversation & { messages: Message[] }> {
  return apiRequest(`/api/chat/conversations/${id}`, { signal })
}

export function listMessages(
  conversationId: string,
  signal?: AbortSignal,
): Promise<Message[]> {
  return apiRequest(`/api/chat/conversations/${conversationId}/messages`, { signal })
}

export function createConversation(body: {
  workspaceId: string
  type?: BackendConversationType
  title?: string
  contextObjectId?: string
  contextObjectType?: string
  memberIds?: string[]
  spaceId?: string
}): Promise<Conversation> {
  return apiRequest(`/api/chat/conversations`, {
    method: 'POST',
    body: { type: 'standard', ...body },
  })
}

// ─── Streaming message send ─────────────────────────────────────────

export type ChatStreamEvent =
  | { type: 'token'; content: string }
  | { type: 'tool_start'; tool: string }
  | { type: 'tool_end'; tool: string }
  | { type: 'nav_intent'; navIntent: Record<string, unknown> }
  | { type: 'done'; messageId?: string }
  | { type: 'error'; message: string }
  | { type: 'other'; raw: unknown }

export function sendMessage(params: {
  conversationId: string
  content: string
  modelId?: string
  signal?: AbortSignal
  onEvent: (event: ChatStreamEvent) => void
}): Promise<void> {
  return streamSse(`/api/chat/conversations/${params.conversationId}/messages`, {
    body: {
      content: params.content,
      modelId: params.modelId,
      attachments: [],
    },
    signal: params.signal,
    onEvent: (e: SseEvent) => {
      try {
        const parsed = JSON.parse(e.data) as Record<string, unknown>
        const type = parsed.type as string | undefined
        if (
          type === 'token' ||
          type === 'tool_start' ||
          type === 'tool_end' ||
          type === 'nav_intent' ||
          type === 'done' ||
          type === 'error'
        ) {
          params.onEvent(parsed as ChatStreamEvent)
        } else {
          params.onEvent({ type: 'other', raw: parsed })
        }
      } catch {
        // Non-JSON data line — ignore
      }
    },
  })
}

// ─── Derived UI badge type ──────────────────────────────────────────

export type UiChatType = 'chat' | 'doc' | 'group' | 'project'

/** Maps a backend conversation to the badge shown in the mobile chat list. */
export function uiTypeFor(conv: Pick<Conversation, 'type' | 'contextObjectType' | 'spaceId'>): UiChatType {
  if (conv.type === 'group') return 'group'
  if (conv.contextObjectType === 'document' || conv.contextObjectType === 'file') return 'doc'
  if (conv.contextObjectType === 'space' || conv.spaceId) return 'project'
  return 'chat'
}
