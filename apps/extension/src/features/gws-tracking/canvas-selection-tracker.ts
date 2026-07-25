/**
 * Canvas Selection Tracker — detects text selection in canvas-based Google Docs.
 *
 * Strategies:
 * 1. MutationObserver on selection tiles (event-driven, efficient)
 * 2. Clipboard intercept on copy event
 *
 * No timers — purely event-driven.
 */

import { isCanvasMode, getSelectedText, getSelectionBounds } from '@/content/dom-bridge'

let _isActive = false

function checkSelectionRects(): { hasSelection: boolean; bounds: DOMRect | null } {
  const selectionTiles = document.querySelectorAll('.kix-canvas-tile-selection svg')
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let found = false

  selectionTiles.forEach((svg) => {
    svg.querySelectorAll('rect').forEach((rect) => {
      if (rect.getAttribute('fill') === 'none') return
      const bbox = rect.getBoundingClientRect()
      if (bbox.width > 0 && bbox.height > 0) {
        found = true
        minX = Math.min(minX, bbox.left)
        minY = Math.min(minY, bbox.top)
        maxX = Math.max(maxX, bbox.right)
        maxY = Math.max(maxY, bbox.bottom)
      }
    })
  })

  if (found && maxX > minX) {
    return { hasSelection: true, bounds: new DOMRect(minX, minY, maxX - minX, maxY - minY) }
  }
  return { hasSelection: false, bounds: null }
}

export function startCanvasSelectionTracker(): () => void {
  if (_isActive) return () => {}
  if (!isCanvasMode()) return () => {}

  _isActive = true
  let mutationDebounce: ReturnType<typeof setTimeout> | null = null

  // Strategy 1: MutationObserver on selection tiles
  const observer = new MutationObserver(() => {
    if (mutationDebounce) clearTimeout(mutationDebounce)
    mutationDebounce = setTimeout(() => {
      const { hasSelection, bounds } = checkSelectionRects()
      if (hasSelection && bounds && bounds.width > 10) {
        window.dispatchEvent(new CustomEvent('follow-selection-detected', {
          detail: { bounds, needsCopy: true },
        }))
      } else if (!hasSelection) {
        window.dispatchEvent(new CustomEvent('follow-selection-change', {
          detail: { text: '', bounds: null },
        }))
      }
    }, 250)
  })

  const target = document.querySelector('.kix-canvas-tile-selection') || document.querySelector('.kix-appview-editor')
  if (target) {
    observer.observe(target, { childList: true, subtree: true })
  }

  // Strategy 2: Clipboard intercept
  const handleCopy = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text/plain') || ''
    if (text && text.length > 3) {
      const { bounds } = checkSelectionRects()
      window.dispatchEvent(new CustomEvent('follow-selection-change', {
        detail: { text, bounds },
      }))
    }
  }

  // Mouseup handler for immediate check
  const handleMouseUp = () => {
    if (!isCanvasMode()) {
      const text = getSelectedText()
      const bounds = getSelectionBounds()
      if (text && text.length > 3 && bounds) {
        window.dispatchEvent(new CustomEvent('follow-selection-change', {
          detail: { text, bounds },
        }))
      }
      return
    }

    setTimeout(() => {
      const { hasSelection, bounds } = checkSelectionRects()
      if (hasSelection && bounds) {
        window.dispatchEvent(new CustomEvent('follow-selection-detected', {
          detail: { bounds, needsCopy: true },
        }))
      }
    }, 150)
  }

  document.addEventListener('copy', handleCopy)
  document.addEventListener('mouseup', handleMouseUp)

  return () => {
    _isActive = false
    if (mutationDebounce) clearTimeout(mutationDebounce)
    observer.disconnect()
    document.removeEventListener('copy', handleCopy)
    document.removeEventListener('mouseup', handleMouseUp)
  }
}
