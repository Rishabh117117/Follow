/**
 * Draft card UI — Option A/B, Insert button.
 * Shows AI-generated content as an insertable draft.
 */

import React from 'react'
import { COLORS } from '@/lib/constants'

interface DraftCardProps {
  content: string
  onInsert: () => void
  onCopy: () => void
  onDismiss: () => void
}

export function DraftCard({ content, onInsert, onCopy, onDismiss }: DraftCardProps) {
  // Truncate display to 300 chars
  const displayContent = content.length > 300 ? content.slice(0, 300) + '...' : content

  return (
    <div
      style={{
        background: COLORS.surface,
        borderLeft: `3px solid ${COLORS.primary}`,
        borderRadius: 6,
        padding: '12px 14px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}
    >
      {/* Content preview */}
      <div
        className="follow-chat-markdown"
        style={{ fontSize: 13, color: COLORS.text, lineHeight: 1.6, marginBottom: 10 }}
        dangerouslySetInnerHTML={{ __html: simpleMarkdown(displayContent) }}
      />

      {/* Action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onInsert}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            background: '#111',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Insert
        </button>
        <button
          onClick={onCopy}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            background: 'transparent',
            color: COLORS.textSecondary,
            border: `1px solid ${COLORS.borderDivider}`,
            cursor: 'pointer',
          }}
        >
          Copy
        </button>
        <button
          onClick={onDismiss}
          style={{
            padding: '6px 8px',
            borderRadius: 6,
            fontSize: 12,
            color: COLORS.textTertiary,
            marginLeft: 'auto',
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

function simpleMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
}
