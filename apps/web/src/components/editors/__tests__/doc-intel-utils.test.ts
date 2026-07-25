import { describe, it, expect } from 'vitest'
import {
  getMarkUnderlineColor,
  segmentTextByMarks,
  type InlineTextMark,
} from '../doc-intel-utils'
import type { SuggestionMark, AnalysisFinding } from '@workspace/shared/types'

// ── Fixtures ──

function makeSuggestion(type: string): SuggestionMark {
  return {
    id: 's1',
    suggestionType: type as SuggestionMark['suggestionType'],
    spanText: 'test',
    originalText: 'test',
    variants: [],
    explanation: '',
    confidence: 0.8,
  }
}

function makeFinding(mode: string): AnalysisFinding {
  return {
    id: 'f1',
    mode: mode as AnalysisFinding['mode'],
    spanText: 'test',
    finding: 'test',
    severity: 'info',
  }
}

function makeMark(markId: string, offset: number, length: number, color = '#8b5cf6'): InlineTextMark {
  return { markId, charOffset: offset, charLength: length, underlineColor: color }
}

// ── Tests ──

describe('Doc Intel Utils', () => {
  describe('getMarkUnderlineColor', () => {
    it('returns amber for clarity suggestions', () => {
      expect(getMarkUnderlineColor(makeSuggestion('clarity'))).toBe('#f59e0b')
    })

    it('returns blue for conciseness suggestions', () => {
      expect(getMarkUnderlineColor(makeSuggestion('conciseness'))).toBe('#3b82f6')
    })

    it('returns violet for tone suggestions', () => {
      expect(getMarkUnderlineColor(makeSuggestion('tone'))).toBe('#8b5cf6')
    })

    it('returns green for grammar suggestions', () => {
      expect(getMarkUnderlineColor(makeSuggestion('grammar'))).toBe('#10b981')
    })

    it('returns rose for structure suggestions', () => {
      expect(getMarkUnderlineColor(makeSuggestion('structure'))).toBe('#f43f5e')
    })

    it('returns purple for custom suggestions', () => {
      expect(getMarkUnderlineColor(makeSuggestion('custom'))).toBe('#a855f7')
    })

    it('returns blue for analyze_logic findings', () => {
      expect(getMarkUnderlineColor(makeFinding('analyze_logic'))).toBe('#3b82f6')
    })

    it('returns amber for analyze_evidence findings', () => {
      expect(getMarkUnderlineColor(makeFinding('analyze_evidence'))).toBe('#f59e0b')
    })

    it('returns rose for analyze_bias findings', () => {
      expect(getMarkUnderlineColor(makeFinding('analyze_bias'))).toBe('#f43f5e')
    })

    it('returns fallback violet for unknown types', () => {
      expect(getMarkUnderlineColor(makeFinding('analyze_custom'))).toBe('#a855f7')
    })
  })

  describe('segmentTextByMarks', () => {
    it('returns single segment for no marks', () => {
      const result = segmentTextByMarks('Hello World', [])
      expect(result).toEqual([{ text: 'Hello World' }])
    })

    it('returns single segment for empty text', () => {
      const result = segmentTextByMarks('', [makeMark('m1', 0, 5)])
      expect(result).toEqual([{ text: '' }])
    })

    it('segments text with one mark in the middle', () => {
      const result = segmentTextByMarks(
        'The quick brown fox',
        [makeMark('m1', 4, 5)] // "quick"
      )
      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({ text: 'The ' })
      expect(result[1]!.text).toBe('quick')
      expect(result[1]!.mark!.markId).toBe('m1')
      expect(result[2]).toEqual({ text: ' brown fox' })
    })

    it('segments text with mark at start', () => {
      const result = segmentTextByMarks(
        'Hello World',
        [makeMark('m1', 0, 5)] // "Hello"
      )
      expect(result).toHaveLength(2)
      expect(result[0]!.text).toBe('Hello')
      expect(result[0]!.mark!.markId).toBe('m1')
      expect(result[1]).toEqual({ text: ' World' })
    })

    it('segments text with mark at end', () => {
      const result = segmentTextByMarks(
        'Hello World',
        [makeMark('m1', 6, 5)] // "World"
      )
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ text: 'Hello ' })
      expect(result[1]!.text).toBe('World')
      expect(result[1]!.mark!.markId).toBe('m1')
    })

    it('handles multiple non-overlapping marks', () => {
      const result = segmentTextByMarks(
        'The quick brown fox jumps',
        [
          makeMark('m1', 4, 5, '#f59e0b'),  // "quick"
          makeMark('m2', 16, 3, '#3b82f6'),  // "fox"
        ]
      )
      expect(result).toHaveLength(5)
      expect(result[0]).toEqual({ text: 'The ' })
      expect(result[1]!.text).toBe('quick')
      expect(result[1]!.mark!.underlineColor).toBe('#f59e0b')
      expect(result[2]).toEqual({ text: ' brown ' })
      expect(result[3]!.text).toBe('fox')
      expect(result[3]!.mark!.underlineColor).toBe('#3b82f6')
      expect(result[4]).toEqual({ text: ' jumps' })
    })

    it('skips marks with out-of-bounds offsets', () => {
      const result = segmentTextByMarks(
        'Short',
        [makeMark('m1', 100, 5)]
      )
      expect(result).toEqual([{ text: 'Short' }])
    })

    it('clamps mark length to text boundary', () => {
      const result = segmentTextByMarks(
        'Hello',
        [makeMark('m1', 3, 100)] // starts at 3, would extend past end
      )
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ text: 'Hel' })
      expect(result[1]!.text).toBe('lo')
      expect(result[1]!.mark!.markId).toBe('m1')
    })

    it('sorts marks by offset regardless of input order', () => {
      const result = segmentTextByMarks(
        'ABCDEFGHIJ',
        [
          makeMark('m2', 5, 2), // "FG"
          makeMark('m1', 1, 2), // "BC"
        ]
      )
      expect(result).toHaveLength(5)
      expect(result[0]).toEqual({ text: 'A' })
      expect(result[1]!.text).toBe('BC')
      expect(result[1]!.mark!.markId).toBe('m1')
      expect(result[2]).toEqual({ text: 'DE' })
      expect(result[3]!.text).toBe('FG')
      expect(result[3]!.mark!.markId).toBe('m2')
      expect(result[4]).toEqual({ text: 'HIJ' })
    })
  })
})
