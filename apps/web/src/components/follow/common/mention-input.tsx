'use client'

/**
 * MentionInput — text input with @Follow mention autocomplete.
 *
 * Detects "@" trigger, shows a dropdown with the Follow AI option,
 * inserts the mention tag on selection. Highlights @Follow mentions
 * in the typed text with a purple pill.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { AI_MENTION, extractMentions } from '@/stores/group-thread-store'

interface MentionInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  placeholder?: string
  disabled?: boolean
}

export function MentionInput({
  value,
  onChange,
  onSend,
  placeholder,
  disabled,
}: MentionInputProps) {
  const [showDropdown, setShowDropdown] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const atTriggerIndexRef = useRef<number>(-1)

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value
      onChange(newValue)

      // Detect "@" typed at end or after a space
      const cursorPos = e.target.selectionStart ?? newValue.length
      const textBefore = newValue.slice(0, cursorPos)
      const lastAtIdx = textBefore.lastIndexOf('@')

      if (lastAtIdx !== -1) {
        const afterAt = textBefore.slice(lastAtIdx + 1)
        // Show dropdown if typing "@" or "@F" or "@Fo" etc.
        if (
          afterAt.length <= AI_MENTION.length - 1 &&
          AI_MENTION.slice(1).toLowerCase().startsWith(afterAt.toLowerCase())
        ) {
          atTriggerIndexRef.current = lastAtIdx
          setShowDropdown(true)

          // Position dropdown above the input
          if (inputRef.current) {
            const rect = inputRef.current.getBoundingClientRect()
            setDropdownPos({ top: rect.top - 36, left: rect.left + lastAtIdx * 7 })
          }
          return
        }
      }

      setShowDropdown(false)
    },
    [onChange]
  )

  const handleSelectMention = useCallback(() => {
    const idx = atTriggerIndexRef.current
    if (idx === -1) return

    const before = value.slice(0, idx)
    const after = value.slice(
      value.indexOf(' ', idx) === -1 ? value.length : value.indexOf(' ', idx)
    )
    const newValue = `${before}${AI_MENTION} ${after}`.replace(/  +/g, ' ')

    onChange(newValue)
    setShowDropdown(false)
    inputRef.current?.focus()
  }, [value, onChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showDropdown) {
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault()
          handleSelectMention()
          return
        }
        if (e.key === 'Escape') {
          setShowDropdown(false)
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && !showDropdown) {
        e.preventDefault()
        onSend()
      }
    },
    [showDropdown, handleSelectMention, onSend]
  )

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return
    const handleClick = () => setShowDropdown(false)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [showDropdown])

  const mentions = extractMentions(value)
  const hasMentions = mentions.length > 0

  return (
    <div className="relative flex-1" data-testid="mention-input">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? `Message… Type ${AI_MENTION} to ask AI`}
        disabled={disabled}
        className="w-full rounded-md px-3 py-1.5 text-xs focus:outline-none focus:ring-1"
        style={{
          background: 'var(--n50)',
          color: 'var(--n800)',
          border: '1px solid var(--n200)',
        }}
      />

      {/* @Follow mention badge indicator */}
      {hasMentions && (
        <div
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 py-0.5 text-[9px] font-bold"
          style={{ background: 'var(--aiS)', color: 'var(--ai)' }}
        >
          {AI_MENTION}
        </div>
      )}

      {/* Mention autocomplete dropdown */}
      {showDropdown && dropdownPos && (
        <div
          className="fixed z-[70] rounded-lg bg-white p-1 shadow-lg"
          style={{
            top: dropdownPos.top,
            left: Math.min(dropdownPos.left, window.innerWidth - 200),
            border: '1px solid var(--n200)',
            minWidth: '180px',
          }}
          data-testid="mention-dropdown"
        >
          <button
            onClick={handleSelectMention}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--n100)]"
          >
            <div
              className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ background: 'var(--ai)' }}
            >
              F
            </div>
            <div>
              <div className="font-medium" style={{ color: 'var(--n800)' }}>
                Follow AI
              </div>
              <div className="text-[10px]" style={{ color: 'var(--n400)' }}>
                Ask AI about this document
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}
