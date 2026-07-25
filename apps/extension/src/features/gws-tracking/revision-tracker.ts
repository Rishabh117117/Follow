/**
 * Revision Tracker — monitors Google Docs content via a SINGLE MutationObserver
 * plus coordinator-registered snapshot diff and content sync.
 *
 * Replaces the old RevisionPoller which had 3 independent timers + 2 observers.
 * Now: 1 observer + 2 coordinator handlers (snapshot-diff, content-sync).
 */

import { signalPipeline } from '@/core/signal-pipeline'
import { coordinator } from '@/core/coordinator'
import { getParagraphTexts, getDocumentText } from '@/content/dom-bridge'
import { sendToBackground } from '@/core/message-bus'

const MUTATION_DEBOUNCE_MS = 2000
const SNAPSHOT_INTERVAL_MS = 30_000
const CONTENT_SYNC_INTERVAL_MS = 300_000

export class RevisionTracker {
  private previousParagraphs: string[] = []
  private mutationDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private observer: MutationObserver | null = null
  private titleObserver: MutationObserver | null = null
  private followDocId: string
  private googleDocId: string
  private lastSyncedContentHash = ''
  private isDirty = false

  constructor(followDocId: string, googleDocId: string) {
    this.followDocId = followDocId
    this.googleDocId = googleDocId
  }

  start(): void {
    this.previousParagraphs = getParagraphTexts()

    // Single MutationObserver on the editor
    const editorEl = document.querySelector('.kix-appview-editor')
    if (editorEl) {
      this.observer = new MutationObserver((mutations) => {
        this.isDirty = true
        if (this.mutationDebounceTimer) clearTimeout(this.mutationDebounceTimer)
        this.mutationDebounceTimer = setTimeout(() => this.handleMutations(mutations), MUTATION_DEBOUNCE_MS)
      })
      this.observer.observe(editorEl, { childList: true, subtree: true, characterData: true })
    }

    // Title observer
    const titleEl = document.querySelector('.docs-title-input')
    if (titleEl) {
      let previousTitle = titleEl.textContent?.trim() || ''
      this.titleObserver = new MutationObserver(() => {
        const newTitle = titleEl.textContent?.trim() || ''
        if (newTitle !== previousTitle) {
          signalPipeline.emit('gws_title_change', {
            googleDocId: this.googleDocId,
            followDocId: this.followDocId,
            previousValue: previousTitle,
            newValue: newTitle,
          }, this.followDocId, 'docs')
          previousTitle = newTitle
        }
      })
      this.titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true })
    }

    // Register snapshot diff with coordinator (replaces independent setInterval)
    coordinator.register({
      id: 'snapshot-diff',
      interval: SNAPSHOT_INTERVAL_MS,
      visibilityRequired: true,
      execute: () => this.runSnapshotDiff(),
    })

    // Register content sync with coordinator — only fires when dirty
    coordinator.register({
      id: 'content-sync',
      interval: CONTENT_SYNC_INTERVAL_MS,
      visibilityRequired: true,
      execute: () => this.syncContent(),
    })

    signalPipeline.emit('gws_doc_open', {
      googleDocId: this.googleDocId,
      followDocId: this.followDocId,
      docType: 'docs',
    }, this.followDocId, 'docs')
  }

  private handleMutations(mutations: MutationRecord[]): void {
    let hasTextChange = false
    let hasStructuralChange = false

    for (const m of mutations) {
      if (m.type === 'characterData') {
        hasTextChange = true
      } else if (m.type === 'childList') {
        const isStructural = Array.from(m.addedNodes)
          .concat(Array.from(m.removedNodes))
          .some((n) => (n as HTMLElement).classList?.contains('kix-paragraphrenderer'))
        if (isStructural) hasStructuralChange = true
        else hasTextChange = true
      }
    }

    if (hasStructuralChange) {
      signalPipeline.emit('gws_doc_structural', {
        googleDocId: this.googleDocId,
        followDocId: this.followDocId,
        docType: 'docs',
      }, this.followDocId, 'docs')
    }
    if (hasTextChange) {
      signalPipeline.emit('gws_doc_edit', {
        googleDocId: this.googleDocId,
        followDocId: this.followDocId,
        docType: 'docs',
        changeDescription: 'Text content edited',
      }, this.followDocId, 'docs')
    }
  }

  private runSnapshotDiff(): void {
    const currentParagraphs = getParagraphTexts()
    const changedIndexes: number[] = []
    let wordDelta = 0

    const maxLen = Math.max(this.previousParagraphs.length, currentParagraphs.length)
    for (let i = 0; i < maxLen; i++) {
      const prev = this.previousParagraphs[i] || ''
      const curr = currentParagraphs[i] || ''
      if (prev !== curr) {
        changedIndexes.push(i)
        const prevWords = prev.split(/\s+/).filter(Boolean).length
        const currWords = curr.split(/\s+/).filter(Boolean).length
        wordDelta += currWords - prevWords
      }
    }

    if (changedIndexes.length > 0) {
      signalPipeline.emit('gws_doc_edit', {
        googleDocId: this.googleDocId,
        followDocId: this.followDocId,
        docType: 'docs',
        changedParagraphs: changedIndexes,
        wordDelta,
        changeDescription: `${changedIndexes.length} paragraph(s) changed (${wordDelta >= 0 ? '+' : ''}${wordDelta} words)`,
      }, this.followDocId, 'docs')
    }

    this.previousParagraphs = currentParagraphs
  }

  private simpleHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
    }
    return String(hash)
  }

  private syncContent(): void {
    // Only sync when user has actually edited (dirty flag)
    if (!this.isDirty) return
    this.isDirty = false

    const content = getDocumentText()
    if (!content || content.length < 10) return

    const hash = this.simpleHash(content)
    if (hash === this.lastSyncedContentHash) return
    this.lastSyncedContentHash = hash

    sendToBackground({
      type: 'CONTENT_SYNC',
      payload: {
        externalDocId: this.followDocId,
        content: content.substring(0, 50000),
        paragraphCount: this.previousParagraphs.length,
      },
    })
  }

  stop(): void {
    if (this.observer) this.observer.disconnect()
    if (this.titleObserver) this.titleObserver.disconnect()
    if (this.mutationDebounceTimer) clearTimeout(this.mutationDebounceTimer)
    coordinator.unregister('snapshot-diff')
    coordinator.unregister('content-sync')
    signalPipeline.emit('gws_doc_close', {
      googleDocId: this.googleDocId,
      followDocId: this.followDocId,
      docType: 'docs',
    }, this.followDocId, 'docs')
  }
}
