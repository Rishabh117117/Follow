/**
 * Port of unit-input-bar.tsx — input row + send/stop button + minimize.
 */

import React, { useRef, useEffect } from 'react'
import { COLORS } from '@/lib/constants'

interface UnitInputBarProps {
  inputValue: string
  onInputChange: (value: string) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onInputClick: () => void
  onSend: () => void
  onStop: () => void
  onMinimize: () => void
  isStreaming: boolean
}

export function UnitInputBar({
  inputValue,
  onInputChange,
  onKeyDown,
  onInputClick,
  onSend,
  onStop,
  onMinimize,
  isStreaming,
}: UnitInputBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 80)}px`
  }, [inputValue])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px' }}>
      {/* F icon */}
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: COLORS.primary,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        F
      </div>

      <textarea
        ref={textareaRef}
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={onKeyDown}
        onClick={onInputClick}
        placeholder="Ask anything..."
        rows={1}
        className="follow-floating-input"
        style={{
          flex: 1,
          resize: 'none',
          background: 'transparent',
          fontSize: 13,
          lineHeight: 1.6,
          color: COLORS.text,
          border: 'none',
          outline: 'none',
          maxHeight: 80,
          minHeight: 22,
          fontFamily: 'inherit',
        }}
        disabled={isStreaming}
      />

      {/* Send / Stop */}
      {isStreaming ? (
        <button
          onClick={onStop}
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
          title="Stop"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={COLORS.textSecondary}>
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      ) : (
        <button
          onClick={onSend}
          disabled={!inputValue.trim()}
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: COLORS.blue,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            opacity: inputValue.trim() ? 1 : 0.4,
            cursor: inputValue.trim() ? 'pointer' : 'default',
          }}
          title="Send (Enter)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      )}

      {/* Minimize to dot */}
      <button
        onClick={onMinimize}
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
        title="Minimize"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.textSecondary} strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </div>
  )
}
