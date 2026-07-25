import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AIStateEvent, AIStateSession, AIStatePersistent } from '@workspace/shared/types'

// Mock the database
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockWhere = vi.fn()
const mockLimit = vi.fn()
const mockSet = vi.fn()
const mockValues = vi.fn()
const mockOnConflictDoNothing = vi.fn()
const mockFrom = vi.fn()

vi.mock('../../../db', () => ({
  db: {
    select: () => ({ from: (table: unknown) => ({ where: (cond: unknown) => ({ limit: mockLimit }) }) }),
    insert: (table: unknown) => ({ values: (vals: unknown) => ({ onConflictDoNothing: mockOnConflictDoNothing }) }),
    update: (table: unknown) => ({ set: (vals: unknown) => ({ where: mockWhere }) }),
  },
}))

vi.mock('../../../db/schema/ai-state', () => ({
  aiState: { userId: 'user_id', workspaceId: 'workspace_id', version: 'version' },
  documentSharedState: { documentId: 'document_id', version: 'version' },
}))

import {
  defaultEventState,
  defaultSessionState,
  defaultPersistentState,
  defaultSharedState,
} from '../state-manager'

// ─── Default state factories ───

describe('defaultEventState', () => {
  it('returns empty arrays', () => {
    const state = defaultEventState()
    expect(state.recentEvents).toEqual([])
    expect(state.activeTensions).toEqual([])
    expect(state.activeKnowledge).toEqual([])
  })
})

describe('defaultSessionState', () => {
  it('returns zeroed session counters', () => {
    const state = defaultSessionState()
    expect(state.currentSession.startedAt).toBeNull()
    expect(state.currentSession.eventCount).toBe(0)
    expect(state.currentSession.sectionsVisited).toEqual([])
    expect(state.currentSession.aiInteractionCount).toBe(0)
    expect(state.currentSession.documentsWorkedOn).toEqual([])
    expect(state.sessionSummary).toBeNull()
    expect(state.newFromTeam).toEqual([])
  })
})

describe('defaultPersistentState', () => {
  it('returns null patterns and empty collections', () => {
    const state = defaultPersistentState()
    expect(state.patterns.workStyle).toBeNull()
    expect(state.patterns.productiveHours).toBeNull()
    expect(state.patterns.aiPreferences.grammarAcceptRate).toBeNull()
    expect(state.longTermKnowledge).toEqual([])
    expect(state.relationships.frequentCollaborators).toEqual([])
    expect(state.relationships.documentRoles).toEqual([])
  })
})

describe('defaultSharedState', () => {
  it('returns empty shared state with steady velocity', () => {
    const state = defaultSharedState()
    expect(state.contributions).toEqual([])
    expect(state.knowledge).toEqual([])
    expect(state.tensions).toEqual([])
    expect(state.dynamics.editVelocity).toBe('steady')
    expect(state.dynamics.activeContributors).toBe(0)
    expect(state.aiUsage.totalInteractions).toBe(0)
    expect(state.aiUsage.acceptanceRate).toBe(0)
  })
})

describe('defaultEventState type safety', () => {
  it('matches AIStateEvent interface', () => {
    const state: AIStateEvent = defaultEventState()
    expect(state).toBeDefined()
  })
})

describe('defaultSessionState type safety', () => {
  it('matches AIStateSession interface', () => {
    const state: AIStateSession = defaultSessionState()
    expect(state).toBeDefined()
  })
})

describe('defaultPersistentState type safety', () => {
  it('matches AIStatePersistent interface', () => {
    const state: AIStatePersistent = defaultPersistentState()
    expect(state).toBeDefined()
  })
})

describe('defaultSharedState deep structure', () => {
  it('has properly initialized dynamics sub-object', () => {
    const state = defaultSharedState()
    expect(state.dynamics.documentPhase).toBeNull()
    expect(state.dynamics.lastMajorChange).toBeNull()
    expect(state.dynamics.openQuestions).toEqual([])
  })

  it('has properly initialized aiUsage sub-object', () => {
    const state = defaultSharedState()
    expect(state.aiUsage.sectionsWithAIContent).toEqual([])
    expect(state.aiUsage.byUser).toEqual([])
  })
})

describe('defaultPersistentState deep structure', () => {
  it('has properly initialized aiPreferences', () => {
    const state = defaultPersistentState()
    expect(state.patterns.aiPreferences.toneAcceptRate).toBeNull()
    expect(state.patterns.aiPreferences.prefersOptions).toBeNull()
    expect(state.patterns.stuckSignals).toEqual([])
  })
})
