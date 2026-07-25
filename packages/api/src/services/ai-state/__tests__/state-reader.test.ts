import { describe, it, expect, vi } from 'vitest'
import type {
  AIStateComplete,
  AIStateImmediate,
  AIStateEvent,
  AIStateSession,
  AIStatePersistent,
} from '@workspace/shared/types'

// Mock dependencies
vi.mock('../immediate-updater', () => ({
  getImmediateState: vi.fn(async () => mockImmediate()),
}))

vi.mock('../state-manager', () => ({
  getOrCreateState: vi.fn(async () => ({
    stateEvent: mockEvent(),
    stateSession: mockSession(),
    statePersistent: mockPersistent(),
    version: 1,
  })),
}))

import { readFullState, formatStateForPrompt } from '../state-reader'

function mockImmediate(): AIStateImmediate {
  return {
    focus: {
      documentId: 'doc-1',
      documentTitle: 'Project Proposal',
      sectionRef: 'Budget',
      sectionViewStartedAt: new Date(Date.now() - 30000).toISOString(),
      surface: 'doc',
      activeUrl: null,
      updatedAt: new Date().toISOString(),
    },
    presence: {
      isIdle: false,
      idleSince: null,
      collaborators: [{ userId: 'user-2', name: 'Alice', section: 'Methods', lastSeen: new Date().toISOString() }],
      activeSince: new Date(Date.now() - 600000).toISOString(),
    },
    chat: { isActive: false, lastTurnAt: null, activeConversationId: null, turnCountThisSession: 0 },
  }
}

function mockEvent(): AIStateEvent {
  return {
    recentEvents: [
      {
        eventId: 'ev-1',
        label: 'Updated budget table',
        type: 'edit',
        section: 'Budget',
        threadType: 'doc',
        timestamp: new Date(Date.now() - 60000).toISOString(),
        isKeyChange: true,
        isAIInvolved: false,
        tentative: false,
        reflection: null,
      },
    ],
    activeTensions: [
      {
        id: 't-1',
        description: 'Budget numbers conflict with Q1 projections',
        severity: 'medium',
        sections: ['Budget', 'Timeline'],
        confidence: 0.8,
        detectedAt: new Date().toISOString(),
        tentative: false,
        resolvedAt: null,
        sourceEventIds: ['ev-1'],
      },
    ],
    activeKnowledge: [
      {
        fact: 'Project deadline is March 15',
        source: 'email',
        confidence: 0.95,
        linkedSection: 'Timeline',
        extractedAt: new Date().toISOString(),
        fromUserId: 'user-1',
        shared: false,
      },
    ],
  }
}

function mockSession(): AIStateSession {
  return {
    currentSession: {
      startedAt: new Date(Date.now() - 3600000).toISOString(),
      eventCount: 15,
      sectionsVisited: ['Budget', 'Timeline', 'Methods'],
      episodeIds: ['ep-1'],
      aiInteractionCount: 3,
      aiAcceptedCount: 2,
      aiRejectedCount: 1,
      documentsWorkedOn: [
        { documentId: 'doc-1', title: 'Project Proposal', eventCount: 10 },
        { documentId: 'doc-2', title: 'Budget Sheet', eventCount: 5 },
      ],
    },
    sessionSummary: null,
    newFromTeam: [
      {
        fromUserId: 'user-2',
        fromUserName: 'Alice',
        memory: 'Updated the timeline section with new milestones',
        relevantSection: 'Timeline',
        receivedAt: new Date().toISOString(),
        surfaced: false,
      },
    ],
  }
}

function mockPersistent(): AIStatePersistent {
  return {
    patterns: {
      workStyle: 'focused deep-work sessions',
      productiveHours: [9, 17],
      avgSessionMinutes: 45,
      aiPreferences: {
        grammarAcceptRate: 0.85,
        structureAcceptRate: 0.6,
        toneAcceptRate: 0.4,
        prefersOptions: true,
      },
      collaborationStyle: null,
      stuckSignals: [],
    },
    longTermKnowledge: [],
    relationships: { frequentCollaborators: [], documentRoles: [] },
  }
}

describe('readFullState', () => {
  it('combines Redis and PostgreSQL state', async () => {
    const state = await readFullState('user-1', 'ws-1')
    expect(state.immediate.focus.documentId).toBe('doc-1')
    expect(state.event.recentEvents).toHaveLength(1)
    expect(state.session.currentSession.eventCount).toBe(15)
    expect(state.persistent.patterns.workStyle).toBe('focused deep-work sessions')
  })
})

describe('formatStateForPrompt', () => {
  it('produces valid text output', async () => {
    const state = await readFullState('user-1', 'ws-1')
    const output = formatStateForPrompt(state, 'Bob', 'Acme Corp')
    expect(typeof output).toBe('string')
    expect(output.length).toBeGreaterThan(0)
  })

  it('includes current context when viewing a document', async () => {
    const state = await readFullState('user-1', 'ws-1')
    const output = formatStateForPrompt(state, 'Bob', 'Acme Corp')
    expect(output).toContain('## Current Context')
    expect(output).toContain('Project Proposal')
    expect(output).toContain('Budget')
  })

  it('includes collaborator presence', async () => {
    const state = await readFullState('user-1', 'ws-1')
    const output = formatStateForPrompt(state, 'Bob', 'Acme Corp')
    expect(output).toContain('Alice')
    expect(output).toContain('viewing Methods')
  })

  it('includes key changes', async () => {
    const state = await readFullState('user-1', 'ws-1')
    const output = formatStateForPrompt(state, 'Bob', 'Acme Corp')
    expect(output).toContain('## Recent Key Changes')
    expect(output).toContain('Updated budget table')
  })

  it('includes active tensions', async () => {
    const state = await readFullState('user-1', 'ws-1')
    const output = formatStateForPrompt(state, 'Bob', 'Acme Corp')
    expect(output).toContain('## Active Tensions')
    expect(output).toContain('Budget numbers conflict')
  })

  it('includes active knowledge', async () => {
    const state = await readFullState('user-1', 'ws-1')
    const output = formatStateForPrompt(state, 'Bob', 'Acme Corp')
    expect(output).toContain('## Relevant Knowledge')
    expect(output).toContain('Project deadline is March 15')
  })

  it('includes session summary', async () => {
    const state = await readFullState('user-1', 'ws-1')
    const output = formatStateForPrompt(state, 'Bob', 'Acme Corp')
    expect(output).toContain('## This Session')
    expect(output).toContain('Project Proposal')
    expect(output).toContain('Budget Sheet')
  })

  it('includes new from team', async () => {
    const state = await readFullState('user-1', 'ws-1')
    const output = formatStateForPrompt(state, 'Bob', 'Acme Corp')
    expect(output).toContain('## New From Team')
    expect(output).toContain('Alice')
  })

  it('includes user patterns', async () => {
    const state = await readFullState('user-1', 'ws-1')
    const output = formatStateForPrompt(state, 'Bob', 'Acme Corp')
    expect(output).toContain('## User Patterns')
    expect(output).toContain('focused deep-work sessions')
    expect(output).toContain('grammar 85%')
  })

  it('handles empty state gracefully', () => {
    const emptyState: AIStateComplete = {
      immediate: {
        focus: { documentId: null, documentTitle: null, sectionRef: null, sectionViewStartedAt: null, surface: 'idle', activeUrl: null, updatedAt: new Date().toISOString() },
        presence: { isIdle: true, idleSince: new Date().toISOString(), collaborators: [], activeSince: null },
        chat: { isActive: false, lastTurnAt: null, activeConversationId: null, turnCountThisSession: 0 },
      },
      event: { recentEvents: [], activeTensions: [], activeKnowledge: [] },
      session: {
        currentSession: { startedAt: null, eventCount: 0, sectionsVisited: [], episodeIds: [], aiInteractionCount: 0, aiAcceptedCount: 0, aiRejectedCount: 0, documentsWorkedOn: [] },
        sessionSummary: null,
        newFromTeam: [],
      },
      persistent: {
        patterns: { workStyle: null, productiveHours: null, avgSessionMinutes: null, aiPreferences: { grammarAcceptRate: null, structureAcceptRate: null, toneAcceptRate: null, prefersOptions: null }, collaborationStyle: null, stuckSignals: [] },
        longTermKnowledge: [],
        relationships: { frequentCollaborators: [], documentRoles: [] },
      },
    }

    const output = formatStateForPrompt(emptyState, 'Bob', 'Acme')
    expect(output).toBe('')
  })
})
