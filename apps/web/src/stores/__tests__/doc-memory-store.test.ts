import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDocMemoryStore } from '../doc-memory-store'

/**
 * DocMemoryStore — unit tests (10 tests)
 *
 * Tests initial state, tab switching, data setting,
 * toggle states, fetch actions, and reset.
 */

// Mock api-client
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      data: {
        interpretation: {
          id: 'interp-1',
          workspaceId: 'ws-1',
          fileId: 'file-1',
          strandId: null,
          narrativePhase: 'exploration',
          narrativeConfidence: 0.8,
          narrativeSummary: 'Exploring the topic.',
          workingIntent: 'Building understanding.',
          intentEvidence: 'Multiple edits.',
          cognitiveState: 'exploring',
          activeTensions: [{ name: 'Test', description: 'Desc', evidence: 'Ev' }],
          sourceInfluence: [{ sourceName: 'Wiki', weight: 0.5, reason: 'Referenced' }],
          unresolvedQuestions: [{ question: 'Scope?', evidence: 'Unclear' }],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        patterns: [
          { id: 'pat-1', fileId: 'file-1', pattern: 'Short paragraphs', confidence: 0.9, reinforcedCount: 2, lastReinforcedAt: '2026-01-01T00:00:00Z' },
        ],
        decisionTrails: [],
      },
    }),
    post: vi.fn().mockResolvedValue({
      data: {
        id: 'interp-2',
        narrativePhase: 'convergence',
        narrativeConfidence: 0.85,
        narrativeSummary: 'Converging.',
        workingIntent: 'Finalizing.',
        intentEvidence: 'Fewer edits.',
        cognitiveState: 'synthesizing',
        activeTensions: [],
        sourceInfluence: [],
        unresolvedQuestions: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    }),
    patch: vi.fn().mockResolvedValue({ data: { id: 'pat-1', dismissed: true } }),
  },
}))

describe('DocMemoryStore', () => {
  beforeEach(() => {
    useDocMemoryStore.getState().reset()
  })

  it('initial state: null interpretation, empty arrays, history tab active', () => {
    const state = useDocMemoryStore.getState()
    expect(state.interpretation).toBeNull()
    expect(state.patterns).toEqual([])
    expect(state.decisionTrails).toEqual([])
    expect(state.activeTab).toBe('history')
    expect(state.isLoading).toBe(false)
    expect(state.lastFetchedFileId).toBeNull()
  })

  it('setActiveTab switches between history and meaning', () => {
    const { setActiveTab } = useDocMemoryStore.getState()

    setActiveTab('meaning')
    expect(useDocMemoryStore.getState().activeTab).toBe('meaning')

    setActiveTab('history')
    expect(useDocMemoryStore.getState().activeTab).toBe('history')
  })

  it('setInterpretation stores interpretation data', () => {
    const { setInterpretation } = useDocMemoryStore.getState()
    const interp = {
      id: 'interp-1',
      workspaceId: 'ws-1',
      fileId: 'file-1',
      strandId: null,
      narrativePhase: 'exploration' as const,
      narrativeConfidence: 0.8,
      narrativeSummary: 'Test',
      workingIntent: 'Test',
      intentEvidence: 'Test',
      cognitiveState: 'exploring' as const,
      activeTensions: [],
      sourceInfluence: [],
      unresolvedQuestions: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }

    setInterpretation(interp)
    expect(useDocMemoryStore.getState().interpretation).toEqual(interp)
  })

  it('toggleTension expands and collapses', () => {
    const { toggleTension } = useDocMemoryStore.getState()

    toggleTension('tension-0')
    expect(useDocMemoryStore.getState().expandedTensionId).toBe('tension-0')

    toggleTension('tension-0')
    expect(useDocMemoryStore.getState().expandedTensionId).toBeNull()
  })

  it('toggleShowAllPatterns toggles boolean', () => {
    const { toggleShowAllPatterns } = useDocMemoryStore.getState()

    expect(useDocMemoryStore.getState().showAllPatterns).toBe(false)

    toggleShowAllPatterns()
    expect(useDocMemoryStore.getState().showAllPatterns).toBe(true)

    toggleShowAllPatterns()
    expect(useDocMemoryStore.getState().showAllPatterns).toBe(false)
  })

  it('fetchDocMemory sets loading state', async () => {
    const { fetchDocMemory } = useDocMemoryStore.getState()

    // fetchDocMemory sets isLoading=true then false
    const promise = fetchDocMemory('file-1')
    // After completion, isLoading should be false
    await promise
    expect(useDocMemoryStore.getState().isLoading).toBe(false)
  })

  it('fetchDocMemory stores response data', async () => {
    const { fetchDocMemory } = useDocMemoryStore.getState()

    await fetchDocMemory('file-1')

    const state = useDocMemoryStore.getState()
    expect(state.interpretation).not.toBeNull()
    expect(state.interpretation?.narrativePhase).toBe('exploration')
    expect(state.patterns).toHaveLength(1)
    expect(state.lastFetchedFileId).toBe('file-1')
  })

  it('triggerInterpretation calls POST endpoint', async () => {
    const { triggerInterpretation } = useDocMemoryStore.getState()

    await triggerInterpretation('file-1', 'ws-1')

    const state = useDocMemoryStore.getState()
    expect(state.interpretation).not.toBeNull()
    expect(state.interpretation?.narrativePhase).toBe('convergence')
  })

  it('dismissPattern calls PATCH endpoint', async () => {
    // First populate patterns
    useDocMemoryStore.setState({
      patterns: [
        { id: 'pat-1', fileId: 'file-1', pattern: 'Test', confidence: 0.9, reinforcedCount: 1, lastReinforcedAt: '2026-01-01' },
        { id: 'pat-2', fileId: 'file-1', pattern: 'Test 2', confidence: 0.8, reinforcedCount: 1, lastReinforcedAt: '2026-01-01' },
      ],
    })

    const { dismissPattern } = useDocMemoryStore.getState()
    await dismissPattern('pat-1')

    expect(useDocMemoryStore.getState().patterns).toHaveLength(1)
    expect(useDocMemoryStore.getState().patterns[0]?.id).toBe('pat-2')
  })

  it('reset clears all state', () => {
    // Set some state
    useDocMemoryStore.setState({
      activeTab: 'meaning',
      interpretation: { id: 'x' } as never,
      patterns: [{ id: 'p' } as never],
      showAllPatterns: true,
      isLoading: true,
    })

    useDocMemoryStore.getState().reset()

    const state = useDocMemoryStore.getState()
    expect(state.activeTab).toBe('history')
    expect(state.interpretation).toBeNull()
    expect(state.patterns).toEqual([])
    expect(state.showAllPatterns).toBe(false)
    expect(state.isLoading).toBe(false)
  })
})
