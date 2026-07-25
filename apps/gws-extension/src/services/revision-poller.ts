/**
 * Revision Poller — monitors Google Docs DOM for content changes
 * and emits detailed gws_doc_* signals via three complementary mechanisms:
 *
 * 1. DOM Mutation Observer (primary — near real-time)
 *    - Watch .kix-appview-editor for childList + characterData mutations
 *    - Debounce 2 seconds — batch mutations into a single signal
 *    - Classify: text edit vs formatting vs structural (paragraph add/delete)
 *
 * 2. Content Snapshot Diffing (secondary — every 30 seconds)
 *    - Read full document text via .kix-paragraphrenderer elements
 *    - Compare against previous snapshot, compute word-level diff
 *    - Emit gws_doc_edit with changedParagraphs + wordDelta
 *
 * 3. Title Observer (continuous)
 *    - MutationObserver on .docs-title-input
 *    - Emit gws_title_change when title text changes
 */

import { signalEmitter } from './signal-emitter'
import { getParagraphTexts, getDocumentText } from '@/content/dom-bridge'

const MUTATION_DEBOUNCE_MS = 2000
const SNAPSHOT_INTERVAL_MS = 30_000
const CONTENT_SYNC_INTERVAL_MS = 300_000 // 5 minutes

// Sprint IX-9: trigger an immediate versioned snapshot once this many
// edit emissions have accumulated since the last content sync. Uses the
// same CONTENT_SYNC path as the periodic timer — the backend dedups by
// content-hash, so calling early is safe.
const SIGNIFICANT_EDIT_THRESHOLD = 5

export class RevisionPoller {
  private previousParagraphs: string[] = []
  private mutationDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private snapshotTimer: ReturnType<typeof setInterval> | null = null
  private contentSyncTimer: ReturnType<typeof setInterval> | null = null
  private observer: MutationObserver | null = null
  private titleObserver: MutationObserver | null = null
  private followDocId: string
  private googleDocId: string
  private lastSyncedContentHash = ''
  // Sprint IX-9: count edit emissions since last content sync so we can
  // force a versioned snapshot once the batch looks significant.
  private editsSinceSync = 0

  constructor(followDocId: string, googleDocId: string) {
    this.followDocId = followDocId
    this.googleDocId = googleDocId
  }

  start(): void {
    // 1. Initialize baseline snapshot
    this.previousParagraphs = getParagraphTexts()

    // 2. DOM Mutation Observer on the editor
    const editorEl = document.querySelector('.kix-appview-editor')
    if (editorEl) {
      this.observer = new MutationObserver((mutations) => {
        if (this.mutationDebounceTimer) clearTimeout(this.mutationDebounceTimer)
        this.mutationDebounceTimer = setTimeout(() => {
          this.handleMutations(mutations)
        }, MUTATION_DEBOUNCE_MS)
      })
      this.observer.observe(editorEl, {
        childList: true,
        subtree: true,
        characterData: true,
      })
    }

    // 3. Periodic snapshot diff
    this.snapshotTimer = setInterval(() => this.runSnapshotDiff(), SNAPSHOT_INTERVAL_MS)

    // 4. Periodic content sync to backend
    this.contentSyncTimer = setInterval(() => this.syncContent(), CONTENT_SYNC_INTERVAL_MS)

    // 5. Title observer
    const titleEl = document.querySelector('.docs-title-input')
    if (titleEl) {
      let previousTitle = titleEl.textContent?.trim() || ''
      this.titleObserver = new MutationObserver(() => {
        const newTitle = titleEl.textContent?.trim() || ''
        if (newTitle !== previousTitle) {
          signalEmitter.emit('gws_title_change', {
            googleDocId: this.googleDocId,
            followDocId: this.followDocId,
            previousValue: previousTitle,
            newValue: newTitle,
          })
          previousTitle = newTitle
        }
      })
      this.titleObserver.observe(titleEl, {
        childList: true,
        characterData: true,
        subtree: true,
      })
    }

    // Emit doc open signal
    signalEmitter.emit('gws_doc_open', {
      googleDocId: this.googleDocId,
      followDocId: this.followDocId,
      docType: 'docs',
    })
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
      signalEmitter.emit('gws_doc_structural', {
        googleDocId: this.googleDocId,
        followDocId: this.followDocId,
        docType: 'docs',
        changeDescription: 'Structural change detected (paragraph added/removed)',
      })
      this.editsSinceSync++
    }
    if (hasTextChange) {
      signalEmitter.emit('gws_doc_edit', {
        googleDocId: this.googleDocId,
        followDocId: this.followDocId,
        docType: 'docs',
        changeDescription: 'Text content edited',
      })
      this.editsSinceSync++
    }

    // Sprint IX-9: significant-edit snapshot trigger. Once enough edit
    // emissions have accumulated, force a content sync early so the
    // backend creates a versioned gws_snapshots row before the 5-min
    // periodic timer would have fired.
    //
    // IMPORTANT: reset the counter at the call site BEFORE invoking
    // syncContent(), not inside syncContent() itself. syncContent() has
    // two early-return paths (empty/short content during kix reflow; and
    // hash-unchanged dedup) and if we reset only inside syncContent we
    // get stuck: getDocumentText() briefly returns '' during kix virtual
    // re-render → counter never clears → every subsequent mutation
    // re-calls syncContent which no-ops → signif-edit trigger wedged.
    // Resetting here treats the threshold as "consumed by intent to
    // sync"; any edits that the transient sync missed will still be
    // captured by the next periodic sync or the next significant batch.
    if (this.editsSinceSync >= SIGNIFICANT_EDIT_THRESHOLD) {
      this.editsSinceSync = 0
      this.syncContent()
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
      signalEmitter.emit('gws_doc_edit', {
        googleDocId: this.googleDocId,
        followDocId: this.followDocId,
        docType: 'docs',
        changedParagraphs: changedIndexes,
        wordDelta,
        changeDescription: `${changedIndexes.length} paragraph(s) changed (${wordDelta >= 0 ? '+' : ''}${wordDelta} words)`,
      })
    }

    this.previousParagraphs = currentParagraphs
  }

  /**
   * Simple hash for change detection — avoids sending identical content.
   */
  private simpleHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
    }
    return String(hash)
  }

  private syncContent(): void {
    const content = getDocumentText()
    if (!content || content.length < 10) return

    // Skip sync if content hasn't changed since last sync
    const hash = this.simpleHash(content)
    if (hash === this.lastSyncedContentHash) return
    this.lastSyncedContentHash = hash

    // Note: editsSinceSync is reset at the call site in handleMutations()
    // BEFORE this function is called, so we don't need to touch it here.
    // That keeps the reset decoupled from syncContent's early returns.

    try {
      chrome.runtime.sendMessage({
        type: 'CONTENT_SYNC',
        payload: {
          externalDocId: this.followDocId,
          content: content.substring(0, 50000),
          paragraphCount: this.previousParagraphs.length,
        },
      })
    } catch {
      // Non-critical — background worker may not be ready
    }
  }

  stop(): void {
    if (this.observer) this.observer.disconnect()
    if (this.titleObserver) this.titleObserver.disconnect()
    if (this.snapshotTimer) clearInterval(this.snapshotTimer)
    if (this.contentSyncTimer) clearInterval(this.contentSyncTimer)
    if (this.mutationDebounceTimer) clearTimeout(this.mutationDebounceTimer)
    signalEmitter.emit('gws_doc_close', {
      googleDocId: this.googleDocId,
      followDocId: this.followDocId,
      docType: 'docs',
    })
  }
}
