import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DocumentSharedState } from '@workspace/shared/types'

vi.mock('../state-manager', () => ({
  getOrCreateSharedState: vi.fn(async () => ({ state: mockSharedState(), version: 1 })),
  updateStateSession: vi.fn(async () => true),
}))

vi.mock('../../../ws', () => ({
  broadcast: vi.fn(),
}))

vi.mock('../../../db', () => ({
  db: {
    selectDistinct: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve([{ userId: 'user-2' }]) }) }) }) }),
  },
}))

vi.mock('../../../db/schema/threads', () => ({
  strandCollaborators: { strandId: 'strand_id', userId: 'user_id' },
  strands: { id: 'id', workspaceId: 'workspace_id' },
}))

import { buildSharedStateSummary, scheduleSharedStatePush } from '../shared-state-propagator'

function mockSharedState(): DocumentSharedState {
  return {
    contributions: [
      { userId: 'user-1', userName: 'Alice', sections: [], totalEvents: 5, lastActiveAt: new Date().toISOString(), role: 'heavy_editor' },
    ],
    knowledge: [
      { id: 'k-1', fact: 'Budget is $50k', source: 'doc', confidence: 0.8, contributedBy: 'user-1', contributedByName: 'Alice', sharedAt: new Date().toISOString(), method: 'intentional', linkedSection: 'Budget', conflictsWith: null, status: 'active' },
    ],
    tensions: [
      { id: 't-1', description: 'Budget conflict', severity: 'high', type: 'contradiction', involvedUsers: ['user-1', 'user-2'], involvedSections: ['Budget'], detectedAt: new Date().toISOString(), resolvedAt: null, resolution: null, confidence: 0.8 },
    ],
    dynamics: {
      documentPhase: null, activeContributors: 2, editVelocity: 'steady',
      lastMajorChange: { description: 'Rewrote conclusions', userId: 'user-1', userName: 'Alice', timestamp: new Date().toISOString(), section: 'Conclusions' },
      openQuestions: [],
    },
    aiUsage: { totalInteractions: 3, acceptedCount: 2, rejectedCount: 1, acceptanceRate: 0.67, sectionsWithAIContent: ['Introduction'], byUser: [] },
  }
}

describe('buildSharedStateSummary', () => {
  it('includes recent intentional knowledge', () => {
    const summary = buildSharedStateSummary(mockSharedState())
    const knowledgeItems = summary.filter(s => s.memory.startsWith('Shared finding:'))
    expect(knowledgeItems.length).toBeGreaterThanOrEqual(1)
  })

  it('includes high-severity tensions', () => {
    const summary = buildSharedStateSummary(mockSharedState())
    const tensionItems = summary.filter(s => s.memory.startsWith('Tension detected:'))
    expect(tensionItems.length).toBeGreaterThanOrEqual(1)
  })

  it('includes last major change', () => {
    const summary = buildSharedStateSummary(mockSharedState())
    const changeItems = summary.filter(s => s.memory.startsWith('Key change:'))
    expect(changeItems.length).toBe(1)
    expect(changeItems[0]?.memory).toContain('Rewrote conclusions')
  })

  it('returns empty for empty state', () => {
    const empty: DocumentSharedState = {
      contributions: [], knowledge: [], tensions: [],
      dynamics: { documentPhase: null, activeContributors: 0, editVelocity: 'steady', lastMajorChange: null, openQuestions: [] },
      aiUsage: { totalInteractions: 0, acceptedCount: 0, rejectedCount: 0, acceptanceRate: 0, sectionsWithAIContent: [], byUser: [] },
    }
    const summary = buildSharedStateSummary(empty)
    expect(summary).toHaveLength(0)
  })

  it('does not include resolved tensions', () => {
    const state = mockSharedState()
    state.tensions[0]!.resolvedAt = new Date().toISOString()
    const summary = buildSharedStateSummary(state)
    const tensionItems = summary.filter(s => s.memory.startsWith('Tension detected:'))
    expect(tensionItems).toHaveLength(0)
  })
})

describe('scheduleSharedStatePush', () => {
  it('is callable without error', () => {
    // Just verify it doesn't throw — debounced, no immediate effect
    expect(() => scheduleSharedStatePush('doc-1', 'ws-1', false)).not.toThrow()
  })

  it('accepts critical flag', () => {
    expect(() => scheduleSharedStatePush('doc-1', 'ws-1', true)).not.toThrow()
  })
})
