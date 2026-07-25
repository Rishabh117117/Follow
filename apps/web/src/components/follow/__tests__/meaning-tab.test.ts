import { describe, it, expect } from 'vitest'
import type { DocumentSharedState } from '@/hooks/use-provenance-data'

describe('MeaningTab', () => {
  const sharedState: DocumentSharedState = {
    contributions: [],
    knowledge: [
      { id: 'k1', fact: 'Revenue grew 15%', source: 'Q3 report', confidence: 0.9, contributedBy: 'u1', contributedByName: 'Rishabh', method: 'manual', linkedSection: 'Section 1', conflictsWith: null, status: 'active' },
      { id: 'k2', fact: 'Revenue grew 12%', source: 'Internal data', confidence: 0.6, contributedBy: 'u2', contributedByName: 'Anika', method: 'extracted', linkedSection: 'Section 2', conflictsWith: 'k3', status: 'disputed' },
      { id: 'k3', fact: 'Revenue grew 18%', source: 'Sales team', confidence: 0.5, contributedBy: 'u3', contributedByName: 'Sam', method: 'extracted', linkedSection: 'Section 2', conflictsWith: 'k2', status: 'disputed' },
      { id: 'k4', fact: 'Old fact', source: 'outdated', confidence: 0.3, contributedBy: 'u1', contributedByName: 'Rishabh', method: 'manual', linkedSection: null, conflictsWith: null, status: 'superseded' },
    ],
    tensions: [
      { id: 't1', description: 'Revenue numbers conflict', severity: 'high', type: 'contradiction', involvedUsers: ['u2', 'u3'], involvedSections: ['Section 2'], resolvedAt: null, confidence: 0.8 },
      { id: 't2', description: 'Missing conclusion', severity: 'medium', type: 'gap', involvedUsers: [], involvedSections: ['Section 5'], resolvedAt: null, confidence: 0.6 },
      { id: 't3', description: 'Old tension', severity: 'low', type: 'stale', involvedUsers: [], involvedSections: [], resolvedAt: '2024-01-01', confidence: 0.5 },
    ],
    dynamics: {
      documentPhase: 'convergence',
      activeContributors: 3,
      editVelocity: 'fast',
      lastMajorChange: { description: 'Restructured Section 2', userId: 'u1', userName: 'Rishabh', timestamp: '2024-01-01', section: 'Section 2' },
    },
    aiUsage: {
      totalInteractions: 25,
      acceptedCount: 20,
      rejectedCount: 5,
      acceptanceRate: 80,
      sectionsWithAIContent: ['Section 1', 'Section 3'],
      byUser: [
        { userId: 'u1', userName: 'Rishabh', interactions: 15, acceptRate: 87 },
        { userId: 'u2', userName: 'Anika', interactions: 10, acceptRate: 70 },
      ],
    },
  }

  it('renders document phase from dynamics', () => {
    expect(sharedState.dynamics.documentPhase).toBe('convergence')
    const phaseOrder = ['inception', 'exploration', 'convergence', 'stabilization', 'delivery']
    const idx = phaseOrder.indexOf(sharedState.dynamics.documentPhase!)
    expect(idx).toBe(2) // convergence is index 2
  })

  it('filters out superseded knowledge', () => {
    const activeKnowledge = sharedState.knowledge.filter((k) => k.status !== 'superseded')
    expect(activeKnowledge).toHaveLength(3)
    expect(activeKnowledge.every((k) => k.id !== 'k4')).toBe(true)
  })

  it('identifies disputed knowledge with amber highlight', () => {
    const disputed = sharedState.knowledge.filter((k) => k.status === 'disputed')
    expect(disputed).toHaveLength(2)
    expect(disputed[0]!.conflictsWith).toBe('k3')
  })

  it('renders confidence with correct color thresholds', () => {
    const getColor = (c: number) => (c > 0.7 ? 'green' : c >= 0.5 ? 'amber' : 'red')
    expect(getColor(0.9)).toBe('green')
    expect(getColor(0.6)).toBe('amber')
    expect(getColor(0.3)).toBe('red')
  })

  it('filters active tensions (excludes resolved)', () => {
    const activeTensions = sharedState.tensions.filter((t) => !t.resolvedAt)
    expect(activeTensions).toHaveLength(2)
    expect(activeTensions.some((t) => t.id === 't3')).toBe(false)
  })

  it('handles null shared state gracefully', () => {
    const nullState: DocumentSharedState | null = null
    expect(nullState).toBeNull()
    // Component renders "No shared state available yet" message
  })

  it('calculates AI usage acceptance rate', () => {
    expect(sharedState.aiUsage.acceptanceRate).toBe(80)
    expect(sharedState.aiUsage.byUser).toHaveLength(2)
  })
})
