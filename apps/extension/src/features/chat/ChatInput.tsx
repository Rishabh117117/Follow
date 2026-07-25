/**
 * ChatInput — input bar with send button and streaming cancel.
 */

import React, { useState, useRef, useCallback } from 'react'

interface Props {
  onSend: (content: string) => void
  onCancel: () => void
  isStreaming: boolean
  disabled?: boolean
}

export function ChatInput({ onSend, onCancel, isStreaming, disabled }: Props) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = '36px'
  }, [value, isStreaming, onSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    // Auto-expand
    const ta = e.target
    ta.style.height = '36px'
    ta.style.height = Math.min(ta.scrollHeight, 100) + 'px'
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: '6px',
      padding: '8px 12px', borderTop: '1px solid #E8EAED',
      background: '#FFFFFF',
    }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Ask Follow..."
        disabled={disabled}
        rows={1}
        style={{
          flex: 1, resize: 'none', border: '1px solid #E0E0E0', borderRadius: '8px',
          padding: '8px 10px', fontSize: '13px', fontFamily: 'inherit',
          lineHeight: '1.3', outline: 'none', height: '36px', maxHeight: '100px',
          background: disabled ? '#F9FAFB' : '#FFFFFF',
        }}
      />
      {isStreaming ? (
        <button
          onClick={onCancel}
          style={{
            padding: '6px 12px', borderRadius: '6px', border: 'none',
            background: '#DC2626', color: '#FFFFFF', fontSize: '12px',
            cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap',
          }}
        >
          Stop
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          style={{
            padding: '6px 12px', borderRadius: '6px', border: 'none',
            background: value.trim() && !disabled ? '#6366F1' : '#D1D5DB',
            color: '#FFFFFF', fontSize: '12px', cursor: value.trim() ? 'pointer' : 'default',
            fontWeight: 500, whiteSpace: 'nowrap',
          }}
        >
          Send
        </button>
      )}
    </div>
  )
}
