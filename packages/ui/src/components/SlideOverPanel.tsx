'use client'

/**
 * SlideOverPanel — right-anchored slide-in panel (Sprint UI-SPLIT-1).
 *
 * Derived from the common pattern in apps/web: share-v2-panel,
 * right-panel, left-panel, shortcuts-help-panel, follow-notes-panel.
 * Consumers provide title + children; ESC closes, backdrop-click closes.
 *
 * Canonical consumer: migration pending — see UI-SPLIT-1-REPORT.md §3.
 */

import React, { useCallback, useEffect } from 'react'
import { cn } from '@workspace/shared/utils'

export interface SlideOverPanelProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  side?: 'left' | 'right'
  width?: number | string
  children: React.ReactNode
  /** Extra classes applied to the panel surface (not the backdrop). */
  className?: string
  /** Hide the built-in header (title + close button) if the consumer wants to render its own. */
  hideHeader?: boolean
  /** Override aria-label on the root dialog. Defaults to `title`. */
  'aria-label'?: string
  /** data-testid for the panel surface. Default `slide-over-panel`. */
  'data-testid'?: string
  /** data-testid for the backdrop. No default. */
  backdropTestId?: string
  /**
   * Don't apply `overflow-auto` to the panel surface. Useful when the
   * consumer wants a fixed header/footer with an internal scrolling body.
   */
  disableInnerOverflow?: boolean
}

export const SlideOverPanel: React.FC<SlideOverPanelProps> = ({
  isOpen,
  onClose,
  title,
  side = 'right',
  width = 360,
  children,
  className,
  hideHeader,
  'aria-label': ariaLabel,
  'data-testid': testId,
  backdropTestId,
  disableInnerOverflow,
}) => {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose],
  )

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  const widthStyle = typeof width === 'number' ? `${width}px` : width

  return (
    <div
      className="fixed inset-0 z-40 flex"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
    >
      <div
        className={cn(
          'fixed inset-0 bg-black/30 animate-in fade-in duration-150',
          side === 'right' ? 'order-1' : 'order-2',
        )}
        onClick={onClose}
        aria-hidden="true"
        data-testid={backdropTestId}
      />
      <aside
        className={cn(
          'relative z-10 h-full bg-white shadow-2xl animate-in duration-200',
          !disableInnerOverflow && 'overflow-auto',
          side === 'right' ? 'ml-auto slide-in-from-right' : 'mr-auto slide-in-from-left',
          className,
        )}
        style={{ width: widthStyle }}
        data-testid={testId ?? 'slide-over-panel'}
      >
        {!hideHeader && title && (
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-800">{title}</h2>
            <button
              onClick={onClose}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
              aria-label="Close"
              data-testid="slide-over-close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
        {children}
      </aside>
    </div>
  )
}
