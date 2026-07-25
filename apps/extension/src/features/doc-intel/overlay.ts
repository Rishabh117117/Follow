/**
 * Doc Intel Overlay — mark application, text replacement, mark removal defense.
 *
 * Strategies:
 * - Google Docs: API-based highlighting via Google Docs batchUpdate (persists across re-renders)
 * - Other contentEditable: DOM span injection
 * - Textarea: mirror overlay
 */

import { state, normalizeChars, safeSetInnerHTML, type Suggestion, type Finding } from './detector'
import {
  extractGoogleDocId,
  highlightSuggestionsInGoogleDoc,
  highlightFindingsInGoogleDoc,
  clearHighlightsFromGoogleDoc,
  replaceTextInGoogleDoc,
  scrollToTextInGoogleDoc,
} from '@/lib/google-docs-api'

// Track which spans we've highlighted in Google Docs (for clearing)
let highlightedSpans: string[] = []

// ─── Page Styles ──────────────────────────────────────────────────────────

function injectPageStyles(): void {
  if (document.getElementById('wa-doc-intel-styles')) return
  const style = document.createElement('style')
  style.id = 'wa-doc-intel-styles'
  style.textContent = `
    .wa-doc-suggestion { text-decoration: underline !important; text-decoration-thickness: 2px !important; text-underline-offset: 2px !important; cursor: pointer !important; text-decoration-skip-ink: none !important; }
    .wa-doc-suggestion-clarity { text-decoration-color: #f59e0b !important; }
    .wa-doc-suggestion-conciseness { text-decoration-color: #3b82f6 !important; }
    .wa-doc-suggestion-tone { text-decoration-color: #8b5cf6 !important; }
    .wa-doc-suggestion-grammar { text-decoration-color: #10b981 !important; }
    .wa-doc-suggestion-structure { text-decoration-color: #f43f5e !important; }
    .wa-doc-suggestion-custom { text-decoration-color: #a855f7 !important; }
    .wa-doc-suggestion-dimmed { opacity: 0.3 !important; }
    .wa-doc-finding { text-decoration: wavy underline !important; text-decoration-thickness: 1.5px !important; text-underline-offset: 2px !important; cursor: pointer !important; }
    .wa-doc-finding-critical { text-decoration-color: #f43f5e !important; }
    .wa-doc-finding-warning { text-decoration-color: #f59e0b !important; }
    .wa-doc-finding-info { text-decoration-color: #3b82f6 !important; }
  `
  document.head.appendChild(style)
}

// ─── TreeWalker Text Finding ──────────────────────────────────────────────

function findTextInElement(element: HTMLElement, searchText: string): { range: Range } | null {
  if (!searchText || !element) return null
  const normalized = normalizeChars(searchText)

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let fullText = ''
  const textNodes: { node: Text; offset: number }[] = []

  let currentNode: Text | null
  while ((currentNode = walker.nextNode() as Text | null)) {
    textNodes.push({ node: currentNode, offset: fullText.length })
    fullText += currentNode.textContent
  }

  const normalizedFull = normalizeChars(fullText)
  const idx = normalizedFull.indexOf(normalized)
  if (idx === -1) return null

  let startNode: Text | null = null, startOffset = 0
  let endNode: Text | null = null, endOffset = 0

  for (const tn of textNodes) {
    const nodeEnd = tn.offset + (tn.node.textContent?.length || 0)
    if (!startNode && idx < nodeEnd) {
      startNode = tn.node
      startOffset = idx - tn.offset
    }
    const endIdx = idx + normalized.length
    if (!endNode && endIdx <= nodeEnd) {
      endNode = tn.node
      endOffset = endIdx - tn.offset
    }
    if (startNode && endNode) break
  }

  if (!startNode || !endNode) return null

  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return { range }
}

// ─── ContentEditable Marks ────────────────────────────────────────────────

export function applyContentEditableMarks(element: HTMLElement, suggestions: Suggestion[]): { applied: number; skipped: number } {
  if (!element || !suggestions.length) {
    return { applied: 0, skipped: suggestions.length }
  }

  // Google Docs: use API-based highlighting (DOM injection gets stripped by Kix editor)
  if (state.complexEditor === 'google-docs') {
    return applyGoogleDocsHighlights(suggestions)
  }

  injectPageStyles()
  let applied = 0, skipped = 0

  for (const sug of [...suggestions].reverse()) {
    const matched = findTextInElement(element, sug.spanText)
    if (!matched) { skipped++; continue }

    try {
      const span = document.createElement('span')
      span.className = `wa-doc-suggestion wa-doc-suggestion-${sug.suggestionType}`
      span.dataset.suggestionId = sug.id
      matched.range.surroundContents(span)
      applied++
    } catch {
      try {
        const span = document.createElement('span')
        span.className = `wa-doc-suggestion wa-doc-suggestion-${sug.suggestionType}`
        span.dataset.suggestionId = sug.id
        const contents = matched.range.extractContents()
        span.appendChild(contents)
        matched.range.insertNode(span)
        applied++
      } catch { skipped++ }
    }
  }

  watchForMarkRemoval(element)
  return { applied, skipped }
}

export function applyFindingMarks(element: HTMLElement, findings: Finding[]): { applied: number; skipped: number } {
  if (!element || !findings.length) {
    return { applied: 0, skipped: findings.length }
  }

  // Google Docs: use API-based highlighting
  if (state.complexEditor === 'google-docs') {
    return applyGoogleDocsFindingHighlights(findings)
  }

  injectPageStyles()
  let applied = 0, skipped = 0

  for (const finding of [...findings].reverse()) {
    const matched = findTextInElement(element, finding.spanText)
    if (!matched) { skipped++; continue }

    try {
      const span = document.createElement('span')
      span.className = `wa-doc-finding wa-doc-finding-${finding.severity}`
      span.dataset.suggestionId = finding.id
      matched.range.surroundContents(span)
      applied++
    } catch { skipped++ }
  }

  return { applied, skipped }
}

// ─── Google Docs API Highlighting ─────────────────────────────────────────

function applyGoogleDocsHighlights(suggestions: Suggestion[]): { applied: number; skipped: number } {
  const docId = extractGoogleDocId()
  if (!docId) {
    console.warn('[DocIntel] Could not extract Google Doc ID from URL')
    return { applied: 0, skipped: suggestions.length }
  }

  // Track spans for later clearing
  highlightedSpans = suggestions.map(s => s.spanText)

  // Fire-and-forget — the API call is async but we return immediately
  // with optimistic counts. The toolbar status will show the result.
  highlightSuggestionsInGoogleDoc(
    docId,
    suggestions.map(s => ({ spanText: s.spanText, suggestionType: s.suggestionType }))
  ).then(count => {
    console.log(`[DocIntel] Google Docs API: ${count} suggestion highlights applied`)
  }).catch(err => {
    console.error('[DocIntel] Google Docs API highlight failed:', err)
  })

  return { applied: suggestions.length, skipped: 0 }
}

function applyGoogleDocsFindingHighlights(findings: Finding[]): { applied: number; skipped: number } {
  const docId = extractGoogleDocId()
  if (!docId) {
    return { applied: 0, skipped: findings.length }
  }

  highlightedSpans = [...highlightedSpans, ...findings.map(f => f.spanText)]

  highlightFindingsInGoogleDoc(
    docId,
    findings.map(f => ({ spanText: f.spanText, severity: f.severity }))
  ).then(count => {
    console.log(`[DocIntel] Google Docs API: ${count} finding highlights applied`)
  }).catch(err => {
    console.error('[DocIntel] Google Docs API finding highlight failed:', err)
  })

  return { applied: findings.length, skipped: 0 }
}

// ─── Textarea Mirror Overlay ──────────────────────────────────────────────

const COLOR_MAP: Record<string, string> = {
  clarity: '#f59e0b', conciseness: '#3b82f6', tone: '#8b5cf6',
  grammar: '#10b981', structure: '#f43f5e', custom: '#a855f7',
}

export function applyTextareaMarks(textarea: HTMLTextAreaElement, suggestions: Suggestion[]): { applied: number; skipped: number } {
  if (!textarea || !suggestions.length) return { applied: 0, skipped: 0 }

  let applied = 0, skipped = 0
  const text = textarea.value

  // Create mirror overlay
  const mirror = document.createElement('div')
  mirror.className = 'wa-textarea-mirror'
  const styles = window.getComputedStyle(textarea)
  mirror.style.cssText = `
    position: absolute; pointer-events: none; overflow: hidden; white-space: pre-wrap; word-wrap: break-word;
    font: ${styles.font}; padding: ${styles.padding}; border: ${styles.border};
    width: ${textarea.offsetWidth}px; height: ${textarea.offsetHeight}px;
    color: transparent; background: transparent;
  `

  let html = ''
  let lastIdx = 0

  // Sort suggestions by position in text
  const sorted = suggestions
    .map(s => ({ ...s, idx: text.indexOf(normalizeChars(s.spanText)) }))
    .filter(s => s.idx >= 0)
    .sort((a, b) => a.idx - b.idx)

  for (const sug of sorted) {
    html += escapeHTML(text.slice(lastIdx, sug.idx))
    html += `<mark style="background:transparent;border-bottom:2px solid ${COLOR_MAP[sug.suggestionType] || '#a855f7'};color:transparent;" data-suggestion-id="${sug.id}">${escapeHTML(sug.spanText)}</mark>`
    lastIdx = sug.idx + sug.spanText.length
    applied++
  }
  skipped = suggestions.length - applied
  html += escapeHTML(text.slice(lastIdx))

  safeSetInnerHTML(mirror, html)

  const rect = textarea.getBoundingClientRect()
  mirror.style.top = rect.top + 'px'
  mirror.style.left = rect.left + 'px'
  textarea.parentElement?.style.setProperty('position', 'relative')
  textarea.after(mirror)
  state.mirrorOverlay = mirror as unknown as HTMLElement

  return { applied, skipped }
}

function escapeHTML(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ─── Accept / Dismiss ─────────────────────────────────────────────────────

export function acceptSuggestion(id: string, newText: string): void {
  const sug = state.suggestions.find(s => s.id === id)

  // Google Docs: use API to replace text
  if (state.complexEditor === 'google-docs' && sug) {
    const docId = extractGoogleDocId()
    if (docId) {
      replaceTextInGoogleDoc(docId, sug.spanText, newText).catch(err => {
        console.error('[DocIntel] Google Docs replace failed:', err)
      })
    }
  } else {
    // ContentEditable: replace span content
    const span = document.querySelector(`[data-suggestion-id="${id}"]`)
    if (span) {
      const textNode = document.createTextNode(newText)
      span.replaceWith(textNode)
    }

    // Textarea: string replacement
    const textarea = state.activeField as HTMLTextAreaElement | null
    if (textarea?.tagName === 'TEXTAREA' && sug) {
      textarea.value = textarea.value.replace(sug.spanText, newText)
    }
  }

  state.suggestions = state.suggestions.filter(s => s.id !== id)
}

export function dismissSuggestion(id: string): void {
  // Google Docs: clear the highlight for this span
  if (state.complexEditor === 'google-docs') {
    const sug = state.suggestions.find(s => s.id === id)
    const finding = state.findings.find(f => f.id === id)
    const spanText = sug?.spanText || finding?.spanText
    if (spanText) {
      const docId = extractGoogleDocId()
      if (docId) {
        clearHighlightsFromGoogleDoc(docId, [spanText]).catch(() => {})
      }
      highlightedSpans = highlightedSpans.filter(s => s !== spanText)
    }
  } else {
    const span = document.querySelector(`[data-suggestion-id="${id}"]`)
    if (span) {
      const parent = span.parentNode
      while (span.firstChild) parent?.insertBefore(span.firstChild, span)
      span.remove()
    }
  }

  state.suggestions = state.suggestions.filter(s => s.id !== id)
  state.findings = state.findings.filter(f => f.id !== id)
}

export function clearAllMarks(): void {
  // Google Docs: clear API highlights
  if (state.complexEditor === 'google-docs' && highlightedSpans.length > 0) {
    const docId = extractGoogleDocId()
    if (docId) {
      clearHighlightsFromGoogleDoc(docId, highlightedSpans).catch(() => {})
    }
    highlightedSpans = []
  }

  // DOM marks
  document.querySelectorAll('.wa-doc-suggestion, .wa-doc-finding').forEach(span => {
    const parent = span.parentNode
    while (span.firstChild) parent?.insertBefore(span.firstChild, span)
    span.remove()
  })

  // Remove mirror overlays
  document.querySelectorAll('.wa-textarea-mirror').forEach(m => m.remove())
  if (state.mirrorOverlay) { (state.mirrorOverlay as HTMLElement).remove(); state.mirrorOverlay = null as unknown as HTMLElement }

  // Remove page styles
  document.getElementById('wa-doc-intel-styles')?.remove()
}

// ─── Scroll helper (re-export for toolbar) ──────────────────────────────

export { scrollToTextInGoogleDoc }

// ─── MutationObserver Defense ─────────────────────────────────────────────

let domObserver: MutationObserver | null = null

function watchForMarkRemoval(element: HTMLElement): void {
  domObserver?.disconnect()
  domObserver = new MutationObserver(() => {
    const remaining = element.querySelectorAll('.wa-doc-suggestion').length
    if (remaining === 0 && state.suggestions.length > 0) {
      domObserver?.disconnect()
      domObserver = null
    }
  })
  domObserver.observe(element, { childList: true, subtree: true })
}

export function destroyObserver(): void {
  domObserver?.disconnect()
  domObserver = null
}
