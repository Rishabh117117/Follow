'use client'

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { cn } from '@workspace/shared/utils'

export interface CommandItem {
  id: string
  label: string
  description?: string
  icon?: React.ReactNode
  shortcut?: string | string[]
  onSelect: () => void
  group?: string
}

export interface CommandPaletteProps {
  items: CommandItem[]
  placeholder?: string
  isOpen: boolean
  onClose: () => void
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  items,
  placeholder = 'Type a command or search...',
  isOpen,
  onClose,
}) => {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Filter items by query
  const filteredItems = useMemo(() => {
    if (!query.trim()) return items
    const lower = query.toLowerCase()
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(lower) ||
        item.description?.toLowerCase().includes(lower) ||
        item.group?.toLowerCase().includes(lower)
    )
  }, [items, query])

  // Group filtered items
  const groupedItems = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {}
    for (const item of filteredItems) {
      const group = item.group || 'Actions'
      if (!groups[group]) groups[group] = []
      groups[group].push(item)
    }
    return groups
  }, [filteredItems])

  // Flat list for keyboard navigation
  const flatItems = useMemo(() => Object.values(groupedItems).flat(), [groupedItems])

  // Reset state when opened/closed
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setActiveIndex(0)
      // Focus input after mount
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // Reset active index when query changes
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return
    const active = listRef.current.querySelector('[data-active="true"]')
    if (active) {
      active.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setActiveIndex((prev) => (prev < flatItems.length - 1 ? prev + 1 : 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setActiveIndex((prev) => (prev > 0 ? prev - 1 : flatItems.length - 1))
          break
        case 'Enter':
          e.preventDefault()
          if (flatItems[activeIndex]) {
            flatItems[activeIndex].onSelect()
            onClose()
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [flatItems, activeIndex, onClose]
  )

  if (!isOpen) return null

  let itemCounter = 0

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="animate-in fade-in fixed inset-0 bg-black/60 duration-150"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Palette */}
      <div
        className={cn(
          'relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl',
          'animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200'
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center border-b border-zinc-800 px-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mr-2 shrink-0 text-zinc-500"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-transparent py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            aria-label="Search commands"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="ml-2 rounded p-0.5 text-zinc-500 hover:text-zinc-300"
              aria-label="Clear search"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[300px] overflow-y-auto py-2" role="listbox">
          {flatItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">No results found.</div>
          ) : (
            Object.entries(groupedItems).map(([group, groupItems]) => (
              <div key={group}>
                <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  {group}
                </div>
                {groupItems.map((item) => {
                  const currentIndex = itemCounter++
                  const isActive = currentIndex === activeIndex

                  return (
                    <button
                      key={item.id}
                      data-active={isActive}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors',
                        isActive
                          ? 'bg-violet-600/20 text-zinc-100'
                          : 'text-zinc-300 hover:bg-zinc-800'
                      )}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        item.onSelect()
                        onClose()
                      }}
                      onMouseEnter={() => setActiveIndex(currentIndex)}
                    >
                      {item.icon && (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-zinc-500">
                          {item.icon}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{item.label}</div>
                        {item.description && (
                          <div className="truncate text-xs text-zinc-500">{item.description}</div>
                        )}
                      </div>
                      {item.shortcut && (
                        <span className="ml-auto flex shrink-0 items-center gap-0.5">
                          {(Array.isArray(item.shortcut) ? item.shortcut : [item.shortcut]).map(
                            (key, ki) => (
                              <kbd
                                key={ki}
                                className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
                              >
                                {key}
                              </kbd>
                            )
                          )}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 font-mono">
              &uarr;&darr;
            </kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 font-mono">
              &crarr;
            </kbd>
            Select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 font-mono">
              Esc
            </kbd>
            Close
          </span>
        </div>
      </div>
    </div>
  )
}
