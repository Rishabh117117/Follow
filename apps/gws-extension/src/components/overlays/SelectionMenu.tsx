/**
 * Selection Menu — compact floating toolbar above selected text in Google Docs.
 * Shows an input bar to ask Follow about the selected text.
 * Also registers a right-click context menu option "Ask Follow..." via chrome API.
 *
 * Positioned via selection bounds from dom-bridge.
 * Styled: zinc-900 bg, 12px radius, shadow-lg.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { getSelectedText, getSelectionBounds } from '@/content/dom-bridge'
import { isCanvasMode } from '@/content/canvas-position-adapter'
import { useOverlayStore } from '@/stores/overlay-store'
import { signalEmitter } from '@/services/signal-emitter'
import { requestEditSuggestion } from '@/services/ai-edit-service'
import type { GoogleDocType } from '@/lib/google-doc-utils'

interface SelectionMenuProps {
  docType: GoogleDocType
  googleDocId: string
}

export function SelectionMenu({ docType, googleDocId }: SelectionMenuProps) {
  const { showSelectionMenu, selectionBounds, selectedText, setSelection, setSelectionMenu, addRevision } = useOverlayStore()
  const [customInstruction, setCustomInstruction] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Listen for selection changes from both direct DOM events and canvas tracker
  useEffect(() => {
    const canvasMode = isCanvasMode()

    // DOM mode: use native selectionchange events
    const handleSelectionChange = () => {
      if (canvasMode) return // Skip in canvas mode
      const text = getSelectedText()
      const bounds = getSelectionBounds()
      setSelection(text, bounds)
    }

    // Both modes: listen for follow-selection-change from canvas tracker or SelectionTracker
    const handleFollowSelection = (e: Event) => {
      const { text, bounds } = (e as CustomEvent).detail
      if (text && text.length > 3 && bounds) {
        setSelection(text, bounds)
      }
    }

    // Canvas mode: listen for selection-detected (has bounds but no text yet)
    const handleSelectionDetected = (e: Event) => {
      const { bounds } = (e as CustomEvent).detail
      if (bounds) {
        // Show a subtle "Copy to select" indicator — selection exists but text unknown
        // For now, just store bounds so the menu appears after copy
        setSelection('', bounds)
      }
    }

    if (!canvasMode) {
      document.addEventListener('selectionchange', handleSelectionChange)
    }
    window.addEventListener('follow-selection-change', handleFollowSelection)
    window.addEventListener('follow-selection-detected', handleSelectionDetected)

    // Dismiss on click outside
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setTimeout(() => {
          if (canvasMode) {
            // In canvas mode, dismiss if no selection bounds
            setSelectionMenu(false)
          } else {
            const text = getSelectedText()
            if (!text || text.length <= 3) {
              setSelectionMenu(false)
            }
          }
        }, 150)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)

    // Dismiss on Escape
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectionMenu(false)
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      window.removeEventListener('follow-selection-change', handleFollowSelection)
      window.removeEventListener('follow-selection-detected', handleSelectionDetected)
      document.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [setSelection, setSelectionMenu])

  const handleCustomInstruction = useCallback(async () => {
    if (!customInstruction.trim()) return

    let text = selectedText || ''
    if (isCanvasMode() && !text) {
      try {
        text = await navigator.clipboard.readText()
      } catch { /* ignore */ }
    }
    if (!text || text.length <= 3) return

    const wordCount = text.split(/\s+/).length
    addRevision({
      originalText: text,
      proposedText: '',
      selectionBounds: selectionBounds,
      type: 'rewrite',
      wordDelta: 0,
      status: 'pending',
    })
    setSelectionMenu(false)

    try {
      const result = await requestEditSuggestion(text, 'rewrite', customInstruction)
      const proposedWordCount = result.proposedText.split(/\s+/).length
      const store = useOverlayStore.getState()
      const pendingRev = store.revisions.find(
        (r) => r.originalText === text && r.status === 'pending'
      )
      if (pendingRev) {
        useOverlayStore.setState({
          revisions: store.revisions.map((r) =>
            r.id === pendingRev.id
              ? { ...r, proposedText: result.proposedText, wordDelta: proposedWordCount - wordCount, status: 'ready' as const }
              : r
          ),
        })
      }
    } catch (err) {
      console.error('[Follow] Custom instruction edit failed:', err)
      const store = useOverlayStore.getState()
      const pendingRev = store.revisions.find(
        (r) => r.originalText === text && r.status === 'pending'
      )
      if (pendingRev) store.removeRevision(pendingRev.id)
    }

    setCustomInstruction('')
  }, [customInstruction, selectedText, selectionBounds, addRevision, setSelectionMenu])

  const handleAskInChat = useCallback(() => {
    if (!selectedText) return
    // Pre-fill floating unit input and expand
    window.dispatchEvent(
      new CustomEvent('follow-prefill-chat', {
        detail: { text: selectedText },
      })
    )
    setSelectionMenu(false)
  }, [selectedText, setSelectionMenu])

  // In canvas mode, try to read clipboard to get selected text when menu first shows
  useEffect(() => {
    if (!showSelectionMenu || !selectionBounds || (selectedText && selectedText.length > 3)) return
    if (!isCanvasMode()) return

    // Inject a script to read clipboard from MAIN world and post back
    const script = document.createElement('script')
    script.textContent = `
      navigator.clipboard.readText()
        .then(text => window.postMessage({ type: 'FOLLOW_CLIPBOARD_TEXT', text }, '*'))
        .catch(() => {});
    `
    document.documentElement.appendChild(script)
    script.remove()
  }, [showSelectionMenu, selectionBounds, selectedText])

  if (!showSelectionMenu || !selectionBounds) return null

  // In canvas mode, always show chips — we'll read clipboard on chip click
  const inCanvas = isCanvasMode()
  const hasText = (selectedText && selectedText.length > 3) || inCanvas

  return (
    <div
      ref={menuRef}
      data-follow-selection-menu
      className="follow-animate-scale-in"
      style={{
        position: 'fixed',
        left: selectionBounds.left + selectionBounds.width / 2,
        top: selectionBounds.top - 8,
        transform: 'translateX(-50%) translateY(-100%)',
        zIndex: 200,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: 6,
          borderRadius: 10,
          background: '#18181B',
          border: '1px solid #3F3F46',
          boxShadow: '0 8px 32px rgba(0,0,0,0.40)',
        }}
      >
        {/* Follow icon */}
        <div style={{
          width: 22, height: 22, borderRadius: 6,
          background: '#6366F1', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#FFF' }}>F</span>
        </div>

        {/* Input */}
        <input
          type="text"
          placeholder="Ask Follow..."
          value={customInstruction}
          onChange={(e) => setCustomInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customInstruction.trim()) {
              handleCustomInstruction()
            } else if (e.key === 'Enter' && !customInstruction.trim()) {
              handleAskInChat()
            }
          }}
          autoFocus
          style={{
            width: 200,
            padding: '4px 8px',
            borderRadius: 6,
            fontSize: 12,
            color: '#FAFAFA',
            background: '#27272A',
            border: '1px solid #3F3F46',
            outline: 'none',
          }}
        />

        {/* Go button */}
        <button
          onClick={() => {
            if (customInstruction.trim()) {
              handleCustomInstruction()
            } else {
              handleAskInChat()
            }
          }}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            color: '#FFF',
            background: '#6366F1',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Go
        </button>
      </div>
    </div>
  )
}
