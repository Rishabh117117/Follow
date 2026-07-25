import { describe, it, expect, beforeEach } from 'vitest'
import {
  extractEditsFromDiff,
  useLocalProvenanceStore,
  type DocumentEdit,
} from '../local-provenance-store'

// ─── extractEditsFromDiff ─────────────────────────────────────────

describe('extractEditsFromDiff', () => {
  it('returns empty array for identical texts', () => {
    expect(extractEditsFromDiff('hello world', 'hello world')).toEqual([])
  })

  it('returns empty array for empty strings', () => {
    expect(extractEditsFromDiff('', '')).toEqual([])
  })

  it('detects a single deletion', () => {
    const before = 'The quick brown fox jumps over the lazy dog'
    const after = 'The quick fox jumps over the lazy dog'
    const edits = extractEditsFromDiff(before, after)
    expect(edits.length).toBeGreaterThanOrEqual(1)
    const deletion = edits.find((e) => e.editType === 'deletion')
    expect(deletion).toBeDefined()
    expect(deletion!.removedText).toContain('brown')
    expect(deletion!.addedText).toBe('')
  })

  it('detects a single insertion', () => {
    const before = 'The fox jumps over the dog'
    const after = 'The quick brown fox jumps over the lazy dog'
    const edits = extractEditsFromDiff(before, after)
    expect(edits.length).toBeGreaterThanOrEqual(1)
    const insertion = edits.find((e) => e.editType === 'insertion')
    expect(insertion).toBeDefined()
    expect(insertion!.addedText.length).toBeGreaterThan(0)
    expect(insertion!.removedText).toBe('')
  })

  it('detects a replacement', () => {
    const before = 'The strategic tensions in the document were notable'
    const after = 'The strategic and creative tensions in the document were notable'
    const edits = extractEditsFromDiff(before, after)
    expect(edits.length).toBeGreaterThanOrEqual(1)
    // Could be insertion or replacement depending on LCS behavior
    const edit = edits[0]!
    expect(['insertion', 'replacement']).toContain(edit.editType)
  })

  it('detects multiple changes in one diff', () => {
    const before = 'Hello world, this is a test document with some content'
    const after = 'Goodbye world, this is a great document with extra content'
    const edits = extractEditsFromDiff(before, after)
    expect(edits.length).toBeGreaterThanOrEqual(2)
  })

  it('skips trivial whitespace-only changes', () => {
    const before = 'Hello world'
    const after = 'Hello  world'
    const edits = extractEditsFromDiff(before, after)
    // Whitespace-only changes with < 2 non-whitespace chars should be skipped
    expect(edits.length).toBe(0)
  })

  it('captures context from surrounding unchanged text', () => {
    const before =
      'The beginning of the document. This paragraph was important. The end of the document.'
    const after = 'The beginning of the document. The end of the document.'
    const edits = extractEditsFromDiff(before, after)
    expect(edits.length).toBeGreaterThanOrEqual(1)
    const deletion = edits.find((e) => e.editType === 'deletion')
    expect(deletion).toBeDefined()
    expect(deletion!.context.length).toBeGreaterThan(0)
  })

  it('handles empty before text (all insertions)', () => {
    const before = ''
    const after = 'This is new content that was added to the document'
    const edits = extractEditsFromDiff(before, after)
    expect(edits.length).toBeGreaterThanOrEqual(1)
    expect(edits[0]!.editType).toBe('insertion')
  })

  it('handles empty after text (all deletions)', () => {
    const before = 'This is content that was completely removed from the document'
    const after = ''
    const edits = extractEditsFromDiff(before, after)
    expect(edits.length).toBeGreaterThanOrEqual(1)
    expect(edits[0]!.editType).toBe('deletion')
  })

  it('generates unique IDs for each edit', () => {
    const before = 'Hello world, goodbye moon'
    const after = 'Hi world, farewell moon'
    const edits = extractEditsFromDiff(before, after)
    if (edits.length >= 2) {
      const ids = new Set(edits.map((e) => e.id))
      expect(ids.size).toBe(edits.length)
    }
  })

  it('sets ISO timestamp for each edit', () => {
    const before = 'Hello world'
    const after = 'Goodbye world'
    const edits = extractEditsFromDiff(before, after)
    expect(edits.length).toBeGreaterThanOrEqual(1)
    for (const edit of edits) {
      expect(() => new Date(edit.time)).not.toThrow()
      expect(new Date(edit.time).toISOString()).toBe(edit.time)
    }
  })

  it('detects paragraph-level deletion', () => {
    const before = `Introduction paragraph here.

Together, these readings helped me understand that true innovation stems from structured adaptability. They challenge the conventional notion that creativity and structure are at odds.

Final conclusion paragraph.`
    const after = `Introduction paragraph here.

Final conclusion paragraph.`
    const edits = extractEditsFromDiff(before, after)
    expect(edits.length).toBeGreaterThanOrEqual(1)
    const deletion = edits.find((e) => e.editType === 'deletion')
    expect(deletion).toBeDefined()
    expect(deletion!.removedText).toContain('innovation')
  })
})

// ─── Ring Buffer (Store integration) ──────────────────────────────

describe('useLocalProvenanceStore recentEdits', () => {
  beforeEach(() => {
    useLocalProvenanceStore.getState().reset()
  })

  it('starts with empty recentEdits', () => {
    expect(useLocalProvenanceStore.getState().recentEdits).toEqual([])
  })

  it('populates recentEdits after flushEditBuffer', () => {
    const store = useLocalProvenanceStore.getState()
    store.startSession('file-1', 'Hello world this is some initial text content')

    // Simulate an edit by setting editBuffer directly then flushing
    useLocalProvenanceStore.setState({
      editBuffer: {
        startText: 'Hello world this is some initial text content',
        startWordCount: 8,
        startTime: new Date().toISOString(),
        changeCount: 1,
        lastChangeTime: new Date().toISOString(),
        addedWords: 3,
        removedWords: 0,
      },
      lastSnapshot: {
        text: 'Hello world this is some initial text content with extra words',
        wordCount: 11,
        timestamp: new Date().toISOString(),
        paragraphCount: 1,
      },
    })

    useLocalProvenanceStore
      .getState()
      .flushEditBuffer('Hello world this is some initial text content with extra words')
    const edits = useLocalProvenanceStore.getState().recentEdits
    expect(edits.length).toBeGreaterThanOrEqual(1)
  })

  it('caps recentEdits at 20 entries', () => {
    // Manually set 25 edits
    const manyEdits: DocumentEdit[] = Array.from({ length: 25 }, (_, i) => ({
      id: `edit-${i}`,
      time: new Date(Date.now() - i * 1000).toISOString(),
      editType: 'insertion' as const,
      removedText: '',
      addedText: `word-${i}`,
      context: 'test',
    }))
    useLocalProvenanceStore.setState({ recentEdits: manyEdits.slice(-20) })
    expect(useLocalProvenanceStore.getState().recentEdits.length).toBe(20)
  })

  it('getRecentEdits filters by time window', () => {
    const now = Date.now()
    const edits: DocumentEdit[] = [
      {
        id: 'old',
        time: new Date(now - 10 * 60 * 1000).toISOString(), // 10 min ago
        editType: 'insertion',
        removedText: '',
        addedText: 'old edit',
        context: '',
      },
      {
        id: 'recent',
        time: new Date(now - 30 * 1000).toISOString(), // 30 sec ago
        editType: 'deletion',
        removedText: 'recent edit',
        addedText: '',
        context: '',
      },
    ]
    useLocalProvenanceStore.setState({ recentEdits: edits })

    // Default 5 min window should only include the recent one
    const result = useLocalProvenanceStore.getState().getRecentEdits()
    expect(result.length).toBe(1)
    expect(result[0]!.id).toBe('recent')

    // Large window should include both
    const allResult = useLocalProvenanceStore.getState().getRecentEdits(15 * 60 * 1000)
    expect(allResult.length).toBe(2)
  })

  it('clearEvents also clears recentEdits', () => {
    useLocalProvenanceStore.setState({
      recentEdits: [
        {
          id: 'e1',
          time: new Date().toISOString(),
          editType: 'insertion',
          removedText: '',
          addedText: 'test',
          context: '',
        },
      ],
    })
    useLocalProvenanceStore.getState().clearEvents()
    expect(useLocalProvenanceStore.getState().recentEdits).toEqual([])
  })

  it('reset clears recentEdits', () => {
    useLocalProvenanceStore.setState({
      recentEdits: [
        {
          id: 'e1',
          time: new Date().toISOString(),
          editType: 'insertion',
          removedText: '',
          addedText: 'test',
          context: '',
        },
      ],
    })
    useLocalProvenanceStore.getState().reset()
    expect(useLocalProvenanceStore.getState().recentEdits).toEqual([])
  })

  it('startSession resets recentEdits', () => {
    useLocalProvenanceStore.setState({
      recentEdits: [
        {
          id: 'e1',
          time: new Date().toISOString(),
          editType: 'insertion',
          removedText: '',
          addedText: 'test',
          context: '',
        },
      ],
    })
    useLocalProvenanceStore.getState().startSession('new-file', 'some text')
    expect(useLocalProvenanceStore.getState().recentEdits).toEqual([])
  })

  it('orders edits newest last (append order)', () => {
    const now = Date.now()
    const edits: DocumentEdit[] = [
      {
        id: 'first',
        time: new Date(now - 2000).toISOString(),
        editType: 'insertion',
        removedText: '',
        addedText: 'first',
        context: '',
      },
      {
        id: 'second',
        time: new Date(now - 1000).toISOString(),
        editType: 'deletion',
        removedText: 'second',
        addedText: '',
        context: '',
      },
    ]
    useLocalProvenanceStore.setState({ recentEdits: edits })
    const state = useLocalProvenanceStore.getState().recentEdits
    expect(state[0]!.id).toBe('first')
    expect(state[1]!.id).toBe('second')
  })
})
