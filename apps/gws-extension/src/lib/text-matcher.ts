/**
 * Text Matcher — converts annotation spanText strings to paragraph/character
 * offset ranges for the DocIntelMarks overlay system.
 */

import type { DocIntelType } from '@/stores/overlay-store'

export interface TextRange {
  startPara: number
  startChar: number
  endPara: number
  endChar: number
}

/**
 * Map a category string from the annotate_document tool to a DocIntelType.
 */
export function categoryToDocIntelType(category: string): DocIntelType {
  switch (category) {
    case 'key-concept':
    case 'definition':
      return 'clarity'
    case 'evidence':
    case 'data':
    case 'quote':
      return 'tone'
    case 'action-item':
    case 'task':
    case 'todo':
      return 'grammar'
    case 'concern':
    case 'issue':
    case 'warning':
      return 'conciseness'
    case 'important':
    case 'highlight':
    case 'structure':
    default:
      return 'structure'
  }
}

/**
 * Match a spanText string to paragraph/character offsets within the document.
 *
 * @param spanText - Exact text substring from the AI annotation
 * @param paragraphTexts - Array of paragraph text strings (one per paragraph)
 * @returns TextRange if found, null if no match
 */
export function matchSpanToRange(
  spanText: string,
  paragraphTexts: string[]
): TextRange | null {
  if (!spanText || paragraphTexts.length === 0) return null

  // Normalize whitespace for matching
  const normalizedSpan = spanText.replace(/\s+/g, ' ').trim()
  if (!normalizedSpan) return null

  // Build a joined text with paragraph boundaries tracked
  // Each paragraph is separated by \n to maintain offset mapping
  const paraOffsets: { start: number; end: number }[] = []
  let joined = ''

  for (const text of paragraphTexts) {
    const start = joined.length
    joined += text
    paraOffsets.push({ start, end: joined.length })
    joined += '\n'
  }

  // Try exact match first
  let matchIndex = joined.indexOf(normalizedSpan)

  // Try case-insensitive if exact fails
  if (matchIndex === -1) {
    matchIndex = joined.toLowerCase().indexOf(normalizedSpan.toLowerCase())
  }

  // Try with normalized whitespace in both sides
  if (matchIndex === -1) {
    const normalizedJoined = joined.replace(/\s+/g, ' ')
    const idx = normalizedJoined.indexOf(normalizedSpan)
    if (idx !== -1) {
      // Map back to original position (approximate)
      matchIndex = idx
    }
  }

  if (matchIndex === -1) return null

  const matchEnd = matchIndex + normalizedSpan.length

  // Find start paragraph and char offset
  let startPara = 0
  let startChar = 0
  for (let i = 0; i < paraOffsets.length; i++) {
    if (matchIndex >= paraOffsets[i].start && matchIndex < paraOffsets[i].end + 1) {
      startPara = i
      startChar = matchIndex - paraOffsets[i].start
      break
    }
  }

  // Find end paragraph and char offset
  let endPara = startPara
  let endChar = startChar + normalizedSpan.length
  for (let i = startPara; i < paraOffsets.length; i++) {
    if (matchEnd <= paraOffsets[i].end + 1) {
      endPara = i
      endChar = matchEnd - paraOffsets[i].start
      break
    }
  }

  return { startPara, startChar, endPara, endChar }
}
