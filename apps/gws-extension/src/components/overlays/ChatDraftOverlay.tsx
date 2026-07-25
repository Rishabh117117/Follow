/**
 * Chat Draft floating toolbar — Native Inline Draft Preview.
 * Text is already written into the Google Doc with a blue highlight.
 * This toolbar provides Commit / Discard / Version nav controls.
 */

import React, { useCallback } from 'react'
import { useOverlayStore, type ChatDraft } from '@/stores/overlay-store'
import { signalEmitter } from '@/services/signal-emitter'

export function ChatDraftOverlay() {
  const chatDrafts = useOverlayStore((s) => s.chatDrafts)
  if (chatDrafts.length === 0) return null
  return <>{chatDrafts.map((d) => <DraftToolbar key={d.id} draft={d} />)}</>
}

function DraftToolbar({ draft }: { draft: ChatDraft }) {
  const { setChatDraftVersion, removeChatDraft } = useOverlayStore()
  const versionCount = draft.versions.length
  const isBusy = draft.status === 'committing' || draft.status === 'discarding' || draft.status === 'inserting'

  const handleCommit = useCallback(async () => {
    if (isBusy) return
    useOverlayStore.getState().chatDrafts.forEach((d) => {
      if (d.id === draft.id) d.status = 'committing'
    })

    try {
      const { commitDraftText } = await import('@/lib/google-docs-api')
      const result = await commitDraftText(draft.googleDocId, draft.startIndex, draft.endIndex)
      if (result.success) {
        console.log('[Follow] Chat draft committed — highlight cleared')
        signalEmitter.emit('chat_draft_commit', {
          action: draft.action,
          contentLength: draft.versions[draft.activeVersion]?.length ?? 0,
          versionUsed: draft.activeVersion + 1,
          totalVersions: versionCount,
        })
      } else {
        console.error('[Follow] Chat draft commit failed:', result.error)
      }
    } catch (err) {
      console.error('[Follow] Chat draft commit error:', err)
    }

    removeChatDraft(draft.id)
  }, [draft, isBusy, versionCount, removeChatDraft])

  const handleDiscard = useCallback(async () => {
    if (isBusy) return
    useOverlayStore.getState().chatDrafts.forEach((d) => {
      if (d.id === draft.id) d.status = 'discarding'
    })

    try {
      const { discardDraftText } = await import('@/lib/google-docs-api')
      const result = await discardDraftText(draft.googleDocId, draft.startIndex, draft.endIndex)
      if (result.success) {
        console.log('[Follow] Chat draft discarded — text removed')
        signalEmitter.emit('chat_draft_discard', { action: draft.action })
      } else {
        console.error('[Follow] Chat draft discard failed:', result.error)
      }
    } catch (err) {
      console.error('[Follow] Chat draft discard error:', err)
    }

    removeChatDraft(draft.id)
  }, [draft, isBusy, removeChatDraft])

  const handleVersionPrev = useCallback(() => {
    const newIdx = (draft.activeVersion - 1 + versionCount) % versionCount
    setChatDraftVersion(draft.id, newIdx)
  }, [draft.id, draft.activeVersion, versionCount, setChatDraftVersion])

  const handleVersionNext = useCallback(() => {
    const newIdx = (draft.activeVersion + 1) % versionCount
    setChatDraftVersion(draft.id, newIdx)
  }, [draft.id, draft.activeVersion, versionCount, setChatDraftVersion])

  return (
    <div
      className="follow-interactive follow-animate-fade-in"
      style={{
        position: 'fixed',
        top: 100,
        right: 80,
        zIndex: 200,
        pointerEvents: 'auto',
        background: '#FFFFFF',
        borderRadius: 10,
        boxShadow: '0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(66,133,244,0.15)',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        minWidth: 280,
      }}
    >
      {/* Summary badge */}
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 12,
        fontWeight: 600,
        color: '#4285F4',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: 180,
      }}>
        <span style={{ fontSize: 14 }}>&#10024;</span>
        DRAFT &mdash; {draft.summary}
      </span>

      {/* Separator */}
      <div style={{ width: 1, height: 20, background: '#E8EAED', flexShrink: 0 }} />

      {/* Commit button */}
      <DraftBtn label="&#10003; Commit" filled onClick={handleCommit} disabled={isBusy} />

      {/* Discard button */}
      <DraftBtn label="&#10005; Discard" onClick={handleDiscard} disabled={isBusy} />

      {/* Version navigation */}
      {versionCount > 1 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          marginLeft: 4,
          background: '#F1F3F4',
          borderRadius: 4,
          padding: 2,
        }}>
          <VersionBtn label="&#9664;" onClick={handleVersionPrev} disabled={versionCount <= 1} />
          <span style={{
            fontSize: 10, color: '#5F6368', padding: '0 4px', fontWeight: 500,
            fontFamily: 'system-ui, sans-serif', minWidth: 28, textAlign: 'center',
          }}>
            v{draft.activeVersion + 1}/{versionCount}
          </span>
          <VersionBtn label="&#9654;" onClick={handleVersionNext} disabled={versionCount <= 1} />
        </div>
      )}

      {/* Busy indicator */}
      {isBusy && (
        <span
          className="follow-animate-spin"
          style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: '2px solid #4285F4',
            borderTopColor: 'transparent',
            marginLeft: 4,
          }}
        />
      )}
    </div>
  )
}

function DraftBtn({ label, filled, onClick, title, disabled }: {
  label: string; filled?: boolean; onClick: () => void; title?: string; disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        padding: '5px 12px', borderRadius: 4, fontSize: 11, fontWeight: filled ? 600 : 500,
        color: filled ? '#FFF' : '#5F6368',
        background: filled ? '#1A73E8' : 'transparent',
        border: filled ? 'none' : '1px solid #DADCE0',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 150ms ease',
        fontFamily: 'system-ui, sans-serif',
        opacity: disabled ? 0.6 : 1,
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        if (filled) e.currentTarget.style.background = '#1557B0'
        else e.currentTarget.style.background = '#F1F3F4'
      }}
      onMouseLeave={(e) => {
        if (disabled) return
        if (filled) e.currentTarget.style.background = '#1A73E8'
        else e.currentTarget.style.background = 'transparent'
      }}
    >
      {label}
    </button>
  )
}

function VersionBtn({ label, onClick, disabled }: {
  label: string; onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 22, height: 22, border: 'none', background: 'transparent',
        cursor: disabled ? 'default' : 'pointer', borderRadius: 3,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, color: disabled ? '#BDC1C6' : '#5F6368',
        transition: 'all 100ms ease', opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = '#E8EAED' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {label}
    </button>
  )
}
