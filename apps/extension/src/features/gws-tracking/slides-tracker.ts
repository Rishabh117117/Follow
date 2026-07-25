/**
 * Slides Tracker — monitors slide edits, switches, speaker notes, add/delete.
 *
 * Slide check polling now registered with coordinator instead of own setInterval.
 * MutationObservers for editor and notes remain (event-driven, no timer).
 */

import { signalPipeline } from '@/core/signal-pipeline'
import { coordinator } from '@/core/coordinator'
import { getActiveSlideIndex } from '@/content/dom-bridge'

const SLIDE_CHECK_INTERVAL = 2000

export class SlidesTracker {
  private editorObserver: MutationObserver | null = null
  private notesObserver: MutationObserver | null = null
  private filmstripObserver: MutationObserver | null = null
  private previousSlideIndex = -1
  private followDocId: string
  private googleDocId: string
  private editDebounce: ReturnType<typeof setTimeout> | null = null
  private notesDebounce: ReturnType<typeof setTimeout> | null = null

  constructor(followDocId: string, googleDocId: string) {
    this.followDocId = followDocId
    this.googleDocId = googleDocId
  }

  start(): void {
    // Slide switch check via coordinator (replaces own setInterval)
    coordinator.register({
      id: 'slides-check',
      interval: SLIDE_CHECK_INTERVAL,
      visibilityRequired: true,
      execute: () => this.checkActiveSlide(),
    })

    // Editor content observer
    const editorEl = document.querySelector('.punch-viewer-content, [class*="viewer-content"]')
    if (editorEl) {
      this.editorObserver = new MutationObserver(() => {
        if (this.editDebounce) clearTimeout(this.editDebounce)
        this.editDebounce = setTimeout(() => {
          signalPipeline.emit('gws_slide_edit', {
            googleDocId: this.googleDocId,
            followDocId: this.followDocId,
            docType: 'slides',
            slideIndex: this.previousSlideIndex,
          }, this.followDocId, 'slides')
        }, 2000)
      })
      this.editorObserver.observe(editorEl, { childList: true, subtree: true, characterData: true })
    }

    // Speaker notes observer
    const notesEl = document.querySelector('.punch-viewer-speakernotes-text-container, [class*="speakernotes"]')
    if (notesEl) {
      this.notesObserver = new MutationObserver(() => {
        if (this.notesDebounce) clearTimeout(this.notesDebounce)
        this.notesDebounce = setTimeout(() => {
          signalPipeline.emit('gws_speaker_notes_edit', {
            googleDocId: this.googleDocId,
            followDocId: this.followDocId,
            docType: 'slides',
            slideIndex: this.previousSlideIndex,
          }, this.followDocId, 'slides')
        }, 2000)
      })
      this.notesObserver.observe(notesEl, { childList: true, subtree: true, characterData: true })
    }

    // Filmstrip observer for slide add/delete
    const filmstrip = document.querySelector('.punch-filmstrip-thumbnails, [class*="filmstrip-thumbnails"]')
    if (filmstrip) {
      let prevCount = filmstrip.children.length
      this.filmstripObserver = new MutationObserver(() => {
        const newCount = filmstrip.children.length
        if (newCount !== prevCount) {
          signalPipeline.emit('gws_slide_add_delete', {
            googleDocId: this.googleDocId,
            followDocId: this.followDocId,
            docType: 'slides',
            changeDescription: newCount > prevCount ? 'Slide added' : 'Slide deleted',
          }, this.followDocId, 'slides')
          prevCount = newCount
        }
      })
      this.filmstripObserver.observe(filmstrip, { childList: true })
    }

    signalPipeline.emit('gws_doc_open', {
      googleDocId: this.googleDocId,
      followDocId: this.followDocId,
      docType: 'slides',
    }, this.followDocId, 'slides')
  }

  private checkActiveSlide(): void {
    const idx = getActiveSlideIndex()
    if (idx >= 0 && idx !== this.previousSlideIndex) {
      signalPipeline.emit('gws_slide_switch', {
        googleDocId: this.googleDocId,
        followDocId: this.followDocId,
        docType: 'slides',
        slideIndex: idx,
      }, this.followDocId, 'slides')
      this.previousSlideIndex = idx
    }
  }

  stop(): void {
    coordinator.unregister('slides-check')
    if (this.editorObserver) this.editorObserver.disconnect()
    if (this.notesObserver) this.notesObserver.disconnect()
    if (this.filmstripObserver) this.filmstripObserver.disconnect()
    if (this.editDebounce) clearTimeout(this.editDebounce)
    if (this.notesDebounce) clearTimeout(this.notesDebounce)
    signalPipeline.emit('gws_doc_close', {
      googleDocId: this.googleDocId,
      followDocId: this.followDocId,
      docType: 'slides',
    }, this.followDocId, 'slides')
  }
}
