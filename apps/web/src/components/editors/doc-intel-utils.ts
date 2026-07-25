/**
 * Shared utility for Document Intelligence underline colors.
 * Maps suggestion types and analysis modes to CSS colors matching globals.css.
 */

import type { SuggestionMark, AnalysisFinding } from '@workspace/shared/types'

const SUGGESTION_TYPE_COLORS: Record<string, string> = {
  clarity: '#f59e0b',
  conciseness: '#3b82f6',
  tone: '#8b5cf6',
  grammar: '#10b981',
  structure: '#f43f5e',
  custom: '#a855f7',
}

const ANALYSIS_MODE_COLORS: Record<string, string> = {
  analyze_logic: '#3b82f6',
  analyze_evidence: '#f59e0b',
  analyze_bias: '#f43f5e',
  analyze_structure: '#f43f5e',
  analyze_audience: '#8b5cf6',
  analyze_custom: '#a855f7',
}

/**
 * Get the underline color for a suggestion or analysis finding.
 * Colors match the `.doc-suggestion-*` CSS classes in globals.css.
 */
export function getMarkUnderlineColor(mark: SuggestionMark | AnalysisFinding): string {
  if ('suggestionType' in mark) {
    return SUGGESTION_TYPE_COLORS[mark.suggestionType] ?? '#8b5cf6'
  }
  return ANALYSIS_MODE_COLORS[mark.mode] ?? '#8b5cf6'
}

/**
 * A positioned text mark within a text element for inline underline rendering.
 */
export interface InlineTextMark {
  markId: string
  charOffset: number
  charLength: number
  underlineColor: string
}

/**
 * Split text content into segments based on marks for rendering with inline underlines.
 * Returns an array of segments: either plain text or marked text.
 */
export function segmentTextByMarks(
  text: string,
  marks: InlineTextMark[]
): Array<{ text: string; mark?: InlineTextMark }> {
  if (marks.length === 0 || !text) {
    return [{ text }]
  }

  // Sort marks by char offset, filter to valid range
  const sorted = marks
    .filter((m) => m.charOffset >= 0 && m.charOffset < text.length)
    .sort((a, b) => a.charOffset - b.charOffset)

  if (sorted.length === 0) {
    return [{ text }]
  }

  const segments: Array<{ text: string; mark?: InlineTextMark }> = []
  let cursor = 0

  for (const mark of sorted) {
    const start = mark.charOffset
    const end = Math.min(start + mark.charLength, text.length)

    // Skip if this mark overlaps with previous
    if (start < cursor) continue

    // Add unmarked text before this mark
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start) })
    }

    // Add marked text
    segments.push({
      text: text.slice(start, end),
      mark,
    })

    cursor = end
  }

  // Add remaining unmarked text
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) })
  }

  return segments
}
