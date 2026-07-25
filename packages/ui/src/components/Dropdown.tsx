'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@workspace/shared/utils'

export interface DropdownItem {
  label: string
  onClick: () => void
  icon?: React.ReactNode
}

export interface DropdownProps {
  trigger: React.ReactNode
  items: DropdownItem[]
  align?: 'left' | 'right'
  className?: string
}

export const Dropdown: React.FC<DropdownProps> = ({
  trigger,
  items,
  align = 'left',
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setIsOpen(false)
    setActiveIndex(-1)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        close()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, close])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setIsOpen(true)
        setActiveIndex(0)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((prev) => (prev + 1) % items.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((prev) => (prev - 1 + items.length) % items.length)
        break
      case 'Enter':
        e.preventDefault()
        if (activeIndex >= 0 && activeIndex < items.length) {
          const item = items[activeIndex]
          if (item) {
            item.onClick()
          }
          close()
        }
        break
      case 'Escape':
        e.preventDefault()
        close()
        break
    }
  }

  return (
    <div ref={dropdownRef} className={cn('relative inline-block', className)}>
      <div
        onClick={() => {
          setIsOpen((prev) => !prev)
          if (!isOpen) setActiveIndex(-1)
        }}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {trigger}
      </div>

      {isOpen && (
        <div
          ref={menuRef}
          className={cn(
            'absolute z-50 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl',
            'animate-in fade-in zoom-in-95 duration-150',
            align === 'right' ? 'right-0' : 'left-0'
          )}
          role="menu"
          onKeyDown={handleKeyDown}
        >
          {items.map((item, index) => (
            <button
              key={index}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 transition-colors',
                'hover:bg-zinc-800 hover:text-zinc-100',
                activeIndex === index && 'bg-zinc-800 text-zinc-100'
              )}
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                item.onClick()
                close()
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {item.icon && (
                <span className="flex h-4 w-4 items-center justify-center text-zinc-500">
                  {item.icon}
                </span>
              )}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
