'use client'

import { useState, useEffect, useCallback } from 'react'

const USER_COLORS = ['#7C3AED', '#2563EB', '#059669', '#D97706']

function hashToColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length]!
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

interface WhisperItem {
  fromUserName: string
  memory: string
  relevantSection: string | null
}

interface EntryWhisperProps {
  items: WhisperItem[]
  onDismiss: () => void
}

type AnimPhase = 'entering' | 'visible' | 'exiting' | 'hidden'

export function EntryWhisper({ items, onDismiss }: EntryWhisperProps) {
  const [phase, setPhase] = useState<AnimPhase>('entering')

  useEffect(() => {
    if (items.length === 0) {
      setPhase('hidden')
      return
    }

    // entering → visible
    const enterTimer = setTimeout(() => setPhase('visible'), 300)
    // auto-dismiss after 8s
    const dismissTimer = setTimeout(() => setPhase('exiting'), 8000)

    return () => {
      clearTimeout(enterTimer)
      clearTimeout(dismissTimer)
    }
  }, [items.length])

  useEffect(() => {
    if (phase === 'exiting') {
      const exitTimer = setTimeout(() => {
        setPhase('hidden')
        onDismiss()
      }, 500)
      return () => clearTimeout(exitTimer)
    }
  }, [phase, onDismiss])

  const handleDismiss = useCallback(() => {
    setPhase('exiting')
  }, [])

  if (phase === 'hidden' || items.length === 0) return null

  // Build summary text
  let summaryText: string
  if (items.length === 1) {
    const item = items[0]!
    const section = item.relevantSection ? ` ${item.relevantSection}` : ''
    summaryText = `${item.fromUserName} edited${section} recently`
  } else if (items.length === 2) {
    const a = items[0]!
    const b = items[1]!
    const secA = a.relevantSection ? ` ${a.relevantSection}` : ''
    const secB = b.relevantSection ? ` ${b.relevantSection}` : ''
    summaryText = `${a.fromUserName} edited${secA} · ${b.fromUserName} edited${secB}`
  } else {
    summaryText = `${items.length} updates from your team`
  }

  const uniqueUsers = [...new Set(items.map((i) => i.fromUserName))].slice(0, 2)

  const opacity = phase === 'entering' ? 0 : phase === 'exiting' ? 0 : 1
  const translateY = phase === 'entering' ? 8 : 0

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 12px)',
        right: 0,
        maxWidth: 420,
        background: '#FFFFFF',
        border: '1px solid var(--n200, #e5e5e5)',
        borderRadius: 10,
        boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        opacity,
        transform: `translateY(${translateY}px)`,
        transition:
          phase === 'exiting'
            ? 'opacity 500ms ease, transform 500ms ease'
            : 'opacity 300ms ease-out, transform 300ms ease-out',
        zIndex: 45,
        pointerEvents: phase === 'visible' ? 'auto' : 'none',
      }}
    >
      {/* Stacked avatars */}
      <div style={{ display: 'flex', flexShrink: 0 }}>
        {uniqueUsers.map((name, i) => (
          <div
            key={name}
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              background: hashToColor(name),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: i > 0 ? -5 : 0,
              border: '1.5px solid white',
              zIndex: uniqueUsers.length - i,
            }}
          >
            <span
              style={{
                fontSize: 7,
                fontFamily: 'JetBrains Mono, monospace',
                fontWeight: 600,
                color: 'white',
                lineHeight: 1,
              }}
            >
              {getInitials(name)}
            </span>
          </div>
        ))}
      </div>

      {/* Summary text */}
      <span
        style={{
          fontSize: 12,
          fontFamily: 'Georgia, serif',
          color: 'var(--n700, #404040)',
          flex: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {summaryText}
      </span>

      {/* Dismiss */}
      <button
        onClick={handleDismiss}
        style={{
          fontSize: 14,
          color: 'var(--n300, #d4d4d4)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          lineHeight: 1,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--n500, #737373)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--n300, #d4d4d4)')}
      >
        ✕
      </button>
    </div>
  )
}
