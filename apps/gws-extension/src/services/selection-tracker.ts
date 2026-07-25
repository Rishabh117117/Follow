/**
 * Selection Tracker — monitors text selection for triggering
 * the Selection Menu overlay and emitting gws_doc_selection signals.
 *
 * Dispatches 'follow-selection-change' CustomEvent on window
 * so the React Selection Menu component can listen and position itself.
 */

import { signalEmitter } from './signal-emitter'
import { getSelectedText, getSelectionBounds } from '@/content/dom-bridge'

export class SelectionTracker {
  private followDocId: string
  private googleDocId: string
  private onSelectionChange: ((text: string | null, bounds: DOMRect | null) => void) | null = null
  private selectionDebounce: ReturnType<typeof setTimeout> | null = null
  private boundSelectionHandler: (() => void) | null = null
  private boundMouseUpHandler: (() => void) | null = null

  constructor(followDocId: string, googleDocId: string) {
    this.followDocId = followDocId
    this.googleDocId = googleDocId
  }

  start(onSelectionChange?: (text: string | null, bounds: DOMRect | null) => void): void {
    this.onSelectionChange = onSelectionChange || null

    // Debounced selection change handler
    this.boundSelectionHandler = () => {
      if (this.selectionDebounce) clearTimeout(this.selectionDebounce)
      this.selectionDebounce = setTimeout(() => {
        this.emitSelection()
      }, 300)
    }

    // Also handle mouseup for more reliable selection detection
    this.boundMouseUpHandler = () => {
      setTimeout(() => this.emitSelection(), 100)
    }

    document.addEventListener('selectionchange', this.boundSelectionHandler)
    document.addEventListener('mouseup', this.boundMouseUpHandler)
  }

  private emitSelection(): void {
    const text = getSelectedText()
    const bounds = getSelectionBounds()

    // Forward to React app via custom event
    this.onSelectionChange?.(text, bounds)
    window.dispatchEvent(
      new CustomEvent('follow-selection-change', {
        detail: { text, bounds },
      })
    )

    // Emit signal for meaningful selections
    if (text && text.length > 3) {
      signalEmitter.emit('gws_doc_selection', {
        googleDocId: this.googleDocId,
        followDocId: this.followDocId,
        selectedText: text.substring(0, 200),
      })
    }
  }

  stop(): void {
    if (this.boundSelectionHandler) {
      document.removeEventListener('selectionchange', this.boundSelectionHandler)
    }
    if (this.boundMouseUpHandler) {
      document.removeEventListener('mouseup', this.boundMouseUpHandler)
    }
    if (this.selectionDebounce) clearTimeout(this.selectionDebounce)
    this.onSelectionChange = null
  }
}
