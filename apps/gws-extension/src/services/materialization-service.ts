/**
 * Materialization Service — writes AI-generated content into Google Workspace docs
 * via the native APIs (Docs batchUpdate, Sheets values, Slides batchUpdate).
 *
 * Falls back to clipboard paste when API write fails or isn't available.
 */

import {
  docsReplaceAllText,
  docsInsertText,
  sheetsUpdateValues,
  slidesBatchUpdate,
} from '@/lib/google-workspace-write'
import type { GoogleDocType } from '@/lib/google-doc-utils'

export interface MaterializeResult {
  success: boolean
  method: 'api' | 'clipboard'
  error?: string
}

/**
 * Replace text in the current document using the Google Docs API.
 * Falls back to clipboard paste if API fails.
 */
export async function materializeReplacement(
  googleDocId: string,
  docType: GoogleDocType,
  originalText: string,
  newText: string
): Promise<MaterializeResult> {
  if (docType === 'docs') {
    try {
      await docsReplaceAllText(googleDocId, originalText, newText)
      return { success: true, method: 'api' }
    } catch (err) {
      console.warn('[Follow] Docs API replace failed, falling back to clipboard:', err)
      return clipboardFallback(newText)
    }
  }

  if (docType === 'sheets') {
    // Sheets: replacement via API requires knowing the cell range
    // For now, fall back to clipboard
    return clipboardFallback(newText)
  }

  if (docType === 'slides') {
    try {
      await slidesBatchUpdate(googleDocId, [
        {
          replaceAllText: {
            containsText: { text: originalText, matchCase: true },
            replaceText: newText,
          },
        },
      ])
      return { success: true, method: 'api' }
    } catch (err) {
      console.warn('[Follow] Slides API replace failed, falling back to clipboard:', err)
      return clipboardFallback(newText)
    }
  }

  return clipboardFallback(newText)
}

/**
 * Insert text at the end of the document (for ghost draft commits).
 * The index is determined by fetching the document first to get the content length.
 */
export async function materializeInsertion(
  googleDocId: string,
  docType: GoogleDocType,
  text: string,
  insertIndex?: number
): Promise<MaterializeResult> {
  if (docType === 'docs' && insertIndex !== undefined) {
    try {
      await docsInsertText(googleDocId, insertIndex, text)
      return { success: true, method: 'api' }
    } catch (err) {
      console.warn('[Follow] Docs API insert failed, falling back to clipboard:', err)
      return clipboardFallback(text)
    }
  }

  if (docType === 'sheets') {
    // For sheets, append to the next empty row
    return clipboardFallback(text)
  }

  return clipboardFallback(text)
}

/**
 * Write values to a specific Google Sheets range.
 */
export async function materializeSheetValues(
  spreadsheetId: string,
  range: string,
  values: string[][]
): Promise<MaterializeResult> {
  try {
    await sheetsUpdateValues(spreadsheetId, range, values)
    return { success: true, method: 'api' }
  } catch (err) {
    console.warn('[Follow] Sheets API write failed:', err)
    return { success: false, method: 'api', error: (err as Error).message }
  }
}

/**
 * Clipboard paste fallback — copies text to clipboard and simulates paste.
 */
async function clipboardFallback(text: string): Promise<MaterializeResult> {
  try {
    await navigator.clipboard.writeText(text)
    const editor = document.querySelector<HTMLElement>(
      '.kix-appview-editor [contenteditable="true"]'
    )
    if (editor) {
      editor.focus()
      document.execCommand('paste')
    }
    return { success: true, method: 'clipboard' }
  } catch (err) {
    return { success: false, method: 'clipboard', error: (err as Error).message }
  }
}
