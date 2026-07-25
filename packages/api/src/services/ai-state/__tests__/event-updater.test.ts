import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AIStateEvent, AIStateSession } from '@workspace/shared/types'

// Track state updates
let eventUpdates: Array<(current: AIStateEvent) => AIStateEvent> = []
let sessionUpdates: Array<(current: AIStateSession) => AIStateSession> = []

vi.mock('../state-manager', () => ({
  updateStateEvent: vi.fn(async (_u: string, _w: string, updater: (c: AIStateEvent) => AIStateEvent) => {
    eventUpdates.push(updater)
    return true
  }),
  updateStateSession: vi.fn(async (_u: string, _w: string, updater: (c: AIStateSession) => AIStateSession) => {
    sessionUpdates.push(updater)
    return true
  }),
}))

import { updateStateFromEvents, type IndexedEvent } from '../event-updater'

function makeEvent(overrides: Partial<IndexedEvent> = {}): IndexedEvent {
  return {
    eventId: 'ev-1',
    label: 'Test event',
    type: 'edit',
    section: null,
    threadType: 'doc',
    timestamp: '2024-01-01T00:00:00Z',
    isKeyChange: false,
    isAIInvolved: false,
    documentId: null,
    documentTitle: null,
    episodeId: null,
    ...overrides,
  }
}

function emptyEventState(): AIStateEvent {
  return { recentEvents: [], activeTensions: [], activeKnowledge: [] }
}

function emptySessionState(): AIStateSession {
  return {
    currentSession: {
      startedAt: null,
      eventCount: 0,
      sectionsVisited: [],
      episodeIds: [],
      aiInteractionCount: 0,
      aiAcceptedCount: 0,
      aiRejectedCount: 0,
      documentsWorkedOn: [],
    },
    sessionSummary: null,
    newFromTeam: [],
  }
}

beforeEach(() => {
  eventUpdates = []
  sessionUpdates = []
})

describe('updateStateFromEvents', () => {
  it('skips update when events array is empty', async () => {
    await updateStateFromEvents('user-1', 'ws-1', [])
    expect(eventUpdates).toHaveLength(0)
    expect(sessionUpdates).toHaveLength(0)
  })

  it('adds events to ring buffer', async () => {
    await updateStateFromEvents('user-1', 'ws-1', [
      makeEvent({ eventId: 'ev-1', label: 'First' }),
      makeEvent({ eventId: 'ev-2', label: 'Second' }),
    ])

    expect(eventUpdates).toHaveLength(1)
    const result = eventUpdates[0]!(emptyEventState())
    expect(result.recentEvents).toHaveLength(2)
    // Newest first
    expect(result.recentEvents[0]?.label).toBe('Second')
    expect(result.recentEvents[1]?.label).toBe('First')
  })

  it('caps ring buffer at 20 events', async () => {
    const events = Array.from({ length: 25 }, (_, i) =>
      makeEvent({ eventId: `ev-${i}`, label: `Event ${i}` })
    )
    await updateStateFromEvents('user-1', 'ws-1', events)

    const result = eventUpdates[0]!(emptyEventState())
    expect(result.recentEvents).toHaveLength(20)
  })

  it('initializes session startedAt on first events', async () => {
    await updateStateFromEvents('user-1', 'ws-1', [makeEvent()])

    const result = sessionUpdates[0]!(emptySessionState())
    expect(result.currentSession.startedAt).toBeTruthy()
  })

  it('increments event count', async () => {
    await updateStateFromEvents('user-1', 'ws-1', [
      makeEvent(),
      makeEvent(),
      makeEvent(),
    ])

    const result = sessionUpdates[0]!(emptySessionState())
    expect(result.currentSession.eventCount).toBe(3)
  })

  it('tracks sections visited without duplicates', async () => {
    await updateStateFromEvents('user-1', 'ws-1', [
      makeEvent({ section: 'Introduction' }),
      makeEvent({ section: 'Methods' }),
      makeEvent({ section: 'Introduction' }), // duplicate
    ])

    const result = sessionUpdates[0]!(emptySessionState())
    expect(result.currentSession.sectionsVisited).toEqual(['Introduction', 'Methods'])
  })

  it('tracks documents worked on', async () => {
    await updateStateFromEvents('user-1', 'ws-1', [
      makeEvent({ documentId: 'doc-1', documentTitle: 'Proposal' }),
      makeEvent({ documentId: 'doc-1', documentTitle: 'Proposal' }),
      makeEvent({ documentId: 'doc-2', documentTitle: 'Budget' }),
    ])

    const result = sessionUpdates[0]!(emptySessionState())
    expect(result.currentSession.documentsWorkedOn).toHaveLength(2)
    expect(result.currentSession.documentsWorkedOn[0]?.eventCount).toBe(2)
    expect(result.currentSession.documentsWorkedOn[1]?.eventCount).toBe(1)
  })

  it('caps documents worked on at 10', async () => {
    const events = Array.from({ length: 15 }, (_, i) =>
      makeEvent({ documentId: `doc-${i}`, documentTitle: `Doc ${i}` })
    )
    await updateStateFromEvents('user-1', 'ws-1', events)

    const result = sessionUpdates[0]!(emptySessionState())
    expect(result.currentSession.documentsWorkedOn).toHaveLength(10)
  })

  it('counts AI interactions', async () => {
    await updateStateFromEvents('user-1', 'ws-1', [
      makeEvent({ isAIInvolved: true }),
      makeEvent({ isAIInvolved: false }),
      makeEvent({ isAIInvolved: true }),
    ])

    const result = sessionUpdates[0]!(emptySessionState())
    expect(result.currentSession.aiInteractionCount).toBe(2)
  })

  it('tracks episodes without duplicates', async () => {
    await updateStateFromEvents('user-1', 'ws-1', [
      makeEvent({ episodeId: 'ep-1' }),
      makeEvent({ episodeId: 'ep-1' }),
      makeEvent({ episodeId: 'ep-2' }),
    ])

    const result = sessionUpdates[0]!(emptySessionState())
    expect(result.currentSession.episodeIds).toEqual(['ep-1', 'ep-2'])
  })

  it('sets reflection to null for new events', async () => {
    await updateStateFromEvents('user-1', 'ws-1', [makeEvent()])

    const result = eventUpdates[0]!(emptyEventState())
    expect(result.recentEvents[0]?.reflection).toBeNull()
    expect(result.recentEvents[0]?.tentative).toBe(false)
  })
})
