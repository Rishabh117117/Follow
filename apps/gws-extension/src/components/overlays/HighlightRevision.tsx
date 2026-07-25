/**
 * Highlight Revision overlay — before/after comparison on selected text.
 * Triggered by Selection Menu chips (Rewrite, Shorten, etc.)
 *
 * Visual:
 * - Original text area gets red-tint overlay with strikethrough (opacity 0.55)
 * - Proposed card below: green border, "REVISION" badge, toolbar
 * - Toolbar: Accept (filled), Reject (outline), Edit, Regen
 *
 * Accept replaces text via clipboard paste; Reject removes overlay.
 * All overlays use position: fixed with scroll tracking (rAF batched).
 */

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useOverlayStore, type HighlightRevision as RevisionType } from '@/stores/overlay-store'
import { signalEmitter } from '@/services/signal-emitter'
import { insertText } from '@/services/insertion-service'
import { getDocumentText } from '@/content/dom-bridge'

const TYPE_LABELS: Record<string, string> = {
  rewrite: 'REWRITE',
  shorten: 'SHORTEN',
  strengthen: 'STRENGTHEN',
  tone: 'TONE',
  grammar: 'GRAMMAR',
}

export function HighlightRevisionOverlay() {
  const revisions = useOverlayStore((s) => s.revisions)
  if (revisions.length === 0) return null

  return (
    <>
      {revisions.map((rev) => (
        <RevisionCard key={rev.id} revision={rev} />
      ))}
    </>
  )
}

function RevisionCard({ revision }: { revision: RevisionType }) {
  const { acceptRevision, rejectRevision } = useOverlayStore()
  const [bounds, setBounds] = useState(revision.selectionBounds)
  const rafRef = useRef<number>(0)

  // Track scroll to update position
  useEffect(() => {
    if (!revision.selectionBounds) return

    const updateBounds = () => {
      // Selection bounds are initially captured at creation time.
      // On scroll, the fixed position stays relative to viewport,
      // which is correct for our position: fixed overlay.
      setBounds(revision.selectionBounds)
    }

    const editorEl = document.querySelector('.kix-appview-editor')
    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(updateBounds)
    }

    editorEl?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      editorEl?.removeEventListener('scroll', onScroll)
      window.removeEventListener('scroll', onScroll)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [revision.selectionBounds])

  const handleAccept = useCallback(async () => {
    // E-2: use the shared insertion service. Try to compute character
    // offsets for the original text so we can validate position before
    // clipboard paste; if the text is ambiguous or missing, we pass no
    // indices and the service will fall through.
    let startIndex: number | undefined
    let endIndex: number | undefined
    try {
      const docText = getDocumentText()
      const first = docText.indexOf(revision.originalText)
      const second = first >= 0 ? docText.indexOf(revision.originalText, first + 1) : -1
      if (first >= 0 && second === -1) {
        startIndex = first
        endIndex = first + revision.originalText.length
      }
    } catch {
      // ignore — we'll skip validation
    }

    const result = await insertText({
      content: revision.proposedText,
      mode: 'replace_range',
      startIndex,
      endIndex,
      expectedText: revision.originalText,
    })

    signalEmitter.emit('revision_accept', {
      type: revision.type,
      originalLength: revision.originalText.length,
      proposedLength: revision.proposedText.length,
      insertMethod: result.method,
      success: result.success,
    })

    if (result.success) {
      acceptRevision(revision.id)
    }
  }, [revision, acceptRevision])

  const handleReject = useCallback(() => {
    signalEmitter.emit('revision_reject', { type: revision.type })
    rejectRevision(revision.id)
  }, [revision, rejectRevision])

  if (!bounds) return null

  const wordDeltaLabel = revision.wordDelta >= 0
    ? `+${revision.wordDelta} words`
    : `${revision.wordDelta} words`

  return (
    <div
      className="follow-animate-fade-in"
      style={{ position: 'fixed', zIndex: 160, pointerEvents: 'auto' }}
    >
      {/* Original text overlay — red tint with strikethrough */}
      <div
        style={{
          position: 'fixed',
          top: bounds.top,
          left: bounds.left,
          width: bounds.width,
          height: bounds.height,
          background: 'rgba(239,68,68,0.08)',
          pointerEvents: 'none',
          zIndex: 159,
        }}
      />

      {/* Proposed card — below the original */}
      <div
        style={{
          position: 'fixed',
          top: bounds.bottom + 6,
          left: bounds.left,
          width: Math.max(bounds.width, 300),
          maxWidth: 500,
          border: '1.5px solid rgba(34,197,94,0.6)',
          background: 'rgba(34,197,94,0.06)',
          borderRadius: 4,
          padding: '10px 14px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', background: '#22C55E',
          }} />
          <span style={{
            fontSize: 7, fontFamily: 'monospace', fontWeight: 700, color: '#16A34A',
            letterSpacing: '0.08em',
          }}>
            REVISION &middot; {TYPE_LABELS[revision.type] || revision.type.toUpperCase()}
          </span>
          <span style={{
            fontSize: 9, color: '#6B7280', marginLeft: 'auto',
          }}>
            {wordDeltaLabel}
          </span>
        </div>

        {/* Original (strikethrough) */}
        <div style={{
          fontSize: 13, color: '#EF4444', opacity: 0.55, textDecoration: 'line-through',
          lineHeight: 1.5, marginBottom: 6, padding: '4px 6px',
          background: 'rgba(239,68,68,0.05)', borderRadius: 2,
        }}>
          {revision.originalText.substring(0, 300)}
          {revision.originalText.length > 300 && '...'}
        </div>

        {/* Proposed */}
        <div style={{
          fontSize: 13, color: revision.status === 'pending' ? '#6B7280' : '#15803D', lineHeight: 1.5, padding: '4px 6px',
          background: revision.status === 'pending' ? 'rgba(107,114,128,0.04)' : 'rgba(34,197,94,0.04)', borderRadius: 2,
        }}>
          {revision.status === 'pending' ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="follow-animate-spin" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: '1.5px solid #9CA3AF', borderTopColor: 'transparent' }} />
              Generating suggestion...
            </span>
          ) : (
            <>
              {revision.proposedText.substring(0, 500)}
              {revision.proposedText.length > 500 && '...'}
            </>
          )}
        </div>

        {/* Toolbar */}
        <div style={{
          display: 'flex', gap: 4, marginTop: 10, paddingTop: 8,
          borderTop: '1px solid rgba(34,197,94,0.15)',
        }}>
          <RevBtn label="Accept" filled onClick={handleAccept} disabled={revision.status === 'pending'} />
          <RevBtn label="Reject" onClick={handleReject} />
          <RevBtn label="Edit" onClick={() => {/* TODO: inline edit mode */}} disabled={revision.status === 'pending'} />
          <RevBtn label="Regen" onClick={() => {/* TODO: regenerate */}} disabled={revision.status === 'pending'} />
        </div>
      </div>
    </div>
  )
}

function RevBtn({ label, filled, onClick, disabled }: { label: string; filled?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '3px 8px', borderRadius: 4, fontSize: 8, fontWeight: filled ? 600 : 500,
        color: filled ? '#FFF' : '#374151', background: filled ? '#111827' : 'transparent',
        border: filled ? 'none' : '1px solid #D1D5DB',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => { if (!filled && !disabled) e.currentTarget.style.background = '#F3F4F6' }}
      onMouseLeave={(e) => { if (!filled) e.currentTarget.style.background = 'transparent' }}
    >
      {label}
    </button>
  )
}
