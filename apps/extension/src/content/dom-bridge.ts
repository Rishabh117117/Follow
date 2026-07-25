/**
 * DOM Bridge — read-only DOM queries for Google Workspace pages.
 * Never modifies Google's DOM — all Follow UI renders inside shadow DOM.
 */

import type { GoogleDocType } from '@/lib/google-doc-utils'

// ─── Text Reading ─────────────────────────────────────────────────────────

export function getDocTitle(): string {
  const el = document.querySelector<HTMLElement>('.docs-title-input, [class*="title-input"]')
  if (el) {
    if (el instanceof HTMLInputElement) return el.value?.trim() || 'Untitled'
    return el.textContent?.trim() || 'Untitled'
  }
  return document.title.replace(/ - Google (Docs|Sheets|Slides)$/, '').trim() || 'Untitled'
}

export function getSelectedText(): string | null {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed) return null
  return selection.toString().trim() || null
}

export function getSelectionBounds(): DOMRect | null {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  return selection.getRangeAt(0).getBoundingClientRect()
}

export function getParagraphTexts(): string[] {
  const paragraphs = document.querySelectorAll('.kix-paragraphrenderer')
  return Array.from(paragraphs).map((p) => (p.textContent || '').trim())
}

export function getDocumentText(): string {
  const domText = getParagraphTexts().join('\n\n')
  if (domText.trim()) return domText
  return _cachedDocumentText
}

let _cachedDocumentText = ''
let _lastFetchDocId = ''

/** Detect tab names from the Google Docs sidebar */
function getDocTabNames(): string[] {
  const items = document.querySelectorAll('[role="treeitem"]')
  return Array.from(items).map((el) => (el.textContent || '').trim()).filter(Boolean)
}

/** Detect the active tab name */
function getActiveTabName(): string {
  return (document.querySelector('[role="treeitem"][aria-selected="true"]')?.textContent || '').trim()
}

/** Prepend tab metadata to document text if multi-tab doc */
function enrichWithTabMetadata(text: string, tabNames: string[], activeTab: string): string {
  if (tabNames.length <= 1) return text
  return `[Document has ${tabNames.length} tabs: ${tabNames.join(', ')} | Active tab: ${activeTab}]\n\n${text}`
}

export async function fetchDocumentText(googleDocId: string): Promise<string> {
  console.log('[Follow] fetchDocumentText called for:', googleDocId)
  if (!googleDocId) return ''

  // Return cache if available
  if (_cachedDocumentText && _lastFetchDocId === googleDocId) {
    console.log('[Follow] fetchDocumentText: returning cache (' + _cachedDocumentText.length + ' chars)')
    return _cachedDocumentText
  }

  const tabNames = getDocTabNames()
  const activeTab = getActiveTabName()
  console.log('[Follow] fetchDocumentText: tabs=' + JSON.stringify(tabNames) + ', active=' + activeTab)

  // Tier 1: DOM scraping (instant, works in legacy/non-canvas mode)
  const domText = getParagraphTexts().join('\n\n')
  if (domText.trim().length > 20) {
    const result = enrichWithTabMetadata(domText, tabNames, activeTab)
    console.log('[Follow] fetchDocumentText: Tier 1 DOM success (' + result.length + ' chars)')
    _cachedDocumentText = result
    _lastFetchDocId = googleDocId
    return result
  }
  console.log('[Follow] fetchDocumentText: Tier 1 DOM empty, trying MAIN world...')

  // Tier 2: MAIN world fetch via postMessage (gets ALL tabs with page cookies)
  try {
    const mainWorldText = await new Promise<string>((resolve, reject) => {
      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const handler = (e: MessageEvent) => {
        if (e.data?.type === 'follow-fetch-doc-text-result' && e.data.requestId === requestId) {
          window.removeEventListener('message', handler)
          if (e.data.text) resolve(e.data.text)
          else reject(new Error(e.data.error || 'Empty'))
        }
      }
      window.addEventListener('message', handler)
      window.postMessage({ type: 'follow-fetch-doc-text', googleDocId, requestId }, '*')
      setTimeout(() => { window.removeEventListener('message', handler); reject(new Error('Timeout')) }, 8000)
    })
    if (mainWorldText.trim()) {
      const result = enrichWithTabMetadata(mainWorldText, tabNames, activeTab)
      console.log('[Follow] fetchDocumentText: Tier 2 MAIN world SUCCESS (' + result.length + ' chars, hasMichelle=' + result.includes('Michelle') + ')')
      _cachedDocumentText = result
      _lastFetchDocId = googleDocId
      return result
    }
  } catch (err) {
    console.warn('[Follow] fetchDocumentText: Tier 2 MAIN world FAILED:', err)
  }

  // Tier 3: Google Docs API via OAuth token
  try {
    const result = await chrome.runtime.sendMessage({ type: 'GET_GOOGLE_AUTH_TOKEN_SILENT' })
    if (result?.success && result.data?.token) {
      const res = await fetch(
        `https://docs.googleapis.com/v1/documents/${googleDocId}`,
        { headers: { Authorization: `Bearer ${result.data.token}` } }
      )
      if (res.ok) {
        const doc = await res.json()
        const text = extractTextFromDocsAPI(doc)
        if (text.trim()) {
          const enriched = enrichWithTabMetadata(text, tabNames, activeTab)
          _cachedDocumentText = enriched
          _lastFetchDocId = googleDocId
          return enriched
        }
      }
    }
  } catch (err) {
    console.warn('[Follow] fetchDocumentText: Tier 3 OAuth FAILED:', err)
  }

  console.log('[Follow] fetchDocumentText: Trying Tier 4 export endpoint...')
  // Tier 4: Export endpoint from content script (may only get first tab)
  try {
    const res = await fetch(
      `https://docs.google.com/document/d/${googleDocId}/export?format=txt`,
      { credentials: 'include' }
    )
    if (res.ok) {
      const text = await res.text()
      if (text.trim()) {
        const enriched = enrichWithTabMetadata(text, tabNames, activeTab)
        _cachedDocumentText = enriched
        _lastFetchDocId = googleDocId
        return enriched
      }
    }
  } catch {
    // Use cached
  }

  return _cachedDocumentText
}

function extractTextFromDocsAPI(doc: { body?: { content?: Array<{ paragraph?: { elements?: Array<{ textRun?: { content?: string } }> } }> } }): string {
  if (!doc.body?.content) return ''
  return doc.body.content
    .filter((block) => block.paragraph)
    .map((block) =>
      (block.paragraph!.elements || [])
        .map((el) => el.textRun?.content || '')
        .join('')
    )
    .join('')
}

export function getCachedDocumentText(): string {
  return _cachedDocumentText
}

export function getParagraphTextsForMatching(): string[] {
  const domTexts = getParagraphTexts()
  if (domTexts.length > 0 && domTexts.some((t) => t.length > 0)) return domTexts
  if (_cachedDocumentText) return _cachedDocumentText.split('\n').filter((l) => l.trim().length > 0)
  return []
}

// ─── Editor Containers ────────────────────────────────────────────────────

export function getEditorContainer(docType: GoogleDocType): Element | null {
  switch (docType) {
    case 'docs': return document.querySelector('.kix-appview-editor')
    case 'sheets': return document.querySelector('.waffle, [class*="waffle"]')
    case 'slides': return document.querySelector('.punch-viewer-content, [class*="punch-viewer"]')
    default: return null
  }
}

// ─── Collaborators ────────────────────────────────────────────────────────

export function getCollaboratorNames(): Set<string> {
  const els = document.querySelectorAll('.kix-cursor-name, .waffle-cursor-name, [class*="cursor-name"], [class*="collaborator-name"]')
  return new Set(Array.from(els).map((el) => el.textContent?.trim() || '').filter(Boolean))
}

// ─── Paragraph Bounds ─────────────────────────────────────────────────────

export function getParagraphBounds(index: number): DOMRect | null {
  const paragraphs = document.querySelectorAll('.kix-paragraphrenderer')
  return paragraphs[index]?.getBoundingClientRect() || null
}

export function getInsertionPointAfterParagraph(index: number): { top: number; left: number; width: number } | null {
  const paragraphs = document.querySelectorAll('.kix-paragraphrenderer')
  const el = paragraphs[index]
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return { top: rect.bottom, left: rect.left, width: rect.width }
}

// ─── Canvas Mode Detection ────────────────────────────────────────────────

export function isCanvasMode(): boolean {
  const paragraphs = document.querySelectorAll('.kix-paragraphrenderer')
  if (paragraphs.length > 0) return false
  const canvases = document.querySelectorAll('.kix-canvas-tile-content canvas')
  return canvases.length > 0
}

// ─── Sheets Helpers ───────────────────────────────────────────────────────

export function getActiveCellRef(): string | null {
  const nameBox = document.querySelector('.waffle-name-box input, [class*="name-box"] input') as HTMLInputElement | null
  return nameBox?.value || null
}

// ─── Slides Helpers ───────────────────────────────────────────────────────

export function getActiveSlideIndex(): number {
  const active = document.querySelector('.punch-filmstrip-thumbnail[aria-selected="true"], [class*="filmstrip"] [aria-selected="true"]')
  if (!active) return -1
  const all = document.querySelectorAll('.punch-filmstrip-thumbnail, [class*="filmstrip-thumbnail"]')
  return Array.from(all).indexOf(active)
}

// ─── User Editing State ───────────────────────────────────────────────────

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
