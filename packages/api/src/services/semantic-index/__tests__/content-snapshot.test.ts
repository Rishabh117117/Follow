import { describe, it, expect } from 'vitest'
import { extractSection } from '../content-snapshot'
import type { SectionRef } from '../content-snapshot'

describe('ContentSnapshot', () => {
  describe('extractSection', () => {
    const fullText = `# Introduction

This is the intro paragraph.

More intro content here.

# Methods

We used method A and method B.

# Results

The results show improvement.

# Conclusion

In conclusion, it works.`

    it('extracts section by heading match', () => {
      const result = extractSection(fullText, { heading: 'Methods' })
      expect(result).toContain('Methods')
      expect(result).toContain('method A')
    })

    it('extracts section case-insensitively', () => {
      const result = extractSection(fullText, { heading: 'methods' })
      expect(result).toContain('method A')
    })

    it('extracts specific paragraph by offset within section', () => {
      const result = extractSection(fullText, { heading: 'Introduction', paragraphOffset: 0 })
      expect(result).toContain('intro paragraph')
    })

    it('extracts paragraph by index when no heading', () => {
      const result = extractSection(fullText, { paragraphOffset: 0 })
      expect(result).toContain('Introduction')
    })

    it('returns null for missing heading', () => {
      const result = extractSection(fullText, { heading: 'Nonexistent Section' })
      expect(result).toBeNull()
    })

    it('returns null for null sectionRef', () => {
      expect(extractSection(fullText, null)).toBeNull()
    })

    it('returns null for empty text', () => {
      expect(extractSection('', { heading: 'Test' })).toBeNull()
    })

    it('caps section at 2000 characters', () => {
      const longText = `# Section\n\n${'A'.repeat(3000)}`
      const result = extractSection(longText, { heading: 'Section' })
      expect(result!.length).toBeLessThanOrEqual(2000)
    })
  })
})
