'use client'

import { formatTime } from '../_shared'
import { ConversationDetail } from './conversation-detail'

/**
 * Renders a clubbed group of conversations (multiple chat_conversations rows
 * that collapsed into one sidebar entry because they share a normalized
 * title). Each member is rendered as its own section with a visual divider
 * above it; the oldest section has no divider. The version-history chip from
 * `ConversationDetail` is hidden — it's per-conversation, but within a
 * group it would repeat once per member, which is noisy. Users can still
 * view per-conversation versions by other means (e.g. the v2 suffix in the
 * stored titles remains visible in the divider label).
 */
export function ConversationGroupDetail({
  memberIds,
  members,
  source,
}: {
  memberIds: string[]
  members: Array<{ id: string; title: string; createdAt?: string }>
  source: string
}) {
  const orderedMembers =
    members.length === memberIds.length
      ? members
      : memberIds.map((id) => members.find((m) => m.id === id) ?? { id, title: 'Untitled' })

  return (
    <div data-testid="conversation-group-detail">
      {orderedMembers.map((m, idx) => (
        <div key={m.id} data-testid={`group-section-${idx + 1}`}>
          <GroupSectionDivider
            index={idx}
            total={orderedMembers.length}
            title={m.title}
            createdAt={m.createdAt}
          />
          <ConversationDetail conversationId={m.id} source={source} compact />
        </div>
      ))}
    </div>
  )
}

/**
 * Pill divider shown above each clubbed-conversation section. The first
 * section renders a subtle "Initial save" label; subsequent sections show
 * "Update N · {timestamp}".
 */
function GroupSectionDivider({
  index,
  total,
  title,
  createdAt,
}: {
  index: number
  total: number
  title: string
  createdAt?: string
}) {
  const label =
    index === 0 ? `Initial save · ${formatTime(createdAt) || '—'}` : `Update ${index + 1} · ${formatTime(createdAt) || '—'}`
  return (
    <div
      data-testid={`group-section-divider-${index}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: index === 0 ? '4px 0 14px' : '22px 0 14px',
      }}
    >
      <div
        style={{
          flex: 1,
          height: 1,
          background: 'var(--n150, #e5e2de)',
        }}
      />
      <div
        style={{
          padding: '3px 10px',
          borderRadius: 999,
          border: '1px solid var(--n200, #d8d4cf)',
          background: 'var(--n50, #fafafa)',
          color: 'var(--n600, #6b6358)',
          fontSize: 10,
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
        }}
        title={title}
      >
        {label} · <span style={{ color: 'var(--n400, #9c968d)' }}>{index + 1}/{total}</span>
      </div>
      <div
        style={{
          flex: 1,
          height: 1,
          background: 'var(--n150, #e5e2de)',
        }}
      />
    </div>
  )
}
