'use client'

/**
 * GroupChatPanel — multiplayer chat interface for group threads.
 *
 * Shows messages from multiple participants with colored avatars,
 * @Follow AI mention support for triggering AI responses,
 * online member presence indicator, and WebSocket readiness.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import {
  useGroupThreadStore,
  hasMention,
  getMemberColor,
  getInitials,
  type GroupMessage,
  type GroupMember,
} from '@/stores/group-thread-store'
import { useSSEChat } from '@/hooks/use-sse-chat'
import { useGroupPresence } from '@/hooks/use-group-presence'
import { MentionInput } from '@/components/follow/common/mention-input'
import { GroupMembersDropdown } from './group-members-dropdown'
import type { ChatMessage as ChatMessageType } from '@workspace/shared/types'

interface ConversationMemberRow {
  userId: string
  role: 'owner' | 'member'
  name: string | null
  email: string | null
  avatarUrl: string | null
}

interface GroupChatPanelProps {
  threadId: string
  workspaceId: string
  currentUserId: string
  currentUserName: string
}

export function GroupChatPanel({
  threadId,
  workspaceId,
  currentUserId,
  currentUserName,
}: GroupChatPanelProps) {
  const { aiResponding, setAIResponding, setMembers, updateMemberOnline } = useGroupThreadStore()

  const [inputValue, setInputValue] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // ─── Persisted messages from the API ───
  const { data: messagesData, refetch: refetchMessages } = useQuery({
    queryKey: ['group-messages', threadId],
    queryFn: () => api.get<ChatMessageType[]>(`/api/chat/conversations/${threadId}/messages`),
    enabled: !!threadId,
    // WS notifies us when new messages arrive; keep a slow poll as a safety net
    refetchInterval: 30_000,
  })
  const persisted = messagesData?.data ?? []

  // ─── Conversation members ───
  const { data: memberData } = useQuery({
    queryKey: ['group-members', threadId],
    queryFn: () => api.get<ConversationMemberRow[]>(`/api/chat/conversations/${threadId}/members`),
    enabled: !!threadId,
  })
  const conversationMembers = memberData?.data ?? []

  // ─── Real-time presence + typing via WebSocket ───
  const { online, typingUsers, emitTyping, emitMessageSent } = useGroupPresence({
    conversationId: threadId,
    workspaceId,
    userId: currentUserId,
    userName: currentUserName,
    onMessageSent: () => void refetchMessages(),
  })

  // Sync members into the local store so colored avatars/online state work.
  // Online state comes from the live WS roster (`online`).
  useEffect(() => {
    const mapped: GroupMember[] = conversationMembers.map((m) => ({
      id: m.userId,
      name: m.name ?? m.email ?? 'Unknown',
      avatar: getInitials(m.name ?? m.email ?? '?'),
      color: getMemberColor(m.userId),
      isOnline: online.has(m.userId) || m.userId === currentUserId,
    }))
    setMembers(mapped)
  }, [conversationMembers, currentUserId, online, setMembers])

  // Keep store online flags in sync as roster changes after the initial render
  useEffect(() => {
    for (const m of conversationMembers) {
      updateMemberOnline(m.userId, online.has(m.userId) || m.userId === currentUserId)
    }
  }, [online, conversationMembers, currentUserId, updateMemberOnline])

  // SSE for AI responses when @Follow is mentioned + for persisting user messages
  const {
    messages: sseMessages,
    streamingContent: aiStreamContent,
    isStreaming: aiStreaming,
    sendMessage: sendAIMessage,
    stopStreaming: stopAI,
    setMessages: setSSEMessages,
  } = useSSEChat({
    conversationId: threadId,
    workspaceId,
    onDone: () => {
      setAIResponding(false)
      void refetchMessages()
      emitMessageSent()
    },
  })

  // Hydrate the SSE hook's local message buffer with persisted messages
  useEffect(() => {
    setSSEMessages(persisted)
  }, [messagesData?.data])

  // Convert API messages → GroupMessage rendering shape
  const messages: GroupMessage[] = sseMessages.map((m) => {
    const isAI = m.role === 'assistant'
    const sender = conversationMembers.find((mb) => mb.userId === m.userId)
    return {
      id: m.id,
      threadId,
      senderId: m.userId ?? 'ai',
      senderName: isAI ? 'Follow AI' : (sender?.name ?? 'Unknown'),
      content: m.content,
      isAI,
      mentionTrigger:
        ((m.metadata as Record<string, unknown> | undefined)?.['mentionTrigger'] as
          | string
          | null
          | undefined) ?? null,
      createdAt:
        typeof m.createdAt === 'string' ? m.createdAt : (m.createdAt as Date).toISOString(),
    }
  })

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, aiStreamContent])

  const handleSend = useCallback(() => {
    if (!inputValue.trim()) return
    const text = inputValue
    setInputValue('')
    if (hasMention(text)) {
      setAIResponding(true)
    }
    // sendAIMessage POSTs to /api/chat/conversations/:id/messages — that
    // persists the user message and streams the assistant response. The
    // mention is included so the backend system prompt can see it.
    sendAIMessage(text)
    // Notify the rest of the room so they refetch immediately.
    emitMessageSent()
  }, [inputValue, sendAIMessage, setAIResponding, emitMessageSent])

  const handleInputChange = useCallback(
    (val: string) => {
      setInputValue(val)
      if (val.trim()) emitTyping()
    },
    [emitTyping]
  )

  const onlineMembers = useGroupThreadStore((s) => s.members.filter((m) => m.isOnline))
  const members = useGroupThreadStore((s) => s.members)

  return (
    <div className="flex h-full flex-col" data-testid="group-chat-panel">
      {/* Header with member presence */}
      <div
        className="relative flex items-center justify-between px-3 py-2"
        style={{ borderBottom: '1px solid var(--n150)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: 'var(--n600)' }}>
            👥 Group Thread
          </span>
          {online.size > 0 && (
            <span
              className="rounded px-1 py-0.5 text-[9px] font-medium"
              style={{ background: '#DCFCE7', color: '#166534' }}
            >
              {onlineMembers.length} online
            </span>
          )}
        </div>

        {/* Online presence dots — click to open the member dropdown */}
        <button
          onClick={() => setShowMembers((v) => !v)}
          className="flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors hover:bg-[var(--n100)]"
          title="Members"
        >
          {onlineMembers.slice(0, 4).map((member) => (
            <div
              key={member.id}
              className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold text-white"
              style={{ background: member.color }}
            >
              {member.avatar}
            </div>
          ))}
          {onlineMembers.length > 4 && (
            <span className="text-[10px]" style={{ color: 'var(--n400)' }}>
              +{onlineMembers.length - 4}
            </span>
          )}
          {members.length > 0 && (
            <span className="ml-1 text-[10px]" style={{ color: 'var(--n400)' }}>
              {onlineMembers.length}/{members.length}
            </span>
          )}
        </button>

        {showMembers && (
          <GroupMembersDropdown
            conversationId={threadId}
            workspaceId={workspaceId}
            currentUserId={currentUserId}
            members={conversationMembers}
            onlineIds={online}
            onClose={() => setShowMembers(false)}
            onChanged={() => {
              setShowMembers(false)
            }}
          />
        )}
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-auto p-3">
        <div className="space-y-3">
          {messages.map((msg) => (
            <GroupMessageBubble
              key={msg.id}
              message={msg}
              isCurrentUser={msg.senderId === currentUserId}
              members={members}
            />
          ))}

          {/* AI streaming indicator */}
          {(aiResponding || aiStreaming) && (
            <div className="flex gap-2">
              <div
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ background: 'var(--ai)' }}
              >
                F
              </div>
              <div
                className="max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed"
                style={{ background: 'var(--aiS)', color: 'var(--n800)' }}
              >
                {aiStreamContent ? (
                  <span className="whitespace-pre-wrap">{aiStreamContent}</span>
                ) : (
                  <span className="flex items-center gap-1" style={{ color: 'var(--ai)' }}>
                    <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
                    Follow is thinking…
                  </span>
                )}
                <span
                  className="ml-0.5 inline-block h-3 w-0.5 animate-pulse"
                  style={{ background: 'var(--ai)' }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Typing indicator (live, fades after 4s of no events) */}
      {typingUsers.length > 0 && (
        <div
          className="px-3 py-1 text-[11px] italic"
          style={{ color: 'var(--n400)', borderTop: '1px solid var(--n100)' }}
        >
          {typingUsers.length === 1
            ? `${typingUsers[0]} is typing…`
            : typingUsers.length === 2
              ? `${typingUsers[0]} and ${typingUsers[1]} are typing…`
              : `${typingUsers.length} people are typing…`}
        </div>
      )}

      {/* Input with @mention support */}
      <div className="p-2" style={{ borderTop: '1px solid var(--n150)' }}>
        <div className="flex items-center gap-2">
          <MentionInput
            value={inputValue}
            onChange={handleInputChange}
            onSend={handleSend}
            disabled={aiStreaming}
          />
          {aiStreaming ? (
            <button
              onClick={stopAI}
              className="rounded-md px-2.5 py-1.5 text-xs transition-colors"
              style={{ background: 'var(--n200)', color: 'var(--n700)' }}
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!inputValue.trim()}
              className="rounded-md px-2.5 py-1.5 text-xs text-white transition-colors disabled:opacity-50"
              style={{ background: 'var(--ai)' }}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Individual message bubble */
function GroupMessageBubble({
  message,
  isCurrentUser,
  members,
}: {
  message: GroupMessage
  isCurrentUser: boolean
  members: GroupMember[]
}) {
  if (message.isAI) {
    return (
      <div className="flex gap-2">
        <div
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ background: 'var(--ai)' }}
        >
          F
        </div>
        <div>
          <div className="mb-0.5 flex items-center gap-1">
            <span className="text-[10px] font-medium" style={{ color: 'var(--ai)' }}>
              Follow AI
            </span>
            {message.mentionTrigger && (
              <span className="text-[10px]" style={{ color: 'var(--n400)' }}>
                replying to "{message.mentionTrigger}"
              </span>
            )}
          </div>
          <div
            className="max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-xs leading-relaxed"
            style={{ background: 'var(--aiS)', color: 'var(--n800)' }}
          >
            {message.content}
          </div>
        </div>
      </div>
    )
  }

  const member = members.find((m) => m.id === message.senderId)
  const color = member?.color ?? getMemberColor(message.senderId)
  const initials = member?.avatar ?? getInitials(message.senderName)

  return (
    <div className={`flex gap-2 ${isCurrentUser ? 'flex-row-reverse' : ''}`}>
      <div
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
        style={{ background: color }}
        title={message.senderName}
      >
        {initials}
      </div>
      <div>
        {!isCurrentUser && (
          <div className="mb-0.5">
            <span className="text-[10px] font-medium" style={{ color }}>
              {message.senderName}
            </span>
          </div>
        )}
        <div
          className="max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-xs leading-relaxed"
          style={{
            background: isCurrentUser ? 'var(--n100)' : 'var(--n50)',
            color: 'var(--n800)',
          }}
          data-testid={`group-message-${message.id}`}
        >
          {/* Highlight @Follow mentions within message text */}
          <MentionHighlightedText text={message.content} />
        </div>
      </div>
    </div>
  )
}

/** Renders text with @Follow mentions highlighted as purple pills */
function MentionHighlightedText({ text }: { text: string }) {
  const parts = text.split(/(@Follow)/gi)

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === '@follow' ? (
          <span
            key={i}
            className="rounded px-1 py-0.5 text-[10px] font-bold"
            style={{ background: 'var(--aiS)', color: 'var(--ai)' }}
          >
            @Follow
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}
