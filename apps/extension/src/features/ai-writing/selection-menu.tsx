/**
 * SelectionMenu — floating toolbar that appears above selected text.
 * Shows edit mode chips and a custom instruction input.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { requestEditSuggestion } from './ai-edit-service'

interface Props {
  googleDocId: string
  docType: 'docs' | 'sheets' | 'slides'
  onRevisionCreated: (data: {
    originalText: string; proposedText: string; type: string;
    wordDelta: number; selectionBounds: DOMRect | null
  }) => void
}

const MODES = [
  { id: 'rewrite', label: 'Rewrite', color: '#6366F1' },
  { id: 'shorten', label: 'Shorten', color: '#3b82f6' },
  { id: 'strengthen', label: 'Strengthen', color: '#f43f5e' },
  { id: 'tone', label: 'Tone', color: '#8b5cf6' },
  { id: 'grammar', label: 'Grammar', color: '#10b981' },
] as const

export function SelectionMenu({ googleDocId, docType, onRevisionCreated }: Props) {
  const [visible, setVisible] = useState(false)
  const [bounds, setBounds] = useState<DOMRect | null>(null)
  const [selectedText, setSelectedText] = useState('')
  const [customInput, setCustomInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.text && detail.text.length > 3 && detail.bounds) {
        setSelectedText(detail.text)
        setBounds(detail.bounds)
        setVisible(true)
      } else {
        setVisible(false)
      }
    }
    window.addEventListener('follow-selection-change', handler)
    return () => window.removeEventListener('follow-selection-change', handler)
  }, [])

  const handleMode = useCallback(async (mode: typeof MODES[number]['id']) => {
    if (isProcessing || !selectedText) return
    setIsProcessing(true)
    try {
      const result = await requestEditSuggestion(selectedText, mode, customInput || undefined)
      const origWords = selectedText.split(/\s+/).length
      const newWords = result.proposedText.split(/\s+/).length
      onRevisionCreated({
        originalText: selectedText,
        proposedText: result.proposedText,
        type: mode,
        wordDelta: newWords - origWords,
        selectionBounds: bounds,
      })
      setVisible(false)
    } catch (err) {
      console.error('[Follow] Edit suggestion failed:', err)
    }
    setIsProcessing(false)
  }, [selectedText, bounds, customInput, isProcessing, onRevisionCreated])

  if (!visible || !bounds) return null

  const top = bounds.top - 48
  const left = Math.max(8, bounds.left)

  return (
    <div style={{
      position: 'fixed', top: `${top > 8 ? top : bounds.bottom + 8}px`, left: `${left}px`,
      display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px',
      background: '#18181b', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      zIndex: 9999, pointerEvents: 'auto',
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    }}>
      <span style={{
        width: '20px', height: '20px', borderRadius: '4px', background: '#6366F1',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: '11px', fontWeight: 700, flexShrink: 0,
      }}>F</span>

      {MODES.map(m => (
        <button
          key={m.id}
          onClick={() => handleMode(m.id)}
          disabled={isProcessing}
          style={{
            padding: '3px 8px', borderRadius: '4px', border: 'none',
            background: 'transparent', color: '#e4e4e7', fontSize: '11px',
            cursor: isProcessing ? 'wait' : 'pointer', whiteSpace: 'nowrap',
          }}
        >{m.label}</button>
      ))}

      <input
        value={customInput}
        onChange={(e) => setCustomInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleMode('rewrite') }}
        placeholder="Ask Follow..."
        style={{
          width: '140px', padding: '3px 6px', background: '#27272a',
          border: '1px solid #3f3f46', borderRadius: '4px', color: '#e4e4e7',
          fontSize: '11px', outline: 'none',
        }}
      />
    </div>
  )
}
