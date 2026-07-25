/**
 * Cursor Tracker — monitors Google Docs DOM for cursor position changes
 * and emits gws_doc_selection signals.
 */

import { signalEmitter } from './signal-emitter'
import { observeCursorPosition, getSelectedText } from '@/content/dom-bridge'

let cleanup: (() => void) | null = null
let lastSelectionText = ''

/**
 * Start tracking cursor position and selection changes.
 */
export function startCursorTracker() {
  cleanup = observeCursorPosition((position) => {
    const selectedText = getSelectedText()

    // Only emit on meaningful selection changes
    if (selectedText && selectedText !== lastSelectionText) {
      lastSelectionText = selectedText
      signalEmitter.emit('gws_doc_selection', {
        paragraphIndex: position?.paragraphIndex,
        selectedLength: selectedText.length,
        selectedPreview: selectedText.slice(0, 100),
      })
    }
  })
}

/**
 * Stop tracking cursor position.
 */
export function stopCursorTracker() {
  cleanup?.()
  cleanup = null
  lastSelectionText = ''
}
