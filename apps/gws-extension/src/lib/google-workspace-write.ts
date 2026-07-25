/**
 * Google Workspace Write API — batchUpdate for Docs, Sheets, Slides.
 * Uses the same OAuth2 token flow as google-docs-api.ts.
 */

/**
 * Get OAuth2 token via service worker.
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

// ─── Google Docs ─────────────────────────────────────────────────

export interface DocsRequest {
  insertText?: { location: { index: number }; text: string }
  deleteContentRange?: { range: { startIndex: number; endIndex: number } }
  replaceAllText?: {
    containsText: { text: string; matchCase: boolean }
    replaceText: string
  }
}

/**
 * Execute a batch update on a Google Doc.
 */
export async function docsBatchUpdate(
  documentId: string,
  requests: DocsRequest[]
): Promise<void> {
  const token = await getAuthToken()

  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
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
    throw new Error(`Docs batchUpdate failed (${res.status}): ${err}`)
  }
}

/**
 * Insert text at a specific position in a Google Doc.
 */
export async function docsInsertText(
  documentId: string,
  index: number,
  text: string
): Promise<void> {
  await docsBatchUpdate(documentId, [
    { insertText: { location: { index }, text } },
  ])
}

/**
 * Replace all occurrences of a text string in a Google Doc.
 */
export async function docsReplaceAllText(
  documentId: string,
  searchText: string,
  replaceText: string,
  matchCase = true
): Promise<void> {
  await docsBatchUpdate(documentId, [
    {
      replaceAllText: {
        containsText: { text: searchText, matchCase },
        replaceText,
      },
    },
  ])
}

/**
 * Replace a specific range in a Google Doc (delete then insert).
 */
export async function docsReplaceRange(
  documentId: string,
  startIndex: number,
  endIndex: number,
  newText: string
): Promise<void> {
  await docsBatchUpdate(documentId, [
    { deleteContentRange: { range: { startIndex, endIndex } } },
    { insertText: { location: { index: startIndex }, text: newText } },
  ])
}

// ─── Google Sheets ───────────────────────────────────────────────

export interface SheetValueRange {
  range: string // e.g., 'Sheet1!A1:B2'
  values: string[][]
}

/**
 * Read values from a Google Sheet range.
 */
export async function sheetsGetValues(
  spreadsheetId: string,
  range: string
): Promise<string[][]> {
  const token = await getAuthToken()

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Sheets get failed (${res.status}): ${err}`)
  }

  const data = await res.json()
  return data.values ?? []
}

/**
 * Write values to a Google Sheet range.
 */
export async function sheetsUpdateValues(
  spreadsheetId: string,
  range: string,
  values: string[][]
): Promise<void> {
  const token = await getAuthToken()

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ range, values }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Sheets update failed (${res.status}): ${err}`)
  }
}

// ─── Google Slides ───────────────────────────────────────────────

export interface SlidesRequest {
  replaceAllText?: {
    containsText: { text: string; matchCase: boolean }
    replaceText: string
  }
  insertText?: {
    objectId: string
    insertionIndex: number
    text: string
  }
  deleteText?: {
    objectId: string
    textRange: { startIndex: number; endIndex: number; type: 'FIXED_RANGE' }
  }
}

/**
 * Execute a batch update on a Google Slides presentation.
 */
export async function slidesBatchUpdate(
  presentationId: string,
  requests: SlidesRequest[]
): Promise<void> {
  const token = await getAuthToken()

  const res = await fetch(
    `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`,
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
    throw new Error(`Slides batchUpdate failed (${res.status}): ${err}`)
  }
}
