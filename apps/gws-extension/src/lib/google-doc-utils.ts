/** Google Document URL parsing utilities */

export type GoogleDocType = 'docs' | 'sheets' | 'slides'

export interface ParsedGoogleDoc {
  docType: GoogleDocType
  googleDocId: string
}

/** URL patterns for Google Workspace documents */
const DOC_PATTERNS: { pattern: RegExp; type: GoogleDocType }[] = [
  { pattern: /\/document\/d\/([a-zA-Z0-9_-]+)/, type: 'docs' },
  { pattern: /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/, type: 'sheets' },
  { pattern: /\/presentation\/d\/([a-zA-Z0-9_-]+)/, type: 'slides' },
]

/**
 * Parse a Google Docs URL to extract document type and ID.
 * Returns null if the URL is not a recognized Google Workspace document.
 */
export function parseGoogleDocUrl(url: string): ParsedGoogleDoc | null {
  for (const { pattern, type } of DOC_PATTERNS) {
    const match = url.match(pattern)
    if (match?.[1]) {
      return { docType: type, googleDocId: match[1] }
    }
  }
  return null
}

/**
 * Check if a URL is a Google Workspace document.
 */
export function isGoogleDocUrl(url: string): boolean {
  return parseGoogleDocUrl(url) !== null
}

/**
 * Get a human-readable label for a Google doc type.
 */
export function getDocTypeLabel(docType: GoogleDocType): string {
  switch (docType) {
    case 'docs':
      return 'Google Docs'
    case 'sheets':
      return 'Google Sheets'
    case 'slides':
      return 'Google Slides'
  }
}
