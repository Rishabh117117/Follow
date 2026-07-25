'use client'

/**
 * ContextMenu — anchored popup menu (Sprint UI-SPLIT-1).
 *
 * Derived from the common pattern in apps/web: item-action-menu,
 * editor-context-menu, clip-context-menu, conversation-menu,
 * canvas/context-menu, file-browser/context-menu.
 *
 * Consumers pass an items[] array; click outside or ESC closes. An
 * optional `anchor` positions the menu next to a triggering element; when
 * omitted the consumer is expected to wrap it in a positioned container.
 *
 * Canonical consumer: migration pending — see UI-SPLIT-1-REPORT.md §3.
 */

import React, { useEffect, useRef } from 'react'
import { cn } from '@workspace/shared/utils'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: React.ReactNode
  onSelect: () => void
  disabled?: boolean
  /** Show above a top or bottom divider line. */
  dividerAbove?: boolean
  /** Render the label in a danger color (e.g. Delete). */
  danger?: boolean
  /**
   * Override the item's label color. Overrides `danger`. Use for accent colors
   * that don't map to "danger" (e.g. amber "Hide" or emerald "Unhide").
   */
  accentColor?: string
}

export interface ContextMenuProps {
  items: ContextMenuItem[]
  onClose: () => void
  /** Optional absolute position (from a right-click or button click event). */
  position?: { x: number; y: number }
  className?: string
  /**
   * Prefix for `data-testid` attrs — defaults to `"context-menu"`. Each item
   * gets `data-testid={`${testIdPrefix}-item-${id}`}` and the menu root gets
   * `data-testid={testIdPrefix}`. Consumers that pre-existed the primitive
   * set this to keep their tests stable.
   */
  testIdPrefix?: string
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  items,
  onClose,
  position,
  className,
  testIdPrefix = 'context-menu',
}) => {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [onClose])

  const style: React.CSSProperties | undefined = position
    ? { position: 'fixed', top: position.y, left: position.x, zIndex: 50 }
    : undefined

  return (
    <div
      ref={ref}
      role="menu"
      data-testid={testIdPrefix}
      className={cn(
        'min-w-[180px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg',
        className,
      )}
      style={style}
    >
      {items.map((item) => (
        <React.Fragment key={item.id}>
          {item.dividerAbove && <div className="my-1 border-t border-zinc-200" />}
          <button
            type="button"
            role="menuitem"
            data-testid={`${testIdPrefix}-${item.id}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              item.onSelect()
              onClose()
            }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
              item.danger && !item.accentColor
                ? 'text-red-600 hover:bg-red-50'
                : !item.accentColor
                  ? 'text-zinc-800 hover:bg-zinc-100'
                  : 'hover:bg-zinc-100',
              item.disabled && 'cursor-not-allowed opacity-50',
            )}
            style={item.accentColor ? { color: item.accentColor } : undefined}
          >
            {item.icon && <span aria-hidden>{item.icon}</span>}
            <span className="flex-1">{item.label}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  )
}
