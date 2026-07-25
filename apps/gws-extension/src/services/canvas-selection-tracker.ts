/**
 * Canvas Selection Tracker
 *
 * Detects text selection in canvas-based Google Docs where
 * window.getSelection() returns empty. Uses two strategies:
 *
 * 1. MutationObserver on selection tiles (primary — efficient, event-driven)
 * 2. Clipboard intercept: On copy event, reads clipboard text
 *
 * Mouseup is used only to trigger a single rect check (no retry loop).
 * Dispatches 'follow-selection-change' events with text and bounds.
 */

import { isCanvasMode } from '@/content/canvas-position-adapter'
import { getSelectedText, getSelectionBounds } from '@/content/dom-bridge'

let _selectedText = ''
let _selectionBounds: DOMRect | null = null
let _isActive = false

/**
 * Get the current captured selection text
 */
export function getCapturedSelection(): string {
  return _selectedText
}

/**
 * Get the current selection bounds
 */
export function getCapturedSelectionBounds(): DOMRect | null {
  return _selectionBounds
}

/**
 * Check for selection highlight rects in the canvas.
 * Google Docs renders selection highlights as <rect> elements
 * inside .kix-canvas-tile-selection SVGs.
 */
function checkSelectionRects(): boolean {
  const selectionTiles = document.querySelectorAll('.kix-canvas-tile-selection svg')
  let hasSelection = false
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  selectionTiles.forEach((svg) => {
    const rects = svg.querySelectorAll('rect')
    if (rects.length === 0) return

    rects.forEach((rect) => {
      const fill = rect.getAttribute('fill') || ''
      if (fill === 'none') return

      const bbox = rect.getBoundingClientRect()
      if (bbox.width > 0 && bbox.height > 0) {
        hasSelection = true
        minX = Math.min(minX, bbox.left)
        minY = Math.min(minY, bbox.top)
        maxX = Math.max(maxX, bbox.right)
        maxY = Math.max(maxY, bbox.bottom)
      }
    })
  })

  if (hasSelection && maxX > minX) {
    _selectionBounds = new DOMRect(minX, minY, maxX - minX, maxY - minY)
    return true
  }

  _selectionBounds = null
  return false
}

/**
 * Start tracking selections. Returns cleanup function.
 */
export function startCanvasSelectionTracker(): () => void {
  if (_isActive) return () => {}

  // Only activate for canvas-mode Google Docs.
  // DOM-mode docs are handled by SelectionTracker.
  if (!isCanvasMode()) return () => {}

  _isActive = true

  // --- Strategy 1: MutationObserver on selection tiles (event-driven, efficient) ---
  let mutationDebounce: ReturnType<typeof setTimeout> | null = null
  const selectionObserver = new MutationObserver(() => {
    if (mutationDebounce) clearTimeout(mutationDebounce)
    mutationDebounce = setTimeout(() => {
      const hasSelection = checkSelectionRects()
      if (hasSelection && _selectionBounds && _selectionBounds.width > 10) {
        window.dispatchEvent(
          new CustomEvent('follow-selection-detected', {
            detail: { bounds: _selectionBounds, needsCopy: true },
          })
        )
      } else if (!hasSelection && _selectionBounds) {
        _selectedText = ''
        _selectionBounds = null
        window.dispatchEvent(
          new CustomEvent('follow-selection-change', {
            detail: { text: '', bounds: null },
          })
        )
      }
    }, 250)
  })

  // Only observe the specific selection tile container, not the entire editor.
  // Selection rects are added/removed as child nodes — no need to watch attributes.
  const selectionContainer = document.querySelector('.kix-canvas-tile-selection')
  const editor = document.querySelector('.kix-appview-editor')
  const observeTarget = selectionContainer || editor
  if (observeTarget) {
    selectionObserver.observe(observeTarget, { childList: true, subtree: true })
  }

  // --- Strategy 2: Clipboard intercept for getting selected text ---
  const handleCopy = (e: ClipboardEvent) => {
    let text = e.clipboardData?.getData('text/plain') || ''

    if (text && text.length > 3) {
      _selectedText = text
      checkSelectionRects()
      window.dispatchEvent(
        new CustomEvent('follow-selection-change', {
          detail: { text: _selectedText, bounds: _selectionBounds },
        })
      )
      return
    }

    // Fallback: read clipboard async after a short delay
    setTimeout(async () => {
      try {
        text = await navigator.clipboard.readText()
        if (text && text.length > 3) {
          _selectedText = text
          checkSelectionRects()
          window.dispatchEvent(
            new CustomEvent('follow-selection-change', {
              detail: { text: _selectedText, bounds: _selectionBounds },
            })
          )
        }
      } catch {
        // Clipboard read may fail without permissions
      }
    }, 100)
  }

  // --- Mouseup: single rect check for DOM mode + canvas mode ---
  const handleMouseUp = () => {
    if (!isCanvasMode()) {
      // DOM mode — use native selection API
      const text = getSelectedText()
      const bounds = getSelectionBounds()
      if (text && text.length > 3 && bounds) {
        _selectedText = text
        _selectionBounds = bounds
        window.dispatchEvent(
          new CustomEvent('follow-selection-change', {
            detail: { text, bounds },
          })
        )
      }
      return
    }

    // Canvas mode — single check after mouseup (no retry loop)
    setTimeout(() => {
      const hasSelection = checkSelectionRects()
      if (hasSelection && _selectionBounds) {
        window.dispatchEvent(
          new CustomEvent('follow-selection-detected', {
            detail: { bounds: _selectionBounds, needsCopy: true },
          })
        )
      } else if (!hasSelection && _selectedText) {
        _selectedText = ''
        _selectionBounds = null
        window.dispatchEvent(
          new CustomEvent('follow-selection-change', {
            detail: { text: '', bounds: null },
          })
        )
      }
    }, 150)
  }

  document.addEventListener('copy', handleCopy)
  document.addEventListener('mouseup', handleMouseUp)

  return () => {
    _isActive = false
    if (mutationDebounce) clearTimeout(mutationDebounce)
    document.removeEventListener('copy', handleCopy)
    document.removeEventListener('mouseup', handleMouseUp)
    selectionObserver.disconnect()
  }
}
