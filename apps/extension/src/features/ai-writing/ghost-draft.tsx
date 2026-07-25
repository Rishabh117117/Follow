/**
 * GhostDraft — AI-generated content preview positioned between paragraphs in Google Docs.
 *
 * Renders a floating card anchored below a specific paragraph with:
 * - Editable content area
 * - Commit (inserts into doc via Google Docs API) / Dismiss buttons
 * - Scroll-tracked positioning via RAF
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  extractGoogleDocId,
  replaceTextInGoogleDoc,
} from '@/lib/google-docs-api'
import { sendToBackground } from '@/core/message-bus'

interface GhostDraftData {
  id: string
  anchorIndex: number
  content: string
  status: 'streaming' | 'ready' | 'editing'
  googleDocId: string
  docType: 'docs' | 'sheets' | 'slides'
  findText?: string | null
  action?: string
}

interface Props {
  draft: GhostDraftData
  onDismiss: (id: string) => void
  onCommit: (id: string) => void
}

export function GhostDraft({ draft, onDismiss, onCommit }: Props) {
  const [top, setTop] = useState(-9999)
  const [left, setLeft] = useState(0)
  const [width, setWidth] = useState(600)
  const [editableContent, setEditableContent] = useState(draft.content)
  const [committing, setCommitting] = useState(false)
  const rafRef = useRef(0)
  const contentRef = useRef<HTMLDivElement>(null)

  // Position tracking — anchor below the target paragraph
  useEffect(() => {
    function updatePosition() {
      const paragraphs = document.querySelectorAll('.kix-paragraphrenderer')
      if (paragraphs.length === 0) {
        rafRef.current = requestAnimationFrame(updatePosition)
        return
      }

      // Find the best anchor paragraph
      let anchor: Element | null = null

      // If we have findText, search for the paragraph containing it
      if (draft.findText) {
        for (const para of paragraphs) {
          const text = para.textContent || ''
          if (text.includes(draft.findText) || text.toLowerCase().includes(draft.findText.toLowerCase())) {
            anchor = para
            break
          }
        }
      }

      // Fallback to paragraph index or last paragraph
      if (!anchor) {
        const idx = Math.min(draft.anchorIndex, paragraphs.length - 1)
        anchor = paragraphs[idx] ?? paragraphs[paragraphs.length - 1]
      }

      if (anchor) {
        const rect = anchor.getBoundingClientRect()
        // Position centered under the paragraph, matching document width
        const pageEl = document.querySelector('.kix-page-content-wrapper') || document.querySelector('.kix-page')
        const pageRect = pageEl?.getBoundingClientRect()

        setTop(rect.bottom + 8)
        setLeft(pageRect ? pageRect.left + 72 : rect.left)
        setWidth(pageRect ? pageRect.width - 144 : Math.min(rect.width, 640))
      }

      rafRef.current = requestAnimationFrame(updatePosition)
    }
    rafRef.current = requestAnimationFrame(updatePosition)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draft.anchorIndex, draft.findText])

  // Handle commit — insert text into Google Doc via API
  const handleCommit = useCallback(async () => {
    setCommitting(true)
    const docId = draft.googleDocId || extractGoogleDocId()

    if (!docId) {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(editableContent)
        alert('Draft copied to clipboard — paste it into your document.')
      } catch { /* ignore */ }
      onCommit(draft.id)
      return
    }

    try {
      // Get OAuth token and insert via Google Docs API
      const tokenResult = await sendToBackground<{ token: string }>({ type: 'GET_GOOGLE_AUTH_TOKEN' })
      if (!tokenResult.success || !tokenResult.data?.token) {
        throw new Error('No auth token')
      }

      // Find the insertion point — after the anchor paragraph
      const docRes = await fetch(
        `https://docs.googleapis.com/v1/documents/${docId}`,
        { headers: { Authorization: `Bearer ${tokenResult.data.token}` } }
      )
      if (!docRes.ok) throw new Error(`Docs API error: ${docRes.status}`)
      const docData = await docRes.json()

      // Find insertion index
      let insertIndex = -1
      if (draft.findText && docData.body?.content) {
        // Build flat text to find the insertion point
        let flatText = ''
        const indexMap: number[] = []
        for (const el of docData.body.content) {
          if (el.paragraph) {
            for (const e of el.paragraph.elements) {
              const c = e.textRun?.content || ''
              const startIdx = e.startIndex ?? 0
              for (let i = 0; i < c.length; i++) {
                flatText += c[i]
                indexMap.push(startIdx + i)
              }
            }
          }
        }

        const pos = flatText.indexOf(draft.findText)
        if (pos !== -1 && pos + draft.findText.length <= indexMap.length) {
          // Insert after the found text (at the end of its range)
          insertIndex = indexMap[pos + draft.findText.length - 1]! + 1
        }
      }

      // Fallback: insert at end of document
      if (insertIndex === -1) {
        const lastContent = docData.body?.content?.at(-1)
        insertIndex = lastContent?.endIndex ? lastContent.endIndex - 1 : 1
      }

      // Insert the text
      await fetch(
        `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenResult.data.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              { insertText: { location: { index: insertIndex }, text: '\n' + editableContent } },
            ],
          }),
        }
      )

      console.log('[Follow] Ghost draft committed to Google Doc')
    } catch (err) {
      console.error('[Follow] Ghost draft commit failed:', err)
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(editableContent)
      } catch { /* ignore */ }
    }

    onCommit(draft.id)
  }, [draft, editableContent, onCommit])

  // Don't render until positioned
  if (top < 0) return null

  return (
    <div style={{
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      background: '#fff',
      borderLeft: '3px solid #6366F1',
      borderRadius: '0 10px 10px 0',
      padding: '14px 18px',
      fontSize: '13px',
      lineHeight: '1.65',
      boxShadow: '0 4px 20px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
      zIndex: 9998,
      pointerEvents: 'auto',
      fontFamily: '"Google Sans", Roboto, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid #f0f0f0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            fontSize: '9px', fontWeight: 700, color: '#fff', background: '#6366F1',
            padding: '2px 6px', borderRadius: '4px', letterSpacing: '0.5px', textTransform: 'uppercase',
          }}>AI DRAFT</span>
          {draft.status === 'streaming' && (
            <span style={{ fontSize: '11px', color: '#9AA0A6' }}>Generating...</span>
          )}
        </div>
      </div>

      {/* Editable content */}
      <div
        ref={contentRef}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => setEditableContent((e.target as HTMLDivElement).innerText)}
        style={{
          color: '#202124',
          whiteSpace: 'pre-wrap',
          maxHeight: '240px',
          overflow: 'auto',
          outline: 'none',
          padding: '8px',
          borderRadius: '6px',
          border: '1px solid #e8e8e8',
          background: '#fafafa',
          cursor: 'text',
          minHeight: '40px',
        }}
      >
        {draft.content}
      </div>

      {/* Actions */}
      {draft.status === 'ready' && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button
            onClick={handleCommit}
            disabled={committing}
            style={{
              padding: '7px 16px', borderRadius: '6px', border: 'none',
              background: committing ? '#9CA3AF' : '#111827', color: '#fff',
              fontSize: '12px', fontWeight: 600, cursor: committing ? 'default' : 'pointer',
            }}
          >
            {committing ? 'Inserting...' : 'Commit'}
          </button>
          <button
            onClick={() => onDismiss(draft.id)}
            style={{
              padding: '7px 16px', borderRadius: '6px',
              border: '1px solid #E0E0E0', background: '#fff',
              color: '#5F6368', fontSize: '12px', cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
