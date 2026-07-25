/**
 * Google Doc URL parsing and type detection utilities.
 */

import type { PageType } from './constants'

export type GoogleDocType = 'docs' | 'sheets' | 'slides'

export interface DetectedPage {
  pageType: PageType
  googleDocId: string
  docType: GoogleDocType
}

/**
 * Detect the page type and extract Google Doc ID from the current URL.
 * Returns null if not a recognized page.
 */
export function detectGoogleWorkspacePage(url: string): DetectedPage | null {
  const docMatch = url.match(/docs\.google\.com\/document\/d\/([^/]+)/)
  if (docMatch) {
    return { pageType: 'google-docs', googleDocId: docMatch[1]!, docType: 'docs' }
  }

  const sheetMatch = url.match(/docs\.google\.com\/spreadsheets\/d\/([^/]+)/)
  if (sheetMatch) {
    return { pageType: 'google-sheets', googleDocId: sheetMatch[1]!, docType: 'sheets' }
  }

  const slideMatch = url.match(/docs\.google\.com\/presentation\/d\/([^/]+)/)
  if (slideMatch) {
    return { pageType: 'google-slides', googleDocId: slideMatch[1]!, docType: 'slides' }
  }

  return null
}

/**
 * Detect if the current page is a PDF.
 */
export function isPdfPage(url: string): boolean {
  if (/\.pdf(\?|#|$)/i.test(url)) return true
  if (typeof document !== 'undefined') {
    if (document.contentType === 'application/pdf') return true
    if (document.querySelector('embed#plugin[type="application/x-google-chrome-pdf"]')) return true
    if (document.querySelector('embed[type="application/pdf"]')) return true
  }
  return false
}

/**
 * Classify the current page.
 */
export function classifyPage(url: string): PageType {
  const gwsPage = detectGoogleWorkspacePage(url)
  if (gwsPage) return gwsPage.pageType
  if (isPdfPage(url)) return 'pdf'
  return 'web'
}

/**
 * Extract document title from the page, stripping Google's suffix.
 */
export function getDocTitle(): string {
  if (typeof document === 'undefined') return 'Untitled'
  return document.title.replace(/ - Google (Docs|Sheets|Slides)$/, '') || 'Untitled'
}
