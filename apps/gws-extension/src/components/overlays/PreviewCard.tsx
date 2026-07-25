/**
 * Preview Card — floating card shown on hover over a Doc Intelligence underline.
 * Shows original vs suggested text with Accept/Reject/Edit/Regen actions.
 * Anchored above the underline, with navigation between marks ("1 of N").
 *
 * Visual: white bg, 1px border #E0E0E0, 8px radius, shadow, ~340px width.
 * Original: red-tint bg + strikethrough. Suggested: green-border bg.
 */

import React, { useMemo, useCallback, useState, useRef } from 'react'
import { useOverlayStore, type DocIntelMark, type DocIntelType } from '@/stores/overlay-store'
import { signalEmitter } from '@/services/signal-emitter'
import { STORAGE_KEYS, DEFAULT_API_BASE_URL } from '@/lib/constants'

const TYPE_COLORS: Record<DocIntelType, string> = {
  clarity: '#f59e0b',
  conciseness: '#3b82f6',
  tone: '#8b5cf6',
  grammar: '#10b981',
  structure: '#f43f5e',
}

const TYPE_LABELS: Record<DocIntelType, string> = {
  clarity: 'CLARITY SUGGESTION',
  conciseness: 'CONCISENESS SUGGESTION',
  tone: 'TONE SUGGESTION',
  grammar: 'GRAMMAR SUGGESTION',
  structure: 'STRUCTURE SUGGESTION',
}

export function PreviewCardOverlay() {
  const hoveredMarkId = useOverlayStore((s) => s.hoveredMarkId)
  const marks = useOverlayStore((s) => s.marks)
  const setHoveredMark = useOverlayStore((s) => s.setHoveredMark)
  const setMarks = useOverlayStore((s) => s.setMarks)

  // Mini-chat state
  const [miniChatInput, setMiniChatInput] = useState('')
  const [miniChatMessages, setMiniChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [miniChatLoading, setMiniChatLoading] = useState(false)
  const [miniChatOpen, setMiniChatOpen] = useState(false)
  const miniChatInputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Keep card open while mini-chat is active
  const isInteracting = miniChatOpen || miniChatLoading

  const hoveredMark = useMemo(
    () => marks.find((m) => m.id === hoveredMarkId) || null,
    [marks, hoveredMarkId]
  )

  const currentIndex = useMemo(
    () => (hoveredMark ? marks.indexOf(hoveredMark) : -1),
    [marks, hoveredMark]
  )

  const navigateMark = useCallback(
    (direction: -1 | 1) => {
      const nextIdx = currentIndex + direction
      if (nextIdx >= 0 && nextIdx < marks.length) {
        setHoveredMark(marks[nextIdx].id)
        // Reset mini-chat when navigating
        setMiniChatMessages([])
        setMiniChatInput('')
        setMiniChatOpen(false)
      }
    },
    [currentIndex, marks, setHoveredMark]
  )

  const handleAccept = useCallback(
    (mark: DocIntelMark) => {
      try {
        navigator.clipboard.writeText(mark.replacement).then(() => {
          const editor = document.querySelector<HTMLElement>(
            '.kix-appview-editor [contenteditable="true"]'
          )
          if (editor) {
            editor.focus()
            document.execCommand('paste')
          }
        })
      } catch {
        console.log('[Follow] Mark accept — Apps Script fallback needed (G6)')
      }

      signalEmitter.emit('revision_accept', {
        type: mark.type,
        suggestion: mark.suggestion,
      })

      setMarks(marks.filter((m) => m.id !== mark.id))
      setHoveredMark(null)
      setMiniChatMessages([])
      setMiniChatOpen(false)
    },
    [marks, setMarks, setHoveredMark]
  )

  const handleReject = useCallback(
    (mark: DocIntelMark) => {
      signalEmitter.emit('revision_reject', { type: mark.type })
      setMarks(marks.filter((m) => m.id !== mark.id))
      setHoveredMark(null)
      setMiniChatMessages([])
      setMiniChatOpen(false)
    },
    [marks, setMarks, setHoveredMark]
  )

  // Mini-chat: send question about the underlined text
  const handleMiniChatSend = useCallback(async () => {
    if (!miniChatInput.trim() || !hoveredMark || miniChatLoading) return

    const question = miniChatInput.trim()
    setMiniChatInput('')
    setMiniChatMessages((prev) => [...prev, { role: 'user', content: question }])
    setMiniChatLoading(true)

    try {
      const data = await chrome.storage.local.get([
        STORAGE_KEYS.AUTH_TOKEN,
        STORAGE_KEYS.USER_ID,
        STORAGE_KEYS.WORKSPACE_ID,
        STORAGE_KEYS.API_BASE_URL,
      ])
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = data[STORAGE_KEYS.AUTH_TOKEN] as string | undefined
      if (token) headers['Authorization'] = `Bearer ${token}`
      const userId = data[STORAGE_KEYS.USER_ID] as string | undefined
      if (userId) headers['x-user-id'] = userId
      const workspaceId = data[STORAGE_KEYS.WORKSPACE_ID] as string | undefined
      if (workspaceId) headers['x-workspace-id'] = workspaceId
      const baseUrl = (data[STORAGE_KEYS.API_BASE_URL] as string) || DEFAULT_API_BASE_URL

      // Use synthesize endpoint for contextual Q&A about the suggestion
      const res = await fetch(`${baseUrl}/api/doc-intelligence-web/synthesize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          originalText: hoveredMark.suggestion,
          instruction: `The user is looking at a ${hoveredMark.type} suggestion. The original text is: "${hoveredMark.suggestion}". The suggested replacement is: "${hoveredMark.replacement}". The user asks: "${question}". Provide a brief, helpful explanation (2-3 sentences max).`,
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const json = await res.json()
      const variants = json.data?.variants ?? []
      const answer = variants[0]?.text || 'Sorry, I could not generate an answer.'

      setMiniChatMessages((prev) => [...prev, { role: 'assistant', content: answer }])
    } catch (err) {
      console.error('[Follow] Mini-chat error:', err)
      setMiniChatMessages((prev) => [...prev, { role: 'assistant', content: 'Error getting response. Please try again.' }])
    } finally {
      setMiniChatLoading(false)
    }
  }, [miniChatInput, hoveredMark, miniChatLoading])

  if (!hoveredMark || hoveredMark.rects.length === 0) return null

  const firstRect = hoveredMark.rects[0]
  const color = TYPE_COLORS[hoveredMark.type] || '#6B7280'
  const origWords = hoveredMark.suggestion.split(/\s+/).length
  const replWords = hoveredMark.replacement.split(/\s+/).length
  const wordDelta = replWords - origWords
  const wordDeltaLabel = wordDelta >= 0 ? `+${wordDelta} words` : `${wordDelta} words`

  // Position above the underline, centered horizontally
  const cardTop = firstRect.top - 8
  const cardLeft = firstRect.left + firstRect.width / 2

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => setHoveredMark(hoveredMark.id)}
      onMouseLeave={() => { if (!isInteracting) setHoveredMark(null) }}
      className="follow-animate-scale-in follow-interactive"
      style={{
        position: 'fixed',
        top: cardTop,
        left: cardLeft,
        transform: 'translateX(-50%) translateY(-100%)',
        width: 340,
        background: '#FFFFFF',
        border: '1px solid #E0E0E0',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        padding: 12,
        zIndex: 210,
        pointerEvents: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
        <span style={{
          fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color,
          letterSpacing: '0.05em',
        }}>
          {TYPE_LABELS[hoveredMark.type]}
        </span>
        <span style={{ fontSize: 9, color: '#9CA3AF', marginLeft: 'auto' }}>
          {currentIndex + 1} of {marks.length}
        </span>
      </div>

      {/* Original */}
      <div style={{ marginBottom: 6 }}>
        <div style={{
          fontSize: 8, fontWeight: 600, color: '#EF4444', textTransform: 'uppercase',
          letterSpacing: '0.06em', marginBottom: 2,
        }}>
          ORIGINAL
        </div>
        <div style={{
          fontSize: 12, color: '#EF4444', opacity: 0.7, textDecoration: 'line-through',
          lineHeight: 1.4, padding: '4px 6px', background: 'rgba(239,68,68,0.05)', borderRadius: 3,
        }}>
          {hoveredMark.suggestion.substring(0, 200)}
        </div>
      </div>

      {/* Suggested */}
      <div style={{ marginBottom: 8 }}>
        <div style={{
          fontSize: 8, fontWeight: 600, color: '#16A34A', textTransform: 'uppercase',
          letterSpacing: '0.06em', marginBottom: 2,
        }}>
          SUGGESTED
        </div>
        <div style={{
          fontSize: 12, color: '#15803D', lineHeight: 1.4, padding: '4px 6px',
          background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.2)',
          borderRadius: 3,
        }}>
          {hoveredMark.replacement.substring(0, 300)}
        </div>
        <span style={{ fontSize: 9, color: '#6B7280', marginTop: 2, display: 'block' }}>
          {wordDeltaLabel}
        </span>
      </div>

      {/* Actions */}
      <div style={{
        display: 'flex', gap: 4, paddingTop: 8, borderTop: '1px solid #F3F4F6',
        alignItems: 'center',
      }}>
        <CardBtn label="Accept" filled onClick={() => handleAccept(hoveredMark)} />
        <CardBtn label="Reject" onClick={() => handleReject(hoveredMark)} />
        <CardBtn label="Edit" onClick={() => {/* TODO */}} />
        <CardBtn label="Regen" onClick={() => {/* TODO */}} />

        {/* Navigation */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          <button
            onClick={() => navigateMark(-1)}
            disabled={currentIndex <= 0}
            style={{
              fontSize: 9, color: currentIndex > 0 ? '#6366F1' : '#D1D5DB',
              background: 'none', border: 'none', cursor: currentIndex > 0 ? 'pointer' : 'default',
            }}
          >
            &larr; Prev
          </button>
          <button
            onClick={() => navigateMark(1)}
            disabled={currentIndex >= marks.length - 1}
            style={{
              fontSize: 9, color: currentIndex < marks.length - 1 ? '#6366F1' : '#D1D5DB',
              background: 'none', border: 'none',
              cursor: currentIndex < marks.length - 1 ? 'pointer' : 'default',
            }}
          >
            Next &rarr;
          </button>
        </div>
      </div>

      {/* ─── Inline Mini-Chat ─── */}
      <div style={{ marginTop: 8, borderTop: '1px solid #F3F4F6', paddingTop: 8 }}>
        {/* Mini-chat messages */}
        {miniChatMessages.length > 0 && (
          <div style={{
            maxHeight: 100,
            overflowY: 'auto',
            marginBottom: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            {miniChatMessages.map((msg, i) => (
              <div
                key={i}
                style={{
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: msg.role === 'user' ? '#6B7280' : '#1F2937',
                  padding: '3px 6px',
                  borderRadius: 4,
                  background: msg.role === 'user' ? '#F9FAFB' : '#F0F9FF',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 9, color: msg.role === 'user' ? '#9CA3AF' : '#6366F1', marginRight: 4 }}>
                  {msg.role === 'user' ? 'You:' : 'AI:'}
                </span>
                {msg.content}
              </div>
            ))}
            {miniChatLoading && (
              <div style={{ fontSize: 11, color: '#6366F1', padding: '3px 6px' }}>
                <span className="follow-animate-pulse" style={{ display: 'inline-block', width: 4, height: 4, borderRadius: '50%', background: '#6366F1', marginRight: 4 }} />
                Thinking...
              </div>
            )}
          </div>
        )}

        {/* Input row */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            ref={miniChatInputRef}
            type="text"
            value={miniChatInput}
            onChange={(e) => setMiniChatInput(e.target.value)}
            onFocus={() => setMiniChatOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleMiniChatSend()
              }
              if (e.key === 'Escape') {
                setMiniChatOpen(false)
                setMiniChatInput('')
              }
            }}
            placeholder="Ask about this..."
            style={{
              flex: 1,
              fontSize: 11,
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid #E5E7EB',
              outline: 'none',
              color: '#374151',
              background: '#FAFAFA',
            }}
          />
          <button
            onClick={handleMiniChatSend}
            disabled={!miniChatInput.trim() || miniChatLoading}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 600,
              color: miniChatInput.trim() && !miniChatLoading ? '#FFFFFF' : '#9CA3AF',
              background: miniChatInput.trim() && !miniChatLoading ? '#6366F1' : '#F3F4F6',
              border: 'none',
              cursor: miniChatInput.trim() && !miniChatLoading ? 'pointer' : 'default',
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

function CardBtn({ label, filled, onClick }: { label: string; filled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: filled ? 600 : 500,
        color: filled ? '#FFF' : '#374151', background: filled ? '#111827' : 'transparent',
        border: filled ? 'none' : '1px solid #D1D5DB', cursor: 'pointer',
      }}
      onMouseEnter={(e) => { if (!filled) e.currentTarget.style.background = '#F3F4F6' }}
      onMouseLeave={(e) => { if (!filled) e.currentTarget.style.background = 'transparent' }}
    >
      {label}
    </button>
  )
}
