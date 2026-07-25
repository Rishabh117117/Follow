/**
 * Materialization Service — writes AI-generated content into Google Workspace docs.
 * Falls back to clipboard paste when API write fails.
 */

import { docsReplaceAllText, docsInsertText, sheetsUpdateValues, slidesBatchUpdate } from '@/lib/google-workspace-write'
import type { GoogleDocType } from '@/lib/google-doc-utils'

export interface MaterializeResult {
  success: boolean
  method: 'api' | 'clipboard'
  error?: string
}

export async function materializeReplacement(
  googleDocId: string, docType: GoogleDocType, originalText: string, newText: string
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

  if (docType === 'slides') {
    try {
      await slidesBatchUpdate(googleDocId, [{
        replaceAllText: { containsText: { text: originalText, matchCase: true }, replaceText: newText },
      }])
      return { success: true, method: 'api' }
    } catch (err) {
      console.warn('[Follow] Slides API replace failed, falling back to clipboard:', err)
      return clipboardFallback(newText)
    }
  }

  return clipboardFallback(newText)
}

export async function materializeInsertion(
  googleDocId: string, docType: GoogleDocType, text: string, insertIndex?: number
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
  return clipboardFallback(text)
}

export async function materializeSheetValues(
  spreadsheetId: string, range: string, values: string[][]
): Promise<MaterializeResult> {
  try {
    await sheetsUpdateValues(spreadsheetId, range, values)
    return { success: true, method: 'api' }
  } catch (err) {
    return { success: false, method: 'api', error: (err as Error).message }
  }
}

async function clipboardFallback(text: string): Promise<MaterializeResult> {
  try {
    await navigator.clipboard.writeText(text)
    const editor = document.querySelector<HTMLElement>('.kix-appview-editor [contenteditable="true"]')
    if (editor) {
      editor.focus()
      document.execCommand('paste')
    }
    return { success: true, method: 'clipboard' }
  } catch (err) {
    return { success: false, method: 'clipboard', error: (err as Error).message }
  }
}
