/**
 * Google Slides signal capture.
 * Monitor slide content edits, slide switches, speaker notes, slide add/delete.
 */

import { signalEmitter } from './signal-emitter'
import { sendToBackground } from '@/lib/message-passing'

const CONTENT_SYNC_INTERVAL_MS = 30_000
const MAX_SLIDES_CHARS = 8_000

export class SlidesTracker {
  private editorObserver: MutationObserver | null = null
  private notesObserver: MutationObserver | null = null
  private filmstripObserver: MutationObserver | null = null
  private previousSlideIndex: number = -1
  private slideCheckTimer: ReturnType<typeof setInterval> | null = null
  private contentSyncTimer: ReturnType<typeof setInterval> | null = null
  private followDocId: string
  private googleDocId: string

  constructor(followDocId: string, googleDocId: string) {
    this.followDocId = followDocId
    this.googleDocId = googleDocId
  }

  start(): void {
    // 1. Monitor slide filmstrip for active slide changes
    //    Selected slide thumbnail: [aria-selected="true"] in filmstrip
    this.slideCheckTimer = setInterval(() => this.checkActiveSlide(), 1500)

    // 2. Monitor main editing area for content changes
    const editorEl = document.querySelector(
      '.punch-viewer-content, [class*="viewer-content"]'
    )
    if (editorEl) {
      let editDebounce: ReturnType<typeof setTimeout> | null = null
      this.editorObserver = new MutationObserver(() => {
        if (editDebounce) clearTimeout(editDebounce)
        editDebounce = setTimeout(() => {
          signalEmitter.emit('gws_slide_edit', {
            googleDocId: this.googleDocId,
            followDocId: this.followDocId,
            docType: 'slides',
            slideIndex: this.previousSlideIndex,
            changeDescription: 'Slide content edited',
          })
        }, 2000)
      })
      this.editorObserver.observe(editorEl, {
        childList: true,
        subtree: true,
        characterData: true,
      })
    }

    // 3. Monitor speaker notes
    const notesEl = document.querySelector(
      '.punch-viewer-speakernotes-text-container, [class*="speakernotes"]'
    )
    if (notesEl) {
      let notesDebounce: ReturnType<typeof setTimeout> | null = null
      this.notesObserver = new MutationObserver(() => {
        if (notesDebounce) clearTimeout(notesDebounce)
        notesDebounce = setTimeout(() => {
          signalEmitter.emit('gws_speaker_notes_edit', {
            googleDocId: this.googleDocId,
            followDocId: this.followDocId,
            docType: 'slides',
            slideIndex: this.previousSlideIndex,
          })
        }, 2000)
      })
      this.notesObserver.observe(notesEl, {
        childList: true,
        subtree: true,
        characterData: true,
      })
    }

    // 4. Monitor filmstrip for slide add/delete (child count change)
    const filmstrip = document.querySelector(
      '.punch-filmstrip-thumbnails, [class*="filmstrip-thumbnails"]'
    )
    if (filmstrip) {
      let prevCount = filmstrip.children.length
      this.filmstripObserver = new MutationObserver(() => {
        const newCount = filmstrip.children.length
        if (newCount !== prevCount) {
          signalEmitter.emit('gws_slide_add_delete', {
            googleDocId: this.googleDocId,
            followDocId: this.followDocId,
            docType: 'slides',
            changeDescription: newCount > prevCount ? 'Slide added' : 'Slide deleted',
          })
          prevCount = newCount
        }
      })
      this.filmstripObserver.observe(filmstrip, { childList: true })
    }

    signalEmitter.emit('gws_doc_open', {
      googleDocId: this.googleDocId,
      followDocId: this.followDocId,
      docType: 'slides',
    })

    // Periodic content sync — current slide text + notes for AI context
    this.contentSyncTimer = setInterval(() => this.syncContent(), CONTENT_SYNC_INTERVAL_MS)
    setTimeout(() => this.syncContent(), 4000)
  }

  private async syncContent(): Promise<void> {
    try {
      const viewerEl = document.querySelector<HTMLElement>('.punch-viewer-content, [class*="viewer-content"]')
      const notesEl = document.querySelector<HTMLElement>(
        '.punch-viewer-speakernotes-text-container, [class*="speakernotes"]'
      )
      const slideText = (viewerEl?.innerText || '').trim()
      const notesText = (notesEl?.innerText || '').trim()
      if (!slideText && !notesText) return

      const totalThumbs = document.querySelectorAll(
        '.punch-filmstrip-thumbnail, [class*="filmstrip-thumbnail"]'
      ).length
      const currentSlide = this.previousSlideIndex >= 0 ? this.previousSlideIndex + 1 : 1
      const firstLine = slideText.split('\n').find((l) => l.trim().length > 0) || ''

      const lines: string[] = []
      lines.push(`Current slide: ${currentSlide} of ${totalThumbs || '?'}`)
      if (firstLine) lines.push(`Slide ${currentSlide} title: "${firstLine.slice(0, 120)}"`)
      if (slideText) lines.push(`Slide ${currentSlide} content:\n${slideText}`)
      if (notesText) lines.push(`Speaker notes:\n${notesText}`)

      const content = lines.join('\n\n').slice(0, MAX_SLIDES_CHARS)

      await sendToBackground({
        type: 'CONTENT_SYNC',
        payload: {
          externalDocId: this.googleDocId,
          content,
          paragraphCount: slideText.split('\n').length,
          docType: 'slides',
          slideIndex: currentSlide,
        } as unknown as Record<string, unknown>,
      })
    } catch (err) {
      console.warn('[SlidesTracker] syncContent failed:', err)
    }
  }

  private checkActiveSlide(): void {
    const activeThumb = document.querySelector(
      '.punch-filmstrip-thumbnail[aria-selected="true"], [class*="filmstrip"] [aria-selected="true"]'
    )
    if (activeThumb) {
      const allThumbs = document.querySelectorAll(
        '.punch-filmstrip-thumbnail, [class*="filmstrip-thumbnail"]'
      )
      const idx = Array.from(allThumbs).indexOf(activeThumb)
      if (idx !== this.previousSlideIndex && idx >= 0) {
        signalEmitter.emit('gws_slide_switch', {
          googleDocId: this.googleDocId,
          followDocId: this.followDocId,
          docType: 'slides',
          slideIndex: idx,
        })
        this.previousSlideIndex = idx
      }
    }
  }

  stop(): void {
    if (this.editorObserver) this.editorObserver.disconnect()
    if (this.notesObserver) this.notesObserver.disconnect()
    if (this.filmstripObserver) this.filmstripObserver.disconnect()
    if (this.slideCheckTimer) clearInterval(this.slideCheckTimer)
    if (this.contentSyncTimer) clearInterval(this.contentSyncTimer)
    signalEmitter.emit('gws_doc_close', {
      googleDocId: this.googleDocId,
      followDocId: this.followDocId,
      docType: 'slides',
    })
  }
}
