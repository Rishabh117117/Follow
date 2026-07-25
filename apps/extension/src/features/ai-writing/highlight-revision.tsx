/**
 * HighlightRevision — before/after comparison overlay for text revisions.
 */

import React from 'react'
import { materializeReplacement } from '@/features/smart-doc/materialization-service'

interface RevisionData {
  id: string
  originalText: string
  proposedText: string
  type: string
  wordDelta: number
  status: 'pending' | 'ready'
  selectionBounds: DOMRect | null
  googleDocId: string
  docType: 'docs' | 'sheets' | 'slides'
}

interface Props {
  revision: RevisionData
  onAccept: (id: string) => void
  onReject: (id: string) => void
}

export function HighlightRevision({ revision, onAccept, onReject }: Props) {
  if (!revision.selectionBounds) return null

  const top = revision.selectionBounds.bottom + 8
  const left = revision.selectionBounds.left

  const handleAccept = async () => {
    await materializeReplacement(revision.googleDocId, revision.docType, revision.originalText, revision.proposedText)
    onAccept(revision.id)
  }

  const typeLabel = revision.type.toUpperCase()
  const deltaLabel = revision.wordDelta >= 0 ? `+${revision.wordDelta}` : `${revision.wordDelta}`

  return (
    <div style={{
      position: 'fixed', top: `${top}px`, left: `${left}px`, maxWidth: '450px',
      background: '#FFFFFF', border: '1.5px solid rgba(34,197,94,0.6)',
      borderRadius: '8px', padding: '10px 14px', fontSize: '13px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)', zIndex: 9998,
      pointerEvents: 'auto', fontFamily: '-apple-system, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22C55E' }} />
        <span style={{ fontSize: '10px', fontWeight: 700, color: '#5F6368', letterSpacing: '0.5px' }}>
          REVISION &middot; {typeLabel}
        </span>
        <span style={{ fontSize: '10px', color: '#9AA0A6' }}>{deltaLabel} words</span>
      </div>

      {/* Original text (strikethrough) */}
      <div style={{
        padding: '6px 8px', background: 'rgba(239,68,68,0.08)', borderRadius: '4px',
        marginBottom: '6px', textDecoration: 'line-through', opacity: 0.55, fontSize: '12px',
        maxHeight: '60px', overflow: 'hidden',
      }}>
        {revision.originalText.slice(0, 300)}
      </div>

      {/* Proposed text */}
      <div style={{
        padding: '6px 8px', background: 'rgba(34,197,94,0.06)', borderRadius: '4px',
        marginBottom: '8px', fontSize: '12px', maxHeight: '100px', overflow: 'auto',
      }}>
        {revision.status === 'pending' ? (
          <span style={{ color: '#9AA0A6' }}>Generating suggestion...</span>
        ) : revision.proposedText.slice(0, 500)}
      </div>

      <div style={{ display: 'flex', gap: '6px' }}>
        <button onClick={handleAccept} disabled={revision.status === 'pending'} style={{
          padding: '5px 12px', borderRadius: '6px', border: 'none',
          background: revision.status === 'ready' ? '#16A34A' : '#D1D5DB',
          color: '#fff', fontSize: '12px', cursor: revision.status === 'ready' ? 'pointer' : 'default',
        }}>Accept</button>
        <button onClick={() => onReject(revision.id)} style={{
          padding: '5px 12px', borderRadius: '6px', border: '1px solid #E0E0E0',
          background: 'transparent', color: '#5F6368', fontSize: '12px', cursor: 'pointer',
        }}>Reject</button>
      </div>
    </div>
  )
}
