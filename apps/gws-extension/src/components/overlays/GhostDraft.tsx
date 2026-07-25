/**
 * Ghost Draft overlay — AI-generated content preview BETWEEN paragraphs.
 * Positioned using getInsertionPointAfterParagraph() from dom-bridge.
 * Scroll-tracked via requestAnimationFrame on .kix-appview-editor.
 *
 * Visual: left border 3px #6366F1, gradient bg, "AI DRAFT" badge.
 * Toolbar: Commit (filled), Edit, Regen, Dismiss (outline).
 * Commit inserts text via programmatic clipboard paste.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { getInsertionPointAfterParagraph as domGetInsertionPoint } from '@/content/dom-bridge'
import {
  isCanvasMode,
  getInsertionPointAfterParagraph as canvasGetInsertionPoint,
} from '@/content/canvas-position-adapter'
import { useOverlayStore, type GhostDraft as GhostDraftType } from '@/stores/overlay-store'
import { signalEmitter } from '@/services/signal-emitter'
import { insertText } from '@/services/insertion-service'
import { COLORS } from '@/lib/constants'

export function GhostDraftOverlay() {
  const ghostDrafts = useOverlayStore((s) => s.ghostDrafts)

  if (ghostDrafts.length === 0) return null

  return (
    <>
      {ghostDrafts.map((draft) => (
        <GhostDraftCard key={draft.id} draft={draft} />
      ))}
    </>
  )
}

function GhostDraftCard({ draft }: { draft: GhostDraftType }) {
  const { updateGhostDraft, removeGhostDraft, commitGhostDraft } = useOverlayStore()
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const rafRef = useRef<number>(0)

  // Calculate position from paragraph anchor, tracking scroll
  const updatePosition = useCallback(() => {
    // Use canvas adapter in canvas mode, DOM bridge in legacy mode
    const point = isCanvasMode()
      ? canvasGetInsertionPoint(draft.anchorIndex)
      : domGetInsertionPoint(draft.anchorIndex)
    if (point) setPos(point)
  }, [draft.anchorIndex])

  useEffect(() => {
    updatePosition()

    const editorEl = document.querySelector('.kix-appview-editor')
    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(updatePosition)
    }

    editorEl?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })

    return () => {
      editorEl?.removeEventListener('scroll', onScroll)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [updatePosition])

  const handleCommit = useCallback(async () => {
    // E-2: Use the insertion service fallback chain
    // (clipboard → apps_script → manual).
    const result = await insertText({
      content: draft.content,
      mode: 'insert_after',
      paragraphIndex: draft.anchorIndex,
    })

    signalEmitter.emit('ghost_draft_commit', {
      anchorIndex: draft.anchorIndex,
      contentLength: draft.content.length,
      insertMethod: result.method,
      success: result.success,
    })

    // Only remove the ghost if the insertion actually succeeded.
    // If manual (toast), keep the ghost so the user can retry after pasting.
    if (result.success) {
      commitGhostDraft(draft.id)
    }
  }, [draft, commitGhostDraft])

  const handleDismiss = useCallback(() => {
    signalEmitter.emit('ghost_draft_dismiss', { anchorIndex: draft.anchorIndex })
    removeGhostDraft(draft.id)
  }, [draft, removeGhostDraft])

  if (!pos) return null

  const isStreaming = draft.status === 'streaming'

  return (
    <div
      className="follow-animate-fade-in"
      style={{
        position: 'fixed',
        top: pos.top + 4,
        left: pos.left,
        width: pos.width,
        zIndex: 150,
        pointerEvents: 'auto',
      }}
    >
      {/* Anchor line */}
      <div style={{ height: 1, background: 'rgba(99,102,241,0.25)', position: 'relative', marginBottom: 4 }}>
        <span style={{
          position: 'absolute', left: '50%', top: -6, transform: 'translateX(-50%)',
          fontSize: 7, fontFamily: 'monospace', fontWeight: 600, color: COLORS.primary,
          letterSpacing: '0.05em', background: '#FFFFFF', padding: '0 4px',
        }}>
          GHOST PREVIEW
        </span>
      </div>

      {/* Ghost block */}
      <div style={{
        borderLeft: `3px solid ${COLORS.primary}`,
        background: 'linear-gradient(135deg, rgba(99,102,241,0.05), rgba(99,102,241,0.02))',
        padding: '12px 16px', borderRadius: 4, position: 'relative',
      }}>
        <span style={{
          position: 'absolute', top: 4, right: 6, fontSize: 6, fontFamily: 'monospace',
          fontWeight: 700, color: COLORS.primary, letterSpacing: '0.08em',
        }}>
          AI DRAFT
        </span>

        <div style={{
          color: COLORS.primary, opacity: 0.72, fontSize: 14, lineHeight: 1.6,
          whiteSpace: 'pre-wrap', paddingRight: 40,
        }}>
          {draft.content}
          {isStreaming && <span className="follow-animate-blink" style={{ opacity: 0.6 }}>|</span>}
        </div>

        {draft.status === 'ready' && (
          <div style={{
            display: 'flex', gap: 4, marginTop: 10, paddingTop: 8,
            borderTop: '1px solid rgba(99,102,241,0.12)',
          }}>
            <GhostBtn label="Commit" filled onClick={handleCommit} />
            <GhostBtn label="Edit" onClick={() => updateGhostDraft(draft.id, { status: 'editing' })} />
            <GhostBtn label="Regen" onClick={() => {/* TODO: regenerate */}} />
            <GhostBtn label="Dismiss" onClick={handleDismiss} />
          </div>
        )}
      </div>
    </div>
  )
}

function GhostBtn({ label, filled, onClick }: { label: string; filled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 8px', borderRadius: 4, fontSize: 8, fontWeight: filled ? 600 : 500,
        color: filled ? '#FFF' : '#374151', background: filled ? '#111827' : 'transparent',
        border: filled ? 'none' : '1px solid #D1D5DB', cursor: 'pointer',
        transition: 'all 150ms ease',
      }}
      onMouseEnter={(e) => { if (!filled) e.currentTarget.style.background = '#F3F4F6' }}
      onMouseLeave={(e) => { if (!filled) e.currentTarget.style.background = 'transparent' }}
    >
      {label}
    </button>
  )
}
