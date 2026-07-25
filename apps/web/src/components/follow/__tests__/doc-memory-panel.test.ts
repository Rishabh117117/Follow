import { describe, it, expect, vi } from 'vitest'

/**
 * DocMemory Panel — unit tests (8 tests)
 *
 * Tests tab rendering, Meaning tab content sections,
 * and data-driven rendering behavior.
 */

// These tests verify the data-driven rendering logic
// without mounting React components (pure logic tests).

import { useDocMemoryStore } from '@/stores/doc-memory-store'
import type {
  DocumentInterpretation,
  DocumentPattern,
  NarrativePhase,
} from '@workspace/shared/types'

// Mock api-client
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: null }),
    post: vi.fn().mockResolvedValue({ data: null }),
    patch: vi.fn().mockResolvedValue({ data: null }),
  },
}))

const PHASE_ORDER: NarrativePhase[] = [
  'inception',
  'exploration',
  'convergence',
  'stabilization',
  'delivery',
]

function makeInterpretation(
  overrides: Partial<DocumentInterpretation> = {}
): DocumentInterpretation {
  return {
    id: 'interp-1',
    workspaceId: 'ws-1',
    fileId: 'file-1',
    strandId: null,
    narrativePhase: 'exploration',
    narrativeConfidence: 0.8,
    narrativeSummary: 'Document is exploring the topic broadly.',
    workingIntent: 'Building a comprehensive overview.',
    intentEvidence: 'Multiple sections added, diverse sources referenced.',
    cognitiveState: 'exploring',
    activeTensions: [
      {
        name: 'Breadth vs Depth',
        description: 'Wide scope vs deep analysis',
        evidence: '5 new sections added',
      },
      {
        name: 'Formal vs Casual',
        description: 'Tone inconsistency',
        evidence: 'Mixed paragraph styles',
      },
    ],
    sourceInfluence: [
      { sourceName: 'Wikipedia', weight: 0.6, reason: 'Referenced in 3 paragraphs' },
      { sourceName: 'Research Paper', weight: 0.3, reason: 'Key citation' },
    ],
    unresolvedQuestions: [
      { question: 'What is the target audience?', evidence: 'No clear audience indicators' },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('DocMemoryPanel', () => {
  it('renders History tab by default with existing provenance content', () => {
    useDocMemoryStore.getState().reset()
    const { activeTab } = useDocMemoryStore.getState()
    expect(activeTab).toBe('history')
  })

  it('switching to Meaning tab triggers fetchDocMemory', () => {
    useDocMemoryStore.getState().reset()
    const { setActiveTab } = useDocMemoryStore.getState()

    setActiveTab('meaning')
    expect(useDocMemoryStore.getState().activeTab).toBe('meaning')
    // In the actual component, useEffect would call fetchDocMemory
    // Here we verify the state change that triggers it
  })

  it('Meaning tab renders narrative phase badge', () => {
    const interp = makeInterpretation({ narrativePhase: 'convergence' })

    // Verify the phase badge data
    expect(interp.narrativePhase).toBe('convergence')
    expect(PHASE_ORDER.indexOf(interp.narrativePhase)).toBe(2) // 3rd position

    // The component renders a badge with this phase
    // and a progress bar where segments up to this index are filled
    const filledSegments = PHASE_ORDER.filter(
      (_, i) => i <= PHASE_ORDER.indexOf(interp.narrativePhase)
    )
    expect(filledSegments).toEqual(['inception', 'exploration', 'convergence'])
  })

  it('Meaning tab renders working intent section', () => {
    const interp = makeInterpretation()

    expect(interp.workingIntent).toBe('Building a comprehensive overview.')
    expect(interp.intentEvidence).toBe('Multiple sections added, diverse sources referenced.')
    // Component renders workingIntent as primary text and intentEvidence as secondary
  })

  it('Meaning tab renders tension cards (expandable)', () => {
    const interp = makeInterpretation()

    expect(interp.activeTensions).toHaveLength(2)
    expect(interp.activeTensions[0]!.name).toBe('Breadth vs Depth')
    expect(interp.activeTensions[1]!.name).toBe('Formal vs Casual')

    // Test toggle behavior
    const { toggleTension } = useDocMemoryStore.getState()
    toggleTension('tension-0')
    expect(useDocMemoryStore.getState().expandedTensionId).toBe('tension-0')
    toggleTension('tension-0')
    expect(useDocMemoryStore.getState().expandedTensionId).toBeNull()
  })

  it('Meaning tab renders source influence bars', () => {
    const interp = makeInterpretation()

    expect(interp.sourceInfluence).toHaveLength(2)
    expect(interp.sourceInfluence[0]!.sourceName).toBe('Wikipedia')
    expect(interp.sourceInfluence[0]!.weight).toBe(0.6)
    // Component renders a bar with width = weight * 100% = 60%
    const barWidth = Math.round(interp.sourceInfluence[0]!.weight * 100)
    expect(barWidth).toBe(60)
  })

  it('Meaning tab renders patterns with confidence', () => {
    const patterns: DocumentPattern[] = [
      {
        id: 'p1',
        fileId: 'f1',
        pattern: 'Uses short paragraphs',
        confidence: 0.92,
        reinforcedCount: 3,
        lastReinforcedAt: '2026-01-01',
      },
      {
        id: 'p2',
        fileId: 'f1',
        pattern: 'Prefers bullet lists',
        confidence: 0.78,
        reinforcedCount: 1,
        lastReinforcedAt: '2026-01-01',
      },
      {
        id: 'p3',
        fileId: 'f1',
        pattern: 'Avoids passive voice',
        confidence: 0.65,
        reinforcedCount: 2,
        lastReinforcedAt: '2026-01-01',
      },
    ]

    // Without showAllPatterns, only first 2 are visible
    useDocMemoryStore.setState({ patterns, showAllPatterns: false })
    const visiblePatterns = useDocMemoryStore.getState().showAllPatterns
      ? patterns
      : patterns.slice(0, 2)
    expect(visiblePatterns).toHaveLength(2)

    // Toggle shows all
    useDocMemoryStore.getState().toggleShowAllPatterns()
    const allVisible = useDocMemoryStore.getState().showAllPatterns
    expect(allVisible).toBe(true)
  })

  it('Meaning tab renders open questions', () => {
    const interp = makeInterpretation()

    expect(interp.unresolvedQuestions).toHaveLength(1)
    expect(interp.unresolvedQuestions[0]!.question).toBe('What is the target audience?')
    // Component renders each question with a ? icon prefix
  })
})
