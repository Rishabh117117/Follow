import { describe, it, expect, beforeEach } from 'vitest'
import {
  useProvenanceStore,
  computeWordDiff,
  getAttributionLabel,
  getAttributionColor,
  type ParagraphAttribution,
  type TextDiffEntry,
} from '@/stores/provenance-store'

// Reset store between tests
beforeEach(() => {
  useProvenanceStore.getState().reset()
})

// ─── computeWordDiff ─────────────────────────────────────────────────────────

describe('computeWordDiff', () => {
  it('detects added words', () => {
    const segments = computeWordDiff('hello world', 'hello beautiful world')
    const added = segments.filter((s) => s.type === 'added')
    expect(added.length).toBeGreaterThan(0)
    const addedText = added.map((s) => s.text.trim()).join(' ')
    expect(addedText).toContain('beautiful')
  })

  it('detects removed words', () => {
    const segments = computeWordDiff('hello beautiful world', 'hello world')
    const removed = segments.filter((s) => s.type === 'removed')
    expect(removed.length).toBeGreaterThan(0)
    const removedText = removed.map((s) => s.text.trim()).join(' ')
    expect(removedText).toContain('beautiful')
  })

  it('returns all unchanged for identical strings', () => {
    const segments = computeWordDiff('same text here', 'same text here')
    expect(segments.every((s) => s.type === 'unchanged')).toBe(true)
  })

  it('handles empty before (all added)', () => {
    const segments = computeWordDiff('', 'new content')
    const added = segments.filter((s) => s.type === 'added')
    expect(added.length).toBeGreaterThan(0)
  })

  it('handles empty after (all removed)', () => {
    const segments = computeWordDiff('old content', '')
    const removed = segments.filter((s) => s.type === 'removed')
    expect(removed.length).toBeGreaterThan(0)
  })

  it('handles word replacement', () => {
    const segments = computeWordDiff('The quick fox', 'The slow fox')
    const added = segments.filter((s) => s.type === 'added')
    const removed = segments.filter((s) => s.type === 'removed')
    expect(added.length).toBeGreaterThan(0)
    expect(removed.length).toBeGreaterThan(0)
    expect(added.some((s) => s.text.trim() === 'slow')).toBe(true)
    expect(removed.some((s) => s.text.trim() === 'quick')).toBe(true)
  })
})

// ─── Attribution helpers ─────────────────────────────────────────────────────

describe('getAttributionLabel', () => {
  it('returns correct labels for each source', () => {
    expect(getAttributionLabel('human')).toBe('Written by you')
    expect(getAttributionLabel('ai')).toBe('AI-generated')
    expect(getAttributionLabel('mixed')).toBe('Co-authored')
    expect(getAttributionLabel('unknown')).toBe('Unknown origin')
  })
})

describe('getAttributionColor', () => {
  it('returns distinct colors for each source', () => {
    const colors = new Set([
      getAttributionColor('human'),
      getAttributionColor('ai'),
      getAttributionColor('mixed'),
      getAttributionColor('unknown'),
    ])
    expect(colors.size).toBe(4)
  })

  it('returns non-empty strings', () => {
    expect(getAttributionColor('human')).toBeTruthy()
    expect(getAttributionColor('ai')).toBeTruthy()
    expect(getAttributionColor('mixed')).toBeTruthy()
    expect(getAttributionColor('unknown')).toBeTruthy()
  })
})

// ─── Provenance Store ────────────────────────────────────────────────────────

describe('useProvenanceStore', () => {
  it('has correct initial state', () => {
    const state = useProvenanceStore.getState()
    expect(state.attributions).toEqual([])
    expect(state.expandedEventIds.size).toBe(0)
    expect(state.diffs.size).toBe(0)
    expect(state.showAttributions).toBe(false)
    expect(state.hoveredParagraph).toBe(-1)
  })

  it('setAttributions replaces the list', () => {
    const attrs: ParagraphAttribution[] = [
      { index: 0, preview: 'Hello world', source: 'human', aiPercent: 0, lastEditAt: '2026-01-01' },
      { index: 1, preview: 'AI generated text', source: 'ai', aiPercent: 100, lastEditAt: '2026-01-01', model: 'claude' },
    ]
    useProvenanceStore.getState().setAttributions(attrs)
    expect(useProvenanceStore.getState().attributions).toHaveLength(2)
    expect(useProvenanceStore.getState().attributions[1]!.source).toBe('ai')
  })

  it('toggleEvent adds and removes event IDs', () => {
    const store = useProvenanceStore.getState()
    store.toggleEvent('evt-1')
    expect(useProvenanceStore.getState().expandedEventIds.has('evt-1')).toBe(true)

    store.toggleEvent('evt-1')
    expect(useProvenanceStore.getState().expandedEventIds.has('evt-1')).toBe(false)
  })

  it('expandEvent and collapseEvent work correctly', () => {
    const store = useProvenanceStore.getState()
    store.expandEvent('evt-a')
    store.expandEvent('evt-b')
    expect(useProvenanceStore.getState().expandedEventIds.size).toBe(2)

    store.collapseEvent('evt-a')
    expect(useProvenanceStore.getState().expandedEventIds.has('evt-a')).toBe(false)
    expect(useProvenanceStore.getState().expandedEventIds.has('evt-b')).toBe(true)
  })

  it('collapseAll clears all expanded events', () => {
    const store = useProvenanceStore.getState()
    store.expandEvent('evt-1')
    store.expandEvent('evt-2')
    store.expandEvent('evt-3')

    store.collapseAll()
    expect(useProvenanceStore.getState().expandedEventIds.size).toBe(0)
  })

  it('setDiff stores a diff entry', () => {
    const diff: TextDiffEntry = {
      id: 'diff-1',
      eventId: 'evt-1',
      timestamp: '2026-01-01T00:00:00Z',
      label: 'Edit paragraph',
      segments: [
        { type: 'unchanged', text: 'Hello ' },
        { type: 'removed', text: 'world' },
        { type: 'added', text: 'there' },
      ],
      beforeText: 'Hello world',
      afterText: 'Hello there',
    }
    useProvenanceStore.getState().setDiff('evt-1', diff)
    const stored = useProvenanceStore.getState().diffs.get('evt-1')
    expect(stored).toBeDefined()
    expect(stored!.segments).toHaveLength(3)
  })

  it('setShowAttributions and setHoveredParagraph', () => {
    const store = useProvenanceStore.getState()
    store.setShowAttributions(true)
    expect(useProvenanceStore.getState().showAttributions).toBe(true)

    store.setHoveredParagraph(3)
    expect(useProvenanceStore.getState().hoveredParagraph).toBe(3)
  })

  it('reset clears all state', () => {
    const store = useProvenanceStore.getState()
    store.setShowAttributions(true)
    store.setHoveredParagraph(5)
    store.expandEvent('evt-1')
    store.setAttributions([{ index: 0, preview: 'test', source: 'ai', aiPercent: 100, lastEditAt: '2026-01-01' }])

    store.reset()
    const state = useProvenanceStore.getState()
    expect(state.attributions).toEqual([])
    expect(state.expandedEventIds.size).toBe(0)
    expect(state.showAttributions).toBe(false)
    expect(state.hoveredParagraph).toBe(-1)
  })
})
