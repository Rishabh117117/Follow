/**
 * Google Docs API integration via chrome.identity OAuth2.
 * Content scripts can't call chrome.identity directly,
 * so we message the service worker to get the token.
 */

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

/** Category → highlight color mapping (Google Docs API RGB format, 0-1 range) */
const HIGHLIGHT_COLORS: Record<string, { red: number; green: number; blue: number }> = {
  'key-concept': { red: 1.0, green: 0.95, blue: 0.6 },      // yellow
  insight: { red: 0.93, green: 0.9, blue: 1.0 },             // lavender
  strength: { red: 0.85, green: 1.0, blue: 0.85 },           // light green
  weakness: { red: 1.0, green: 0.85, blue: 0.85 },           // light red
  comparison: { red: 0.85, green: 0.95, blue: 1.0 },         // light blue
  evidence: { red: 0.9, green: 1.0, blue: 0.9 },             // light green
  risk: { red: 1.0, green: 0.85, blue: 0.85 },               // light red
  opportunity: { red: 1.0, green: 0.93, blue: 0.85 },        // light orange
  definition: { red: 0.85, green: 0.95, blue: 1.0 },         // light blue
  'action-item': { red: 1.0, green: 0.9, blue: 0.85 },       // light orange
  question: { red: 0.95, green: 0.95, blue: 0.95 },          // light gray
  important: { red: 1.0, green: 0.95, blue: 0.6 },           // yellow
  conclusion: { red: 0.93, green: 0.9, blue: 1.0 },          // lavender
  argument: { red: 0.85, green: 0.95, blue: 1.0 },           // light blue
  highlight: { red: 1.0, green: 0.95, blue: 0.6 },           // yellow (default fallback)
}

/**
 * Get an OAuth2 token via the service worker (content scripts can't use chrome.identity directly).
 */
async function getAuthToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_GOOGLE_AUTH_TOKEN' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
      } else if (response?.error) {
        reject(new Error(response.error))
      } else if (response?.token) {
        resolve(response.token)
      } else {
        reject(new Error('No token returned'))
      }
    })
  })
}

/**
 * Extract plain text from a Google Docs API structured response.
 */
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
        const cells = row.tableCells.map((cell) => {
          return cell.content
            .map((el) =>
              el.paragraph
                ? el.paragraph.elements.map((e) => e.textRun?.content || '').join('')
                : ''
            )
            .join('')
            .trim()
        })
        parts.push(cells.join('\t'))
      }
      parts.push('')
    }
  }

  return parts.join('').trim()
}

/**
 * Fetch the raw Google Docs API response (includes startIndex/endIndex on elements).
 */
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

/**
 * Fetch document content via the Google Docs API.
 * Returns the plain text content of the document.
 */
export async function fetchDocumentContentViaAPI(
  googleDocId: string
): Promise<string> {
  if (!googleDocId) return ''
  const doc = await fetchDocumentRaw(googleDocId)
  return extractTextFromDoc(doc)
}

/**
 * Build a flat text string with index mapping from the Docs API response.
 * Returns { text, indexMap } where indexMap[i] = document API index for character i.
 */
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
          text.push(content[i])
          indexMap.push(startIdx + i)
        }
      }
    }
  }

  return { text: text.join(''), indexMap }
}

/**
 * Find a text span within a Google Doc and return its document API indices.
 * Tries exact match first, then case-insensitive, then whitespace-normalized.
 */
function findTextInDoc(
  spanText: string,
  docText: string,
  indexMap: number[]
): { startIndex: number; endIndex: number } | null {
  if (!spanText || !docText) return null

  const normalized = spanText.replace(/\s+/g, ' ').trim()

  // Exact match
  let pos = docText.indexOf(normalized)

  // Case-insensitive
  if (pos === -1) {
    pos = docText.toLowerCase().indexOf(normalized.toLowerCase())
  }

  // Whitespace-normalized
  if (pos === -1) {
    const normDoc = docText.replace(/\s+/g, ' ')
    const idx = normDoc.indexOf(normalized)
    if (idx !== -1) pos = idx
  }

  if (pos === -1 || pos + normalized.length > indexMap.length) return null

  return {
    startIndex: indexMap[pos],
    endIndex: indexMap[pos + normalized.length - 1] + 1,
  }
}

/**
 * Apply background-color highlighting to text ranges in a Google Doc.
 * Uses the Google Docs API batchUpdate with updateTextStyle.
 *
 * @param googleDocId - The document ID
 * @param highlights - Array of { spanText, category } to highlight
 * @returns Number of highlights successfully applied
 */
export async function highlightTextInGoogleDoc(
  googleDocId: string,
  highlights: { spanText: string; category: string }[]
): Promise<number> {
  if (!googleDocId || highlights.length === 0) return 0

  const doc = await fetchDocumentRaw(googleDocId)
  const { text, indexMap } = buildIndexMap(doc)

  if (!text || indexMap.length === 0) {
    console.warn('[Follow] Could not build index map from document')
    return 0
  }

  const requests: Array<Record<string, unknown>> = []

  for (const h of highlights) {
    const range = findTextInDoc(h.spanText, text, indexMap)
    if (!range) {
      console.warn(`[Follow] Could not find text in doc: "${h.spanText.slice(0, 50)}..."`)
      continue
    }

    const color = HIGHLIGHT_COLORS[h.category] || HIGHLIGHT_COLORS['highlight']

    requests.push({
      updateTextStyle: {
        range: {
          startIndex: range.startIndex,
          endIndex: range.endIndex,
        },
        textStyle: {
          backgroundColor: {
            color: { rgbColor: color },
          },
        },
        fields: 'backgroundColor',
      },
    })
  }

  if (requests.length === 0) return 0

  const token = await getAuthToken()
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${googleDocId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    console.error(`[Follow] Docs API batchUpdate error ${res.status}:`, err)
    return 0
  }

  console.log(`[Follow] Applied ${requests.length} highlights via Google Docs API`)
  return requests.length
}

/**
 * Apply text formatting (underline, bold, italic) to text spans in a Google Doc.
 * Uses the Google Docs API batchUpdate with updateTextStyle.
 */
export async function formatTextInGoogleDoc(
  googleDocId: string,
  spans: { spanText: string; format: 'underline' | 'bold' | 'italic' }[]
): Promise<number> {
  if (!googleDocId || spans.length === 0) return 0

  const doc = await fetchDocumentRaw(googleDocId)
  const { text, indexMap } = buildIndexMap(doc)

  if (!text || indexMap.length === 0) {
    console.warn('[Follow] Could not build index map from document')
    return 0
  }

  const requests: Array<Record<string, unknown>> = []

  for (const s of spans) {
    const range = findTextInDoc(s.spanText, text, indexMap)
    if (!range) {
      console.warn(`[Follow] Could not find text in doc for formatting: "${s.spanText.slice(0, 50)}..."`)
      continue
    }

    const styleField = s.format // 'underline' | 'bold' | 'italic'
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: range.startIndex,
          endIndex: range.endIndex,
        },
        textStyle: {
          [styleField]: true,
        },
        fields: styleField,
      },
    })
  }

  if (requests.length === 0) return 0

  const token = await getAuthToken()
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${googleDocId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    console.error(`[Follow] Docs API formatText error ${res.status}:`, err)
    return 0
  }

  console.log(`[Follow] Applied ${requests.length} text format changes via Google Docs API`)
  return requests.length
}

/**
 * Remove background-color highlights from specific text spans in a Google Doc.
 * Sets backgroundColor to white (effectively clearing it).
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
        textStyle: {
          backgroundColor: {
            color: { rgbColor: { red: 1, green: 1, blue: 1 } },
          },
        },
        fields: 'backgroundColor',
      },
    })
  }

  if (requests.length === 0) return 0

  const token = await getAuthToken()
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${googleDocId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    console.error(`[Follow] Clear highlights error ${res.status}:`, err)
    return 0
  }

  console.log(`[Follow] Cleared ${requests.length} highlights`)
  return requests.length
}

/**
 * Edit a Google Doc via the Docs API batchUpdate.
 * Supports: replace (find & replace text), insert (insert after a text match),
 * and append (add to end of document).
 */
export async function editGoogleDoc(
  googleDocId: string,
  action: 'replace' | 'insert' | 'append',
  newText: string,
  findText?: string
): Promise<{ success: boolean; error?: string }> {
  if (!googleDocId || !newText) {
    return { success: false, error: 'Missing googleDocId or newText' }
  }

  try {
    const doc = await fetchDocumentRaw(googleDocId)
    const { text, indexMap } = buildIndexMap(doc)
    const requests: Array<Record<string, unknown>> = []

    if (action === 'append') {
      // Insert at the end of the document body
      const endIndex = doc.body?.content?.at(-1)?.endIndex ?? 1
      requests.push({
        insertText: {
          location: { index: endIndex - 1 },
          text: '\n' + newText,
        },
      })
    } else if (action === 'replace' && findText) {
      const range = findTextInDoc(findText, text, indexMap)
      if (!range) {
        return { success: false, error: `Could not find text: "${findText.slice(0, 80)}"` }
      }
      // Delete old text, then insert new text at the same position
      requests.push(
        { deleteContentRange: { range: { startIndex: range.startIndex, endIndex: range.endIndex } } },
        { insertText: { location: { index: range.startIndex }, text: newText } }
      )
    } else if (action === 'insert' && findText) {
      const range = findTextInDoc(findText, text, indexMap)
      if (!range) {
        return { success: false, error: `Could not find anchor text: "${findText.slice(0, 80)}"` }
      }
      // Insert BEFORE the found text (e.g. insert before "Introduction" heading)
      requests.push({
        insertText: {
          location: { index: range.startIndex },
          text: newText + '\n\n',
        },
      })
    } else {
      return { success: false, error: `Invalid action/params: action=${action}, findText=${!!findText}` }
    }

    const token = await getAuthToken()
    const res = await fetch(
      `https://docs.googleapis.com/v1/documents/${googleDocId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      }
    )

    if (!res.ok) {
      const err = await res.text()
      console.error(`[Follow] editGoogleDoc batchUpdate error ${res.status}:`, err)
      return { success: false, error: `API error ${res.status}` }
    }

    console.log(`[Follow] editGoogleDoc success: ${action} (${newText.length} chars)`)
    return { success: true }
  } catch (err) {
    console.error('[Follow] editGoogleDoc failed:', err)
    return { success: false, error: (err as Error).message }
  }
}

/**
 * Insert draft text into a Google Doc with a light blue highlight.
 * Used by the Native Inline Draft Preview system.
 */
export async function insertDraftText(
  googleDocId: string,
  action: 'replace' | 'insert' | 'append',
  newText: string,
  findText?: string
): Promise<{ success: boolean; startIndex: number; endIndex: number; error?: string }> {
  if (!googleDocId || !newText) {
    return { success: false, startIndex: 0, endIndex: 0, error: 'Missing googleDocId or newText' }
  }

  try {
    const doc = await fetchDocumentRaw(googleDocId)
    const { text, indexMap } = buildIndexMap(doc)
    const requests: Array<Record<string, unknown>> = []
    let insertionIndex: number
    let insertedText: string

    if (action === 'append') {
      const endIndex = doc.body?.content?.at(-1)?.endIndex ?? 1
      insertionIndex = endIndex - 1
      insertedText = '\n' + newText
      requests.push({
        insertText: {
          location: { index: insertionIndex },
          text: insertedText,
        },
      })
    } else if (action === 'replace' && findText) {
      const range = findTextInDoc(findText, text, indexMap)
      if (!range) {
        return { success: false, startIndex: 0, endIndex: 0, error: `Could not find text: "${findText.slice(0, 80)}"` }
      }
      insertionIndex = range.startIndex
      insertedText = newText
      requests.push(
        { deleteContentRange: { range: { startIndex: range.startIndex, endIndex: range.endIndex } } },
        { insertText: { location: { index: insertionIndex }, text: insertedText } }
      )
    } else if (action === 'insert' && findText) {
      const range = findTextInDoc(findText, text, indexMap)
      if (!range) {
        return { success: false, startIndex: 0, endIndex: 0, error: `Could not find anchor text: "${findText.slice(0, 80)}"` }
      }
      insertionIndex = range.startIndex
      insertedText = newText + '\n'
      requests.push({
        insertText: {
          location: { index: insertionIndex },
          text: insertedText,
        },
      })
    } else {
      return { success: false, startIndex: 0, endIndex: 0, error: `Invalid action/params: action=${action}, findText=${!!findText}` }
    }

    // Apply light blue background highlight to the inserted text
    const highlightStart = insertionIndex
    const highlightEnd = insertionIndex + insertedText.length
    requests.push({
      updateTextStyle: {
        range: { startIndex: highlightStart, endIndex: highlightEnd },
        textStyle: {
          backgroundColor: {
            color: { rgbColor: { red: 0.86, green: 0.93, blue: 1.0 } },
          },
        },
        fields: 'backgroundColor',
      },
    })

    const token = await getAuthToken()
    const res = await fetch(
      `https://docs.googleapis.com/v1/documents/${googleDocId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      }
    )

    if (!res.ok) {
      const err = await res.text()
      console.error(`[Follow] insertDraftText batchUpdate error ${res.status}:`, err)
      return { success: false, startIndex: 0, endIndex: 0, error: `API error ${res.status}` }
    }

    console.log(`[Follow] insertDraftText success: ${action} (${insertedText.length} chars) at [${highlightStart}, ${highlightEnd}]`)
    return { success: true, startIndex: highlightStart, endIndex: highlightEnd }
  } catch (err) {
    console.error('[Follow] insertDraftText failed:', err)
    return { success: false, startIndex: 0, endIndex: 0, error: (err as Error).message }
  }
}

/**
 * Commit draft text by clearing the blue highlight (set background to white).
 */
export async function commitDraftText(
  googleDocId: string,
  startIndex: number,
  endIndex: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const token = await getAuthToken()
    const res = await fetch(
      `https://docs.googleapis.com/v1/documents/${googleDocId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              updateTextStyle: {
                range: { startIndex, endIndex },
                textStyle: {
                  backgroundColor: {
                    color: { rgbColor: { red: 1, green: 1, blue: 1 } },
                  },
                },
                fields: 'backgroundColor',
              },
            },
          ],
        }),
      }
    )

    if (!res.ok) {
      const err = await res.text()
      console.error(`[Follow] commitDraftText error ${res.status}:`, err)
      return { success: false, error: `API error ${res.status}` }
    }

    console.log(`[Follow] commitDraftText success: cleared highlight [${startIndex}, ${endIndex}]`)
    return { success: true }
  } catch (err) {
    console.error('[Follow] commitDraftText failed:', err)
    return { success: false, error: (err as Error).message }
  }
}

/**
 * Discard draft text by deleting it from the document.
 */
export async function discardDraftText(
  googleDocId: string,
  startIndex: number,
  endIndex: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const token = await getAuthToken()
    const res = await fetch(
      `https://docs.googleapis.com/v1/documents/${googleDocId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              deleteContentRange: {
                range: { startIndex, endIndex },
              },
            },
          ],
        }),
      }
    )

    if (!res.ok) {
      const err = await res.text()
      console.error(`[Follow] discardDraftText error ${res.status}:`, err)
      return { success: false, error: `API error ${res.status}` }
    }

    console.log(`[Follow] discardDraftText success: deleted [${startIndex}, ${endIndex}]`)
    return { success: true }
  } catch (err) {
    console.error('[Follow] discardDraftText failed:', err)
    return { success: false, error: (err as Error).message }
  }
}

/**
 * Scroll to a text span in the Google Docs editor by finding it in the DOM
 * and scrolling it into view. Works with the Kix editor's DOM structure.
 */
export function scrollToTextInGoogleDoc(spanText: string): boolean {
  if (!spanText) return false

  // Google Docs uses .kix-lineview elements for each line of text
  const searchStr = spanText.slice(0, 60).trim() // use first 60 chars to find
  const lineViews = document.querySelectorAll('.kix-lineview')

  for (const line of lineViews) {
    const text = line.textContent || ''
    if (text.includes(searchStr) || text.toLowerCase().includes(searchStr.toLowerCase())) {
      line.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Flash effect — briefly outline the line
      const el = line as HTMLElement
      const prev = el.style.outline
      el.style.outline = '2px solid #6366F1'
      el.style.outlineOffset = '2px'
      el.style.borderRadius = '4px'
      setTimeout(() => {
        el.style.outline = prev
        el.style.outlineOffset = ''
        el.style.borderRadius = ''
      }, 2000)
      return true
    }
  }

  // Fallback: try searching in .kix-paragraphrenderer
  const paragraphs = document.querySelectorAll('.kix-paragraphrenderer')
  for (const para of paragraphs) {
    const text = para.textContent || ''
    if (text.includes(searchStr) || text.toLowerCase().includes(searchStr.toLowerCase())) {
      para.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const el = para as HTMLElement
      const prev = el.style.outline
      el.style.outline = '2px solid #6366F1'
      el.style.outlineOffset = '2px'
      setTimeout(() => {
        el.style.outline = prev
        el.style.outlineOffset = ''
      }, 2000)
      return true
    }
  }

  console.warn(`[Follow] Could not find text in DOM to scroll to: "${searchStr}"`)
  return false
}
