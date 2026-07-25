/**
 * Detects if the current page is a Google Docs/Sheets/Slides document
 * and extracts the document ID from the URL.
 */

import { parseGoogleDocUrl, type GoogleDocType, type ParsedGoogleDoc } from '@/lib/google-doc-utils'

let cachedResult: ParsedGoogleDoc | null = null

/**
 * Detect the current page type and extract the Google document ID.
 * Caches the result since the URL won't change within a content script lifecycle.
 */
export function detectPage(): ParsedGoogleDoc | null {
  if (cachedResult !== undefined && cachedResult !== null) return cachedResult
  cachedResult = parseGoogleDocUrl(window.location.href)
  return cachedResult
}

/**
 * Get the detected document type. Returns null if not on a Google Workspace page.
 */
export function getDocType(): GoogleDocType | null {
  return detectPage()?.docType ?? null
}

/**
 * Get the Google document ID. Returns null if not on a Google Workspace page.
 */
export function getGoogleDocId(): string | null {
  return detectPage()?.googleDocId ?? null
}
