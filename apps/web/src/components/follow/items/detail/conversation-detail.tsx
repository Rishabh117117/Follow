'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { formatTime, SOURCE_CONFIG } from '../_shared'
import { ReasoningPanel, type ReasoningMetadata, type ToolCallEntry } from './reasoning-panel'

export type { ToolCallEntry, ReasoningMetadata }

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt?: string
  metadata?: ReasoningMetadata & { [k: string]: unknown }
}

export interface VersionSummary {
  version: number
  createdAt: string
  snapshotId: string
}

export interface ConversationDetailData {
  id: string
  version?: number
  contentHash?: string | null
  messages: ConversationMessage[]
  history?: VersionSummary[]
}

export function ConversationDetail({
  conversationId,
  source,
  compact,
}: {
  conversationId: string
  source: string
  /**
   * When true, suppress the per-conversation version-history chip. Used by
   * `ConversationGroupDetail` so stacking N members doesn't render N version
   * chips.
   */
  compact?: boolean
}) {
  const [viewingVersion, setViewingVersion] = useState<number | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  // Current/live state (includes version + history).
  const { data: liveData } = useQuery({
    queryKey: ['conversation-detail', conversationId],
    queryFn: () =>
      api.get<ConversationDetailData>(`/api/chat/conversations/${conversationId}`),
  })
  const live = liveData?.data
  const currentVersion = live?.version ?? 1
  const history = live?.history ?? []

  // Snapshot when viewing an older version.
  const { data: snapData } = useQuery({
    queryKey: ['conversation-snapshot', conversationId, viewingVersion],
    enabled: viewingVersion !== null && viewingVersion !== currentVersion,
    queryFn: () =>
      api.get<{
        version: number
        title: string
        messagesJson: ConversationMessage[]
        createdAt: string
      }>(`/api/chat/conversations/${conversationId}/history/${viewingVersion}`),
  })

  const messages: ConversationMessage[] =
    viewingVersion !== null && viewingVersion !== currentVersion
      ? snapData?.data?.messagesJson ?? []
      : live?.messages ?? []

  const showingHistorical = viewingVersion !== null && viewingVersion !== currentVersion

  if (!live) {
    return (
      <div style={{ fontSize: 12, color: 'var(--n400, #9c968d)' }}>Loading…</div>
    )
  }

  return (
    <div data-testid="conversation-detail">
      {/* Version chip + revision control (only shown when there is history) */}
      {!compact && (currentVersion > 1 || history.length > 0) && (
        <div
          data-testid="version-bar"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 14,
            padding: '8px 12px',
            background: 'var(--n50, #fafafa)',
            border: '1px solid var(--n150, #e5e2de)',
            borderRadius: 8,
            fontSize: 11,
          }}
        >
          <button
            type="button"
            data-testid="version-chip"
            onClick={() => setShowHistory((v) => !v)}
            style={{
              padding: '3px 8px',
              borderRadius: 4,
              border: '1px solid #6C63FF',
              background: showingHistorical ? 'rgba(217,119,6,0.15)' : 'rgba(108,99,255,0.08)',
              color: showingHistorical ? '#b7791f' : '#6C63FF',
              fontSize: 10,
              fontFamily: 'monospace',
              cursor: 'pointer',
            }}
          >
            {showingHistorical
              ? `Viewing v${viewingVersion} · historical`
              : `v${currentVersion}${history.length > 0 ? ' · ' + (history.length + 1) + ' versions' : ''}`}
          </button>
          {showingHistorical && (
            <button
              type="button"
              data-testid="return-to-latest"
              onClick={() => {
                setViewingVersion(null)
                setShowHistory(false)
              }}
              style={{
                padding: '3px 8px',
                borderRadius: 4,
                border: 'none',
                background: '#6C63FF',
                color: '#fff',
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              Return to latest
            </button>
          )}
          {showHistory && history.length > 0 && (
            <div
              data-testid="version-list"
              style={{
                marginLeft: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                flexWrap: 'wrap',
              }}
            >
              {history.map((h) => (
                <button
                  type="button"
                  key={h.snapshotId}
                  data-testid={`version-item-${h.version}`}
                  onClick={() => setViewingVersion(h.version)}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: `1px solid ${viewingVersion === h.version ? '#6C63FF' : 'var(--n200, #d8d4cf)'}`,
                    background:
                      viewingVersion === h.version ? 'rgba(108,99,255,0.1)' : '#fff',
                    color:
                      viewingVersion === h.version ? '#6C63FF' : 'var(--n600, #6b6358)',
                    fontSize: 10,
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                  }}
                >
                  v{h.version} · {formatTime(h.createdAt)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {messages.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--n400, #9c968d)' }}>
          No messages in this conversation.
        </div>
      ) : null}

      {messages.map((m) => {
        const isUser = m.role === 'user'
        return (
          <div
            key={m.id}
            style={{
              marginBottom: 14,
              display: 'flex',
              flexDirection: 'column',
              alignItems: isUser ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: 'var(--n400, #9c968d)',
                fontFamily: 'monospace',
                marginBottom: 2,
              }}
            >
              {isUser ? 'You' : SOURCE_CONFIG[source]?.label ?? 'AI'}
            </div>
            <div
              style={{
                maxWidth: '85%',
                padding: '10px 14px',
                borderRadius: isUser ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                background: isUser ? 'var(--n800, #332e25)' : '#fff',
                color: isUser ? '#fff' : 'var(--n700, #4d473c)',
                border: isUser ? 'none' : '1px solid var(--n150, #e5e2de)',
                fontSize: 13,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content}
            </div>
            {m.role === 'assistant' && m.metadata && (
              <div style={{ maxWidth: '85%', width: '100%' }}>
                <ReasoningPanel metadata={m.metadata as ReasoningMetadata} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
