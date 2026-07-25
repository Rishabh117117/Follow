/**
 * Google Docs API integration for Doc Intelligence highlights.
 *
 * Uses chrome.identity OAuth2 via the service worker to apply
 * background-color highlights to text ranges in Google Docs.
 * Adapted from apps/gws-extension/src/lib/google-docs-api.ts
 * with color mappings for doc-intel suggestion types and finding severities.
 */

import { sendToBackground } from '@/core/message-bus'

interface DocElement {
  paragraph?: {
    elements: Array<{
      startIndex?: number
      endIndex?: number
      textRun?: { content: string }
    }>
  }
  table?: {
    tableRows: Array<{
      tableCells: Array<{
        content: DocElement[]
      }>
    }>
  }
  sectionBreak?: Record<string, unknown>
  startIndex?: number
  endIndex?: number
}

interface DocsApiResponse {
  title: string
  body?: {
    content: DocElement[]
  }
}

// ─── Color Mappings ─────────────────────────────────────────────────────

/** Suggestion type → highlight color (Google Docs API RGB format, 0-1 range) */
const SUGGESTION_COLORS: Record<string, { red: number; green: number; blue: number }> = {
  clarity:      { red: 1.0,  green: 0.93, blue: 0.73 }, // amber  #FEF3C7 approx
  conciseness:  { red: 0.86, green: 0.92, blue: 0.98 }, // blue   #DBEAFE
  tone:         { red: 0.93, green: 0.91, blue: 0.99 }, // violet #EDE9FE
  grammar:      { red: 0.82, green: 0.98, blue: 0.90 }, // green  #D1FAE5
  structure:    { red: 1.0,  green: 0.89, blue: 0.90 }, // rose   #FFE4E6
  custom:       { red: 0.93, green: 0.9,  blue: 1.0  }, // lavender
}

/** Finding severity → highlight color */
const FINDING_COLORS: Record<string, { red: number; green: number; blue: number }> = {
  critical: { red: 1.0,  green: 0.89, blue: 0.89 }, // red    #FEE2E2
  warning:  { red: 1.0,  green: 0.93, blue: 0.73 }, // amber  #FEF3C7
  info:     { red: 0.86, green: 0.92, blue: 0.98 }, // blue   #DBEAFE
}

/** GWS annotation categories → highlight colors (used by chat annotate_google_doc tool) */
const ANNOTATION_COLORS: Record<string, { red: number; green: number; blue: number }> = {
  'key-concept':  { red: 1.0,  green: 0.95, blue: 0.6  }, // yellow
  insight:        { red: 0.93, green: 0.9,  blue: 1.0  }, // lavender
  strength:       { red: 0.85, green: 1.0,  blue: 0.85 }, // light green
  weakness:       { red: 1.0,  green: 0.85, blue: 0.85 }, // light red
  comparison:     { red: 0.85, green: 0.95, blue: 1.0  }, // light blue
  evidence:       { red: 0.9,  green: 1.0,  blue: 0.9  }, // light green
  risk:           { red: 1.0,  green: 0.85, blue: 0.85 }, // light red
  opportunity:    { red: 1.0,  green: 0.93, blue: 0.85 }, // light orange
  definition:     { red: 0.85, green: 0.95, blue: 1.0  }, // light blue
  'action-item':  { red: 1.0,  green: 0.9,  blue: 0.85 }, // light orange
  question:       { red: 0.95, green: 0.95, blue: 0.95 }, // light gray
  important:      { red: 1.0,  green: 0.95, blue: 0.6  }, // yellow
  conclusion:     { red: 0.93, green: 0.9,  blue: 1.0  }, // lavender
  argument:       { red: 0.85, green: 0.95, blue: 1.0  }, // light blue
}

const DEFAULT_COLOR = { red: 1.0, green: 0.95, blue: 0.6 } // yellow fallback

// ─── Auth ───────────────────────────────────────────────────────────────

async function getAuthToken(): Promise<string> {
  const result = await sendToBackground<{ token: string }>({ type: 'GET_GOOGLE_AUTH_TOKEN' })
  if (!result.success || !result.data?.token) {
    throw new Error(result.error || 'No Google auth token returned')
  }
  return result.data.token
}

// ─── Document Parsing ───────────────────────────────────────────────────

function extractTextFromDoc(doc: DocsApiResponse): string {
  if (!doc.body?.content) return ''
  const parts: string[] = []
  for (const element of doc.body.content) {
    if (element.paragraph) {
      const paraText = element.paragraph.elements
        .map((e) => e.textRun?.content || '')
        .join('')
      parts.push(paraText)
    } else if (element.table) {
      for (const row of element.table.tableRows) {
        const cells = row.tableCells.map((cell) =>
          cell.content
            .map((el) =>
              el.paragraph
                ? el.paragraph.elements.map((e) => e.textRun?.content || '').join('')
                : ''
            )
            .join('')
            .trim()
        )
        parts.push(cells.join('\t'))
      }
      parts.push('')
    }
  }
  return parts.join('').trim()
}

async function fetchDocumentRaw(googleDocId: string): Promise<DocsApiResponse> {
  const token = await getAuthToken()
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${googleDocId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Docs API error ${res.status}: ${err}`)
  }
  return res.json() as Promise<DocsApiResponse>
}

export async function fetchDocumentContentViaAPI(googleDocId: string): Promise<string> {
  if (!googleDocId) return ''
  const doc = await fetchDocumentRaw(googleDocId)
  return extractTextFromDoc(doc)
}

// ─── Index Mapping ──────────────────────────────────────────────────────

function buildIndexMap(doc: DocsApiResponse): { text: string; indexMap: number[] } {
  const text: string[] = []
  const indexMap: number[] = []
  if (!doc.body?.content) return { text: '', indexMap: [] }

  for (const element of doc.body.content) {
    if (element.paragraph) {
      for (const el of element.paragraph.elements) {
        const content = el.textRun?.content || ''
        const startIdx = el.startIndex ?? 0
        for (let i = 0; i < content.length; i++) {
          text.push(content[i]!)
          indexMap.push(startIdx + i)
        }
      }
    }
  }
  return { text: text.join(''), indexMap }
}

function findTextInDoc(
  spanText: string,
  docText: string,
  indexMap: number[]
): { startIndex: number; endIndex: number } | null {
  if (!spanText || !docText) return null
  const normalized = spanText.replace(/\s+/g, ' ').trim()

  let pos = docText.indexOf(normalized)
  if (pos === -1) pos = docText.toLowerCase().indexOf(normalized.toLowerCase())
  if (pos === -1) {
    const normDoc = docText.replace(/\s+/g, ' ')
    const idx = normDoc.indexOf(normalized)
    if (idx !== -1) pos = idx
  }

  if (pos === -1 || pos + normalized.length > indexMap.length) return null
  return {
    startIndex: indexMap[pos]!,
    endIndex: indexMap[pos + normalized.length - 1]! + 1,
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Extract the Google Doc ID from the current page URL.
 */
export function extractGoogleDocId(): string | null {
  const match = window.location.href.match(/\/document\/d\/([a-zA-Z0-9_-]+)/)
  return match?.[1] ?? null
}

/**
 * Highlight suggestion text ranges in a Google Doc via the Docs API.
 */
export async function highlightSuggestionsInGoogleDoc(
  googleDocId: string,
  suggestions: Array<{ spanText: string; suggestionType: string }>
): Promise<number> {
  if (!googleDocId || suggestions.length === 0) return 0

  const doc = await fetchDocumentRaw(googleDocId)
  const { text, indexMap } = buildIndexMap(doc)
  if (!text || indexMap.length === 0) return 0

  const requests: Array<Record<string, unknown>> = []

  for (const sug of suggestions) {
    const range = findTextInDoc(sug.spanText, text, indexMap)
    if (!range) continue

    const color = SUGGESTION_COLORS[sug.suggestionType] || ANNOTATION_COLORS[sug.suggestionType] || DEFAULT_COLOR
    requests.push({
      updateTextStyle: {
        range: { startIndex: range.startIndex, endIndex: range.endIndex },
        textStyle: { backgroundColor: { color: { rgbColor: color } } },
        fields: 'backgroundColor',
      },
    })
  }

  if (requests.length === 0) return 0
  return await sendBatchUpdate(googleDocId, requests)
}

/**
 * Highlight finding text ranges in a Google Doc via the Docs API.
 */
export async function highlightFindingsInGoogleDoc(
  googleDocId: string,
  findings: Array<{ spanText: string; severity: string }>
): Promise<number> {
  if (!googleDocId || findings.length === 0) return 0

  const doc = await fetchDocumentRaw(googleDocId)
  const { text, indexMap } = buildIndexMap(doc)
  if (!text || indexMap.length === 0) return 0

  const requests: Array<Record<string, unknown>> = []

  for (const f of findings) {
    const range = findTextInDoc(f.spanText, text, indexMap)
    if (!range) continue

    const color = FINDING_COLORS[f.severity] || FINDING_COLORS['info']!
    requests.push({
      updateTextStyle: {
        range: { startIndex: range.startIndex, endIndex: range.endIndex },
        textStyle: { backgroundColor: { color: { rgbColor: color } } },
        fields: 'backgroundColor',
      },
    })
  }

  if (requests.length === 0) return 0
  return await sendBatchUpdate(googleDocId, requests)
}

/**
 * Clear highlights from specific text spans in a Google Doc.
 */
export async function clearHighlightsFromGoogleDoc(
  googleDocId: string,
  spans: string[]
): Promise<number> {
  if (!googleDocId || spans.length === 0) return 0

  const doc = await fetchDocumentRaw(googleDocId)
  const { text, indexMap } = buildIndexMap(doc)
  if (!text || indexMap.length === 0) return 0

  const requests: Array<Record<string, unknown>> = []

  for (const spanText of spans) {
    const range = findTextInDoc(spanText, text, indexMap)
    if (!range) continue

    requests.push({
      updateTextStyle: {
        range: { startIndex: range.startIndex, endIndex: range.endIndex },
        textStyle: { backgroundColor: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } } },
        fields: 'backgroundColor',
      },
    })
  }

  if (requests.length === 0) return 0
  return await sendBatchUpdate(googleDocId, requests)
}

/**
 * Replace a text range in a Google Doc via the Docs API.
 */
export async function replaceTextInGoogleDoc(
  googleDocId: string,
  originalText: string,
  newText: string
): Promise<boolean> {
  if (!googleDocId || !originalText) return false

  const doc = await fetchDocumentRaw(googleDocId)
  const { text, indexMap } = buildIndexMap(doc)
  if (!text || indexMap.length === 0) return false

  const range = findTextInDoc(originalText, text, indexMap)
  if (!range) return false

  const requests = [
    { deleteContentRange: { range: { startIndex: range.startIndex, endIndex: range.endIndex } } },
    { insertText: { location: { index: range.startIndex }, text: newText } },
  ]

  const count = await sendBatchUpdate(googleDocId, requests)
  return count > 0
}

/**
 * Scroll to a text span in the Google Docs editor DOM.
 */
export function scrollToTextInGoogleDoc(spanText: string): boolean {
  if (!spanText) return false

  const searchStr = spanText.slice(0, 60).trim()

  // Try .kix-lineview first
  for (const line of document.querySelectorAll('.kix-lineview')) {
    const text = line.textContent || ''
    if (text.includes(searchStr) || text.toLowerCase().includes(searchStr.toLowerCase())) {
      line.scrollIntoView({ behavior: 'smooth', block: 'center' })
      flashOutline(line as HTMLElement)
      return true
    }
  }

  // Fallback: .kix-paragraphrenderer
  for (const para of document.querySelectorAll('.kix-paragraphrenderer')) {
    const text = para.textContent || ''
    if (text.includes(searchStr) || text.toLowerCase().includes(searchStr.toLowerCase())) {
      para.scrollIntoView({ behavior: 'smooth', block: 'center' })
      flashOutline(para as HTMLElement)
      return true
    }
  }

  return false
}

// ─── Helpers ────────────────────────────────────────────────────────────

async function sendBatchUpdate(
  googleDocId: string,
  requests: Array<Record<string, unknown>>
): Promise<number> {
  const token = await getAuthToken()
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${googleDocId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    console.error(`[Follow] Docs API batchUpdate error ${res.status}:`, err)
    return 0
  }

  return requests.length
}

function flashOutline(el: HTMLElement): void {
  const prev = el.style.outline
  el.style.outline = '2px solid #6366F1'
  el.style.outlineOffset = '2px'
  el.style.borderRadius = '4px'
  setTimeout(() => {
    el.style.outline = prev
    el.style.outlineOffset = ''
    el.style.borderRadius = ''
  }, 2000)
}
