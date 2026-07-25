'use client'

/**
 * Version Citation Pill (Sprint FE-4)
 *
 * Compact, reusable badge showing a source version citation. Used in:
 *   - chat responses (post-stream version citations from the reference agent)
 *   - provenance panel → INDEX SOURCES section
 *   - paragraph-badge for AI-assisted paragraphs
 *
 * Gracefully degrades when version/hash are absent — backend endpoints
 * currently return `documentTitle + eventTime` for index records without
 * exposing the IX-8 `source_version`/`source_content_hash` columns, so
 * the pill renders with just an icon + date until that gap is closed.
 */

import type { CSSProperties } from 'react'

export interface VersionCitationProps {
  sourceFileId?: string | null
  sourceVersion?: number | null
  sourceContentHash?: string | null
  timestamp?: string
  label: string
  isSharedSlice?: boolean
  presetUsed?: string
  redactionCount?: number
  compact?: boolean
  onClick?: () => void
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatShortDate(iso: string | undefined): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`
  } catch {
    return null
  }
}

function pickIcon(label: string, isSharedSlice?: boolean): string {
  if (isSharedSlice) return '🤝'
  const lower = (label ?? '').toLowerCase()
  if (lower.includes('google') || lower.includes('gws')) return '🔌'
  if (lower.includes('chat') || lower.includes('message')) return '💬'
  return '📄'
}

export function VersionCitation(props: VersionCitationProps) {
  const icon = pickIcon(props.label, props.isSharedSlice)
  const versionText = props.sourceVersion != null ? `v${props.sourceVersion}` : null
  const dateText = formatShortDate(props.timestamp)
  const hasHash = !!props.sourceContentHash

  const pillStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: props.compact ? '2px 6px' : '3px 8px',
    background: props.isSharedSlice ? '#EFF6FF' : '#F5F5F4',
    border: `1px solid ${props.isSharedSlice ? '#BFDBFE' : '#E8E6E1'}`,
    borderRadius: 6,
    fontSize: props.compact ? 10 : 11,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    color: '#555',
    cursor: props.onClick ? 'pointer' : 'default',
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }

  const content = (
    <>
      <span aria-hidden>{icon}</span>
      {versionText && <span style={{ fontWeight: 600 }}>{versionText}</span>}
      {!versionText && props.label && (
        <span
          style={{
            color: '#777',
            maxWidth: props.compact ? 90 : 130,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {props.label}
        </span>
      )}
      {dateText && <span style={{ color: '#999' }}>· {dateText}</span>}
      {hasHash && (
        <span
          style={{ color: '#22C55E', fontSize: props.compact ? 9 : 10 }}
          title="Content hash verified"
          aria-label="Content hash verified"
        >
          ✓
        </span>
      )}
      {props.isSharedSlice && props.presetUsed && (
        <span style={{ color: '#3B82F6', fontSize: props.compact ? 9 : 10 }}>
          {props.presetUsed}
          {props.redactionCount ? ` · ${props.redactionCount}r` : ''}
        </span>
      )}
    </>
  )

  if (props.onClick) {
    return (
      <button
        type="button"
        onClick={props.onClick}
        style={pillStyle}
        title={props.label}
      >
        {content}
      </button>
    )
  }

  return (
    <span style={pillStyle} title={props.label}>
      {content}
    </span>
  )
}
