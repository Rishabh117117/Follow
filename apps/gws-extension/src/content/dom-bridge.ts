/**
 * Google Docs DOM reading utilities.
 * IMPORTANT: These are READ-ONLY operations on Google's DOM.
 * We never modify Google Docs DOM for visual changes — all Follow UI renders inside shadow DOM.
 */

import type { GoogleDocType } from '@/lib/google-doc-utils'
import { fetchDocumentContentViaAPI } from '@/lib/google-docs-api'
import {
  isCanvasMode,
  getParagraphBounds as canvasGetParagraphBounds,
  refreshPositionCache,
} from './canvas-position-adapter'

export interface GoogleDocState {
  docType: GoogleDocType
  googleDocId: string
  title: string
  cursorPosition: { paragraphIndex: number; charOffset: number } | null
  selectedText: string | null
  selectionBounds: DOMRect | null
  collaborators: { name: string; color: string; avatarUrl?: string }[]
  isEditing: boolean
}

/**
 * Read the document title from the Google Docs DOM.
 */
export function getDocTitle(): string {
  const el = document.querySelector<HTMLElement>(
    '.docs-title-input, [class*="title-input"], .docs-title-widget input'
  )
  if (el) {
    // Input elements have .value, other elements have .textContent
    if (el instanceof HTMLInputElement) return el.value?.trim() || 'Untitled'
    return el.textContent?.trim() || 'Untitled'
  }
  // Fallback: try document title
  const docTitle = document.title.replace(/ - Google (Docs|Sheets|Slides)$/, '').trim()
  return docTitle || 'Untitled'
}

/**
 * Get the currently selected text in the Google Doc.
 * Google Docs uses its own selection model, but document.getSelection()
 * works in most cases for reading.
 */
export function getSelectedText(): string | null {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed) return null
  const text = selection.toString().trim()
  return text || null
}

/**
 * Get the bounding rectangle of the current selection.
 * Used for positioning the Selection Menu overlay.
 */
export function getSelectionBounds(): DOMRect | null {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  return selection.getRangeAt(0).getBoundingClientRect()
}

/**
 * Get active collaborator cursors visible in the document.
 * Google Docs renders collaborator cursors as colored elements.
 */
export function getCollaborators(): { name: string; color: string }[] {
  const cursors = document.querySelectorAll<HTMLElement>(
    '.kix-cursor-name, [class*="cursor-name"]'
  )
  return Array.from(cursors).map((el) => ({
    name: el.textContent?.trim() || 'Unknown',
    color: el.style.backgroundColor || '#888',
  }))
}

/**
 * Get the editor container element for the current document type.
 */
function getEditorContainer(docType: GoogleDocType): Element | null {
  switch (docType) {
    case 'docs':
      return document.querySelector('.kix-appview-editor')
    case 'sheets':
      return document.querySelector('.waffle, [class*="waffle"]')
    case 'slides':
      return document.querySelector('.punch-viewer-content, [class*="punch-viewer"]')
    default:
      return null
  }
}

/**
 * Set up a MutationObserver to watch for content changes in the Google Doc editor.
 * Calls the callback with the type of change detected.
 */
export function observeContentChanges(
  docType: GoogleDocType,
  callback: (changeType: 'text_edit' | 'structural_change' | 'formatting_change') => void
): MutationObserver {
  const editorEl = getEditorContainer(docType)

  if (!editorEl) {
    console.warn('[Follow] Could not find Google editor container for type:', docType)
    return new MutationObserver(() => {})
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const observer = new MutationObserver((mutations) => {
    // Debounce rapid changes
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      let hasTextEdit = false
      let hasStructuralChange = false

      for (const mutation of mutations) {
        if (mutation.type === 'characterData') hasTextEdit = true
        else if (mutation.type === 'childList') hasStructuralChange = true
      }

      if (hasTextEdit) callback('text_edit')
      else if (hasStructuralChange) callback('structural_change')
    }, 100)
  })

  observer.observe(editorEl, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  return observer
}

/**
 * Monitor cursor position changes via the selectionchange event.
 * Approximates paragraph index from DOM position using Google Docs paragraph elements.
 * Debounced to avoid excessive DOM queries on every keystroke.
 */
export function observeCursorPosition(
  callback: (pos: GoogleDocState['cursorPosition']) => void
): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const handler = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      const selection = document.getSelection()
      if (!selection || selection.rangeCount === 0) return

      const range = selection.getRangeAt(0)

      // Walk up from the selection to find the containing paragraph
      // instead of iterating all paragraphs
      let node: Node | null = range.startContainer
      let paragraphEl: Element | null = null
      while (node) {
        if (node instanceof Element && node.classList?.contains('kix-paragraphrenderer')) {
          paragraphEl = node
          break
        }
        node = node.parentNode
      }

      if (paragraphEl) {
        // Only query siblings to find index, not the full document
        const paragraphs = document.querySelectorAll('.kix-paragraphrenderer')
        const paragraphIndex = Array.prototype.indexOf.call(paragraphs, paragraphEl)
        callback(paragraphIndex >= 0 ? { paragraphIndex, charOffset: range.startOffset } : null)
      } else {
        callback(null)
      }
    }, 200)
  }

  document.addEventListener('selectionchange', handler)
  return () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    document.removeEventListener('selectionchange', handler)
  }
}

/**
 * Check if the user is actively editing (focus is inside the editor).
 */
export function isUserEditing(): boolean {
  const active = document.activeElement
  if (!active) return false
  return !!(
    active.closest('.kix-appview-editor') ||
    active.closest('.waffle') ||
    active.closest('.punch-viewer-content') ||
    active.closest('[contenteditable="true"]')
  )
}

// ─── G3 Text Reading Functions ──────────────────────────────────────────────

/**
 * Get the text content of each paragraph in a Google Doc.
 * Google Docs renders paragraphs as .kix-paragraphrenderer elements.
 */
export function getParagraphTexts(): string[] {
  const paragraphs = document.querySelectorAll('.kix-paragraphrenderer')
  return Array.from(paragraphs).map((p) => (p.textContent || '').trim())
}

/**
 * Get the full document text.
 * Modern Google Docs uses canvas rendering, so DOM scraping no longer works.
 * Falls back to the Google Docs export endpoint (works because user is authenticated).
 */
export function getDocumentText(): string {
  // Try DOM-based approach first (legacy Google Docs)
  const domText = getParagraphTexts().join('\n\n')
  if (domText.trim()) return domText

  // For canvas-based Docs, return cached export text if available
  return _cachedDocumentText
}

let _cachedDocumentText = ''
let _lastFetchDocId = ''

/**
 * Detect Google Docs tab names from the document sidebar DOM.
 * Returns names like ["Henry", "Michelle", "Shrey"].
 */
export function getDocTabNames(): string[] {
  const treeItems = document.querySelectorAll('[role="treeitem"]')
  return Array.from(treeItems)
    .map((t) => (t.textContent || '').trim().replace(/\d+$/, ''))
    .filter((n) => n.length > 0)
}

/**
 * Get the active tab name (the one with aria-selected="true").
 */
export function getActiveTabName(): string {
  const active = document.querySelector('[role="treeitem"][aria-selected="true"]')
  return active ? (active.textContent || '').trim().replace(/\d+$/, '') : ''
}

/**
 * Fetch document text — uses cache if available, otherwise fetches fresh.
 * Fetches ALL tabs content (not just active tab) so the AI has full context.
 * Tries: DOM → export URL → background SW fetch → Docs API.
 */
export async function fetchDocumentText(googleDocId: string): Promise<string> {
  if (!googleDocId) {
    console.warn('[Follow] fetchDocumentText: no googleDocId')
    return ''
  }

  // Return cache if we already have text for this doc
  if (_cachedDocumentText && _lastFetchDocId === googleDocId) {
    console.log(`[Follow] fetchDocumentText: returning cached (${_cachedDocumentText.length} chars)`)
    return _cachedDocumentText
  }

  // Detect tabs and active tab for context
  const tabNames = getDocTabNames()
  const activeTabName = getActiveTabName()
  const hasMultipleTabs = tabNames.length > 1
  console.log(`[Follow] fetchDocumentText: fetching for ${googleDocId}, tabs=[${tabNames.join(', ')}], active=${activeTabName}`)

  // Try DOM-based approach first (instant, works in legacy mode)
  const domText = getParagraphTexts().join('\n\n')
  if (domText.trim().length > 20) {
    // DOM only returns active tab — label it if multi-tab doc
    const labeled = hasMultipleTabs
      ? `[Active Tab: ${activeTabName}]\n\n${domText}\n\n[Note: This document has ${tabNames.length} tabs: ${tabNames.join(', ')}. Only the active tab content is shown via DOM.]`
      : domText
    console.log(`[Follow] fetchDocumentText: DOM success (${labeled.length} chars)`)
    _cachedDocumentText = labeled
    _lastFetchDocId = googleDocId
    return labeled
  }
  console.log('[Follow] fetchDocumentText: DOM scraping returned empty (canvas mode)')

  // Fallback 1: fetch via MAIN world (canvas-annotate-init.ts listener has page cookies)
  try {
    const mainWorldText = await new Promise<string>((resolve, reject) => {
      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const handler = (e: MessageEvent) => {
        if (e.data?.type === 'follow-fetch-doc-text-result' && e.data.requestId === requestId) {
          window.removeEventListener('message', handler)
          if (e.data.text) resolve(e.data.text)
          else reject(new Error(e.data.error || 'Empty response'))
        }
      }
      window.addEventListener('message', handler)
      window.postMessage({ type: 'follow-fetch-doc-text', googleDocId, requestId }, '*')
      setTimeout(() => { window.removeEventListener('message', handler); reject(new Error('Timeout')) }, 10000)
    })
    if (mainWorldText.trim()) {
      const enriched = hasMultipleTabs
        ? `[Document tabs: ${tabNames.join(', ')} | Active tab: ${activeTabName}]\n\n${mainWorldText}`
        : mainWorldText
      console.log(`[Follow] fetchDocumentText: MAIN world fetch success (${enriched.length} chars, ${tabNames.length} tabs)`)
      _cachedDocumentText = enriched
      _lastFetchDocId = googleDocId
      return enriched
    }
    console.warn('[Follow] fetchDocumentText: MAIN world returned empty')
  } catch (err) {
    console.warn('[Follow] fetchDocumentText: MAIN world failed:', err)
  }

  // Fallback 2: export endpoint from content script directly
  try {
    const res = await fetch(
      `https://docs.google.com/document/d/${googleDocId}/export?format=txt`,
      { credentials: 'include' }
    )
    if (res.ok) {
      const text = await res.text()
      if (text.trim()) {
        // Add tab context header if this is a multi-tab document
        const enriched = hasMultipleTabs
          ? `[Document tabs: ${tabNames.join(', ')} | Active tab: ${activeTabName}]\n\n${text}`
          : text
        console.log(`[Follow] fetchDocumentText: export endpoint success (${enriched.length} chars, ${tabNames.length} tabs)`)
        _cachedDocumentText = enriched
        _lastFetchDocId = googleDocId
        return enriched
      }
      console.warn('[Follow] fetchDocumentText: export returned empty body')
    } else {
      console.warn(`[Follow] fetchDocumentText: export endpoint ${res.status} ${res.statusText}`)
    }
  } catch (err) {
    console.warn('[Follow] fetchDocumentText: export endpoint failed:', err)
  }

  // Fallback 2: delegate to background service worker (has host_permissions + cookies)
  try {
    const bgResult = await new Promise<string>((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'FETCH_DOC_TEXT', payload: { googleDocId } },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
          } else if (response?.text) {
            resolve(response.text)
          } else {
            reject(new Error(response?.error || 'No text returned'))
          }
        }
      )
    })
    if (bgResult.trim()) {
      console.log(`[Follow] fetchDocumentText: background SW success (${bgResult.length} chars)`)
      _cachedDocumentText = bgResult
      _lastFetchDocId = googleDocId
      return bgResult
    }
  } catch (err) {
    console.warn('[Follow] fetchDocumentText: background SW fallback failed:', err)
  }

  // Fallback 3: Docs API (requires OAuth, often unavailable in extension)
  try {
    const text = await fetchDocumentContentViaAPI(googleDocId)
    if (text.trim()) {
      console.log(`[Follow] fetchDocumentText: Docs API success (${text.length} chars)`)
      _cachedDocumentText = text
      _lastFetchDocId = googleDocId
      return text
    }
  } catch (err) {
    console.warn('[Follow] fetchDocumentText: Docs API failed:', err)
  }

  console.error('[Follow] fetchDocumentText: ALL methods failed, returning empty')
  return _cachedDocumentText
}

/**
 * Get the cached document text (sync), or empty string if not yet fetched.
 */
export function getCachedDocumentText(): string {
  return _cachedDocumentText
}

/**
 * Get paragraph texts for annotation text matching.
 * In DOM mode: reads from kix-paragraphrenderer elements.
 * In canvas mode: splits cached document text by newlines.
 */
export function getParagraphTextsForMatching(): string[] {
  // Try DOM-based approach first
  const domTexts = getParagraphTexts()
  if (domTexts.length > 0 && domTexts.some((t) => t.length > 0)) {
    return domTexts
  }

  // Canvas mode: split cached text by newlines
  if (_cachedDocumentText) {
    return _cachedDocumentText.split('\n').filter((line) => line.trim().length > 0)
  }

  return []
}

/**
 * Get the bounding rectangle of a specific paragraph by index.
 */
export function getParagraphBounds(index: number): DOMRect | null {
  const paragraphs = document.querySelectorAll('.kix-paragraphrenderer')
  const el = paragraphs[index]
  return el ? el.getBoundingClientRect() : null
}

/**
 * Get the total number of paragraphs in the document.
 */
export function getParagraphCount(): number {
  return document.querySelectorAll('.kix-paragraphrenderer').length
}

/**
 * Get the insertion point coordinates after a specific paragraph.
 * Used for positioning ghost draft overlays between paragraphs.
 */
export function getInsertionPointAfterParagraph(
  index: number
): { top: number; left: number; width: number } | null {
  const paragraphs = document.querySelectorAll('.kix-paragraphrenderer')
  const el = paragraphs[index]
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return { top: rect.bottom, left: rect.left, width: rect.width }
}

/**
 * Find the bounding rectangles for a text range within a specific paragraph.
 * Uses Google Docs word node spans (.kix-wordhtmlgenerator-word-node) to
 * map character offsets to screen positions.
 */
export function getTextRangeRects(
  startPara: number,
  startChar: number,
  endPara: number,
  endChar: number
): DOMRect[] {
  const paragraphs = document.querySelectorAll('.kix-paragraphrenderer')

  // Canvas mode fallback: use canvas position adapter for paragraph-level bounds
  if (paragraphs.length === 0 && isCanvasMode()) {
    const rects: DOMRect[] = []
    const canvasParas = refreshPositionCache()
    for (let pIdx = startPara; pIdx <= endPara && pIdx < canvasParas.length; pIdx++) {
      const para = canvasParas[pIdx]
      if (para) {
        // Use individual text run rects for finer granularity
        if (para.textRuns.length > 0) {
          for (const run of para.textRuns) {
            rects.push(run.bounds)
          }
        } else {
          rects.push(para.bounds)
        }
      }
    }
    return rects
  }

  // DOM mode: precise character-level rect matching
  const rects: DOMRect[] = []

  for (let pIdx = startPara; pIdx <= endPara && pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx]
    const wordNodes = para.querySelectorAll(
      '.kix-wordhtmlgenerator-word-node, [class*="wordhtmlgenerator"]'
    )

    let charOffset = 0
    const rangeStart = pIdx === startPara ? startChar : 0
    const rangeEnd = pIdx === endPara ? endChar : Infinity

    for (const node of wordNodes) {
      const text = node.textContent || ''
      const nodeStart = charOffset
      const nodeEnd = charOffset + text.length

      // Check if this node overlaps with our target range
      if (nodeEnd > rangeStart && nodeStart < rangeEnd) {
        rects.push(node.getBoundingClientRect())
      }

      charOffset = nodeEnd
      if (charOffset >= rangeEnd) break
    }
  }

  return rects
}
