/**
 * Google Workspace Write API — batchUpdate for Docs, Sheets, Slides.
 * Uses OAuth2 token via chrome.identity.
 */

import { sendToBackground } from '@/core/message-bus'

async function getAuthToken(): Promise<string> {
  const result = await sendToBackground<{ token: string }>({ type: 'GET_GOOGLE_AUTH_TOKEN' })
  if (!result.success || !result.data?.token) {
    throw new Error(result.error || 'No token returned')
  }
  return result.data.token
}

// ─── Google Docs ─────────────────────────────────────────────────

export interface DocsRequest {
  insertText?: { location: { index: number }; text: string }
  deleteContentRange?: { range: { startIndex: number; endIndex: number } }
  replaceAllText?: { containsText: { text: string; matchCase: boolean }; replaceText: string }
}

export async function docsBatchUpdate(documentId: string, requests: DocsRequest[]): Promise<void> {
  const token = await getAuthToken()
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  })
  if (!res.ok) throw new Error(`Docs batchUpdate failed (${res.status}): ${await res.text()}`)
}

export async function docsInsertText(documentId: string, index: number, text: string): Promise<void> {
  await docsBatchUpdate(documentId, [{ insertText: { location: { index }, text } }])
}

export async function docsReplaceAllText(documentId: string, searchText: string, replaceText: string, matchCase = true): Promise<void> {
  await docsBatchUpdate(documentId, [{ replaceAllText: { containsText: { text: searchText, matchCase }, replaceText } }])
}

export async function docsReplaceRange(documentId: string, startIndex: number, endIndex: number, newText: string): Promise<void> {
  await docsBatchUpdate(documentId, [
    { deleteContentRange: { range: { startIndex, endIndex } } },
    { insertText: { location: { index: startIndex }, text: newText } },
  ])
}

// ─── Google Sheets ───────────────────────────────────────────────

export async function sheetsUpdateValues(spreadsheetId: string, range: string, values: string[][]): Promise<void> {
  const token = await getAuthToken()
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range, values }),
    }
  )
  if (!res.ok) throw new Error(`Sheets update failed (${res.status}): ${await res.text()}`)
}

// ─── Google Slides ───────────────────────────────────────────────

export interface SlidesRequest {
  replaceAllText?: { containsText: { text: string; matchCase: boolean }; replaceText: string }
  insertText?: { objectId: string; insertionIndex: number; text: string }
}

export async function slidesBatchUpdate(presentationId: string, requests: SlidesRequest[]): Promise<void> {
  const token = await getAuthToken()
  const res = await fetch(`https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  })
  if (!res.ok) throw new Error(`Slides batchUpdate failed (${res.status}): ${await res.text()}`)
}
