import { describe, it, expect, beforeEach } from 'vitest'
import {
  useFollowNotesStore,
  createClip,
  getProcessedClips,
  SOURCE_TYPE_CONFIG,
  type EvidenceClip,
  type ClipSourceType,
} from '@/stores/follow-notes-store'

// Reset store between tests
beforeEach(() => {
  useFollowNotesStore.getState().reset()
})

// ─── createClip helper ──────────────────────────────────────────────────────

describe('createClip', () => {
  it('generates unique IDs and timestamps', () => {
    const a = createClip({
      quote: 'Quote A',
      sourceType: 'document',
      sourceLabel: 'Doc',
      interpretation: '',
    })
    const b = createClip({
      quote: 'Quote B',
      sourceType: 'web',
      sourceLabel: 'Web',
      interpretation: '',
    })
    expect(a.id).toBeTruthy()
    expect(b.id).toBeTruthy()
    expect(a.id).not.toBe(b.id)
    expect(a.createdAt).toBeTruthy()
    expect(a.isPinned).toBe(false)
    expect(a.tags).toEqual([])
  })

  it('respects optional overrides', () => {
    const clip = createClip({
      quote: 'Test',
      sourceType: 'chat',
      sourceLabel: 'Chat',
      interpretation: 'My note',
      tags: ['important'],
      isPinned: true,
    })
    expect(clip.isPinned).toBe(true)
    expect(clip.tags).toEqual(['important'])
    expect(clip.interpretation).toBe('My note')
  })
})

// ─── SOURCE_TYPE_CONFIG ─────────────────────────────────────────────────────

describe('SOURCE_TYPE_CONFIG', () => {
  it('has config for all 7 source types', () => {
    const types: ClipSourceType[] = [
      'document',
      'web',
      'chat',
      'canvas',
      'extension',
      'import',
      'manual',
    ]
    types.forEach((type) => {
      expect(SOURCE_TYPE_CONFIG[type]).toBeDefined()
      expect(SOURCE_TYPE_CONFIG[type].icon).toBeTruthy()
      expect(SOURCE_TYPE_CONFIG[type].label).toBeTruthy()
      expect(SOURCE_TYPE_CONFIG[type].color).toBeTruthy()
    })
  })

  it('has distinct colors for each type', () => {
    const colors = Object.values(SOURCE_TYPE_CONFIG).map((c) => c.color)
    const uniqueColors = new Set(colors)
    expect(uniqueColors.size).toBe(7)
  })
})

// ─── useFollowNotesStore ────────────────────────────────────────────────────

describe('useFollowNotesStore', () => {
  it('has correct initial state', () => {
    const state = useFollowNotesStore.getState()
    expect(state.clips).toEqual([])
    expect(state.activeClipId).toBeNull()
    expect(state.isPanelOpen).toBe(false)
    expect(state.sortMode).toBe('newest')
    expect(state.filterSource).toBe('all')
    expect(state.searchQuery).toBe('')
  })

  it('addClip prepends to list', () => {
    const store = useFollowNotesStore.getState()
    const clip1 = createClip({
      quote: 'First',
      sourceType: 'document',
      sourceLabel: 'Doc',
      interpretation: '',
    })
    const clip2 = createClip({
      quote: 'Second',
      sourceType: 'web',
      sourceLabel: 'Web',
      interpretation: '',
    })
    store.addClip(clip1)
    store.addClip(clip2)
    const clips = useFollowNotesStore.getState().clips
    expect(clips).toHaveLength(2)
    expect(clips[0]!.quote).toBe('Second') // prepended
    expect(clips[1]!.quote).toBe('First')
  })

  it('removeClip removes and clears activeClipId if matching', () => {
    const store = useFollowNotesStore.getState()
    const clip = createClip({
      quote: 'Test',
      sourceType: 'manual',
      sourceLabel: 'Manual',
      interpretation: '',
    })
    store.addClip(clip)
    store.setActiveClip(clip.id)
    expect(useFollowNotesStore.getState().activeClipId).toBe(clip.id)

    store.removeClip(clip.id)
    expect(useFollowNotesStore.getState().clips).toHaveLength(0)
    expect(useFollowNotesStore.getState().activeClipId).toBeNull()
  })

  it('togglePin flips isPinned', () => {
    const store = useFollowNotesStore.getState()
    const clip = createClip({
      quote: 'Test',
      sourceType: 'document',
      sourceLabel: 'Doc',
      interpretation: '',
    })
    store.addClip(clip)
    expect(useFollowNotesStore.getState().clips[0]!.isPinned).toBe(false)

    store.togglePin(clip.id)
    expect(useFollowNotesStore.getState().clips[0]!.isPinned).toBe(true)

    store.togglePin(clip.id)
    expect(useFollowNotesStore.getState().clips[0]!.isPinned).toBe(false)
  })

  it('addTag and removeTag manage tags', () => {
    const store = useFollowNotesStore.getState()
    const clip = createClip({
      quote: 'Test',
      sourceType: 'document',
      sourceLabel: 'Doc',
      interpretation: '',
    })
    store.addClip(clip)

    store.addTag(clip.id, 'research')
    store.addTag(clip.id, 'important')
    expect(useFollowNotesStore.getState().clips[0]!.tags).toEqual(['research', 'important'])

    // Duplicate tag should not be added
    store.addTag(clip.id, 'research')
    expect(useFollowNotesStore.getState().clips[0]!.tags).toEqual(['research', 'important'])

    store.removeTag(clip.id, 'research')
    expect(useFollowNotesStore.getState().clips[0]!.tags).toEqual(['important'])
  })

  it('setInterpretation updates clip interpretation', () => {
    const store = useFollowNotesStore.getState()
    const clip = createClip({
      quote: 'Test',
      sourceType: 'document',
      sourceLabel: 'Doc',
      interpretation: '',
    })
    store.addClip(clip)

    store.setInterpretation(clip.id, 'This is my analysis')
    expect(useFollowNotesStore.getState().clips[0]!.interpretation).toBe('This is my analysis')
  })

  it('panel open/close/toggle works correctly', () => {
    const store = useFollowNotesStore.getState()
    expect(useFollowNotesStore.getState().isPanelOpen).toBe(false)

    store.openPanel()
    expect(useFollowNotesStore.getState().isPanelOpen).toBe(true)

    store.closePanel()
    expect(useFollowNotesStore.getState().isPanelOpen).toBe(false)

    store.togglePanel()
    expect(useFollowNotesStore.getState().isPanelOpen).toBe(true)

    store.togglePanel()
    expect(useFollowNotesStore.getState().isPanelOpen).toBe(false)
  })

  it('reset clears all state', () => {
    const store = useFollowNotesStore.getState()
    const clip = createClip({
      quote: 'Test',
      sourceType: 'document',
      sourceLabel: 'Doc',
      interpretation: 'Note',
    })
    store.addClip(clip)
    store.openPanel()
    store.setActiveClip(clip.id)
    store.setSortMode('pinned')
    store.setFilterSource('web')
    store.setSearchQuery('hello')

    store.reset()
    const state = useFollowNotesStore.getState()
    expect(state.clips).toEqual([])
    expect(state.activeClipId).toBeNull()
    expect(state.isPanelOpen).toBe(false)
    expect(state.sortMode).toBe('newest')
    expect(state.filterSource).toBe('all')
    expect(state.searchQuery).toBe('')
  })
})

// ─── getProcessedClips ──────────────────────────────────────────────────────

describe('getProcessedClips', () => {
  const makeClips = (): EvidenceClip[] => [
    {
      id: '1',
      quote: 'Alpha doc',
      sourceType: 'document',
      sourceLabel: 'Doc A',
      interpretation: 'Note A',
      tags: ['research'],
      createdAt: '2026-01-01T00:00:00Z',
      isPinned: true,
      notebookId: null,
      pinnedToChatId: null,
    },
    {
      id: '2',
      quote: 'Beta web',
      sourceType: 'web',
      sourceLabel: 'Web B',
      interpretation: '',
      tags: [],
      createdAt: '2026-01-02T00:00:00Z',
      isPinned: false,
      notebookId: null,
      pinnedToChatId: null,
    },
    {
      id: '3',
      quote: 'Gamma chat',
      sourceType: 'chat',
      sourceLabel: 'Chat C',
      interpretation: 'Important',
      tags: ['important'],
      createdAt: '2026-01-03T00:00:00Z',
      isPinned: false,
      notebookId: null,
      pinnedToChatId: null,
    },
  ]

  it('filters by source type', () => {
    const result = getProcessedClips(makeClips(), 'web', 'newest', '')
    expect(result).toHaveLength(1)
    expect(result[0]!.sourceType).toBe('web')
  })

  it('returns all clips with "all" filter', () => {
    const result = getProcessedClips(makeClips(), 'all', 'newest', '')
    expect(result).toHaveLength(3)
  })

  it('filters by search query across quote, interpretation, sourceLabel, tags', () => {
    const clips = makeClips()
    expect(getProcessedClips(clips, 'all', 'newest', 'Alpha')).toHaveLength(1)
    expect(getProcessedClips(clips, 'all', 'newest', 'Important')).toHaveLength(1)
    expect(getProcessedClips(clips, 'all', 'newest', 'Chat C')).toHaveLength(1)
    expect(getProcessedClips(clips, 'all', 'newest', 'research')).toHaveLength(1)
    expect(getProcessedClips(clips, 'all', 'newest', 'nonexistent')).toHaveLength(0)
  })

  it('sorts by pinned (pinned first, then by newest)', () => {
    const result = getProcessedClips(makeClips(), 'all', 'pinned', '')
    expect(result[0]!.id).toBe('1') // pinned
    expect(result[1]!.id).toBe('3') // newest non-pinned
    expect(result[2]!.id).toBe('2') // oldest non-pinned
  })
})
