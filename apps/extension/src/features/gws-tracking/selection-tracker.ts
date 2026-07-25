/**
 * Selection Tracker — monitors text selection for the Selection Menu
 * and emits gws_doc_selection signals.
 *
 * Uses event listeners (not timers), so no coordinator registration needed.
 */

import { signalPipeline } from '@/core/signal-pipeline'
import { getSelectedText, getSelectionBounds } from '@/content/dom-bridge'

export class SelectionTracker {
  private followDocId: string
  private googleDocId: string
  private selectionDebounce: ReturnType<typeof setTimeout> | null = null
  private boundSelectionHandler: (() => void) | null = null
  private boundMouseUpHandler: (() => void) | null = null

  constructor(followDocId: string, googleDocId: string) {
    this.followDocId = followDocId
    this.googleDocId = googleDocId
  }

  start(): void {
    this.boundSelectionHandler = () => {
      if (this.selectionDebounce) clearTimeout(this.selectionDebounce)
      this.selectionDebounce = setTimeout(() => this.emitSelection(), 300)
    }

    this.boundMouseUpHandler = () => {
      setTimeout(() => this.emitSelection(), 100)
    }

    document.addEventListener('selectionchange', this.boundSelectionHandler)
    document.addEventListener('mouseup', this.boundMouseUpHandler)
  }

  private emitSelection(): void {
    const text = getSelectedText()
    const bounds = getSelectionBounds()

    window.dispatchEvent(
      new CustomEvent('follow-selection-change', { detail: { text, bounds } })
    )

    if (text && text.length > 3) {
      signalPipeline.emit('gws_doc_selection', {
        googleDocId: this.googleDocId,
        followDocId: this.followDocId,
        selectedText: text.substring(0, 200),
      }, this.followDocId)
    }
  }

  stop(): void {
    if (this.boundSelectionHandler) document.removeEventListener('selectionchange', this.boundSelectionHandler)
    if (this.boundMouseUpHandler) document.removeEventListener('mouseup', this.boundMouseUpHandler)
    if (this.selectionDebounce) clearTimeout(this.selectionDebounce)
  }
}
