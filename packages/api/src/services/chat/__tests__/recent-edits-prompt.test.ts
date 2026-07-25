import { describe, it, expect } from 'vitest'
import { buildRecentEditsSection } from '../system-prompt'

describe('buildRecentEditsSection', () => {
  it('returns empty string for empty edits array', () => {
    expect(buildRecentEditsSection([])).toBe('')
  })

  it('formats a deletion edit correctly', () => {
    const result = buildRecentEditsSection([
      {
        editType: 'deletion',
        removedText: 'This paragraph was removed from the document',
        addedText: '',
        context: 'end of the introduction.',
        time: new Date(Date.now() - 120000).toISOString(),
      },
    ])
    expect(result).toContain('## Recent Document Edits')
    expect(result).toContain('DELETED')
    expect(result).toContain('This paragraph was removed')
    expect(result).toContain('end of the introduction.')
  })

  it('formats an insertion edit correctly', () => {
    const result = buildRecentEditsSection([
      {
        editType: 'insertion',
        removedText: '',
        addedText: 'This insight connects to the framework of disruptive innovation',
        context: 'adaptability.',
        time: new Date(Date.now() - 15000).toISOString(),
      },
    ])
    expect(result).toContain('INSERTED')
    expect(result).toContain('This insight connects')
    expect(result).toContain('adaptability.')
  })

  it('formats a replacement edit correctly', () => {
    const result = buildRecentEditsSection([
      {
        editType: 'replacement',
        removedText: 'strategic tensions',
        addedText: 'strategic and creative tensions',
        context: 'found the eight questions',
        time: new Date(Date.now() - 30000).toISOString(),
      },
    ])
    expect(result).toContain('REPLACED')
    expect(result).toContain('strategic tensions')
    expect(result).toContain('strategic and creative tensions')
    expect(result).toContain('→') // → arrow
  })

  it('handles multiple edits', () => {
    const result = buildRecentEditsSection([
      {
        editType: 'deletion',
        removedText: 'Removed paragraph about innovation',
        addedText: '',
        context: 'intro section',
        time: new Date(Date.now() - 120000).toISOString(),
      },
      {
        editType: 'replacement',
        removedText: 'old phrase',
        addedText: 'new phrase',
        context: 'middle section',
        time: new Date(Date.now() - 30000).toISOString(),
      },
      {
        editType: 'insertion',
        removedText: '',
        addedText: 'Added conclusion text',
        context: 'end section',
        time: new Date(Date.now() - 10000).toISOString(),
      },
    ])
    expect(result).toContain('DELETED')
    expect(result).toContain('REPLACED')
    expect(result).toContain('INSERTED')
  })

  it('truncates individual edit texts at 300 chars', () => {
    const longText = 'A'.repeat(500)
    const result = buildRecentEditsSection([
      {
        editType: 'deletion',
        removedText: longText,
        addedText: '',
        context: 'test',
        time: new Date().toISOString(),
      },
    ])
    expect(result).toContain('A'.repeat(300) + '...')
    expect(result).not.toContain('A'.repeat(301))
  })

  it('caps total section at 3000 chars', () => {
    const edits = Array.from({ length: 50 }, (_, i) => ({
      editType: 'deletion' as const,
      removedText: `Edit number ${i}: ${'X'.repeat(180)}`,
      addedText: '',
      context: 'test context',
      time: new Date(Date.now() - i * 1000).toISOString(),
    }))
    const result = buildRecentEditsSection(edits)
    expect(result.length).toBeLessThanOrEqual(3100)
  })

  it('shows relative time labels for seconds', () => {
    const result = buildRecentEditsSection([
      {
        editType: 'insertion',
        removedText: '',
        addedText: 'test content here',
        context: '',
        time: new Date(Date.now() - 45000).toISOString(),
      },
    ])
    expect(result).toContain('s ago')
  })

  it('shows minute-level time for older edits', () => {
    const result = buildRecentEditsSection([
      {
        editType: 'insertion',
        removedText: '',
        addedText: 'test content here',
        context: '',
        time: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      },
    ])
    expect(result).toContain('m ago')
  })
})
