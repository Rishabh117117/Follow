import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AIStateEvent, AIStateSession } from '@workspace/shared/types'
import type { ReflectionOutput } from '../reflector'

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

import { updateStateFromEventsWithReflections, type IndexedEventWithReflection } from '../event-updater'

function emptyEventState(): AIStateEvent {
  return { recentEvents: [], activeTensions: [], activeKnowledge: [] }
}

function makeReflection(overrides: Partial<ReflectionOutput> = {}): ReflectionOutput {
  return {
    tension: null,
    connection: null,
    shift: null,
    gap: null,
    knowledge: null,
    overallConfidence: 0.6,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<IndexedEventWithReflection> = {}): IndexedEventWithReflection {
  return {
    eventId: 'ev-1',
    label: 'Test event',
    type: 'edit',
    section: null,
    threadType: 'doc',
    timestamp: new Date().toISOString(),
    isKeyChange: false,
    isAIInvolved: false,
    documentId: null,
    documentTitle: null,
    episodeId: null,
    reflection: null,
    ...overrides,
  }
}

beforeEach(() => {
  eventUpdates = []
  sessionUpdates = []
})

describe('updateStateFromEventsWithReflections', () => {
  it('adds reflection annotations to events', async () => {
    await updateStateFromEventsWithReflections('user-1', 'ws-1', [
      makeEvent({
        reflection: makeReflection({
          tension: { description: 'Budget conflict', severity: 'medium', sections: ['Budget'] },
        }),
      }),
    ])

    const result = eventUpdates[0]!(emptyEventState())
    expect(result.recentEvents[0]?.reflection).not.toBeNull()
    expect(result.recentEvents[0]?.reflection?.tension).toBe('Budget conflict')
  })

  it('marks events with reflections as tentative', async () => {
    await updateStateFromEventsWithReflections('user-1', 'ws-1', [
      makeEvent({ reflection: makeReflection() }),
    ])

    const result = eventUpdates[0]!(emptyEventState())
    expect(result.recentEvents[0]?.tentative).toBe(true)
  })

  it('marks events without reflections as not tentative', async () => {
    await updateStateFromEventsWithReflections('user-1', 'ws-1', [
      makeEvent({ reflection: null }),
    ])

    const result = eventUpdates[0]!(emptyEventState())
    expect(result.recentEvents[0]?.tentative).toBe(false)
  })

  it('adds new tension from reflection', async () => {
    await updateStateFromEventsWithReflections('user-1', 'ws-1', [
      makeEvent({
        reflection: makeReflection({
          tension: { description: 'New tension', severity: 'high', sections: ['Methods'] },
        }),
      }),
    ])

    const result = eventUpdates[0]!(emptyEventState())
    expect(result.activeTensions).toHaveLength(1)
    expect(result.activeTensions[0]?.description).toBe('New tension')
    expect(result.activeTensions[0]?.tentative).toBe(true)
  })

  it('deduplicates tensions on same section', async () => {
    const existing: AIStateEvent = {
      recentEvents: [],
      activeTensions: [
        { id: 't-1', description: 'Existing', severity: 'medium', sections: ['Budget'], confidence: 0.5, detectedAt: new Date().toISOString(), tentative: true, resolvedAt: null, sourceEventIds: ['ev-0'] },
      ],
      activeKnowledge: [],
    }

    await updateStateFromEventsWithReflections('user-1', 'ws-1', [
      makeEvent({
        reflection: makeReflection({
          tension: { description: 'Duplicate', severity: 'high', sections: ['Budget'] },
        }),
      }),
    ])

    const result = eventUpdates[0]!(existing)
    // Should NOT add duplicate
    expect(result.activeTensions).toHaveLength(1)
    expect(result.activeTensions[0]?.description).toBe('Existing')
  })

  it('caps tensions at 5', async () => {
    const existing: AIStateEvent = {
      recentEvents: [],
      activeTensions: Array.from({ length: 5 }, (_, i) => ({
        id: `t-${i}`,
        description: `Tension ${i}`,
        severity: 'low' as const,
        sections: [`Section${i}`],
        confidence: 0.5,
        detectedAt: new Date().toISOString(),
        tentative: true,
        resolvedAt: null,
        sourceEventIds: [`ev-${i}`],
      })),
      activeKnowledge: [],
    }

    await updateStateFromEventsWithReflections('user-1', 'ws-1', [
      makeEvent({
        reflection: makeReflection({
          tension: { description: 'New tension', severity: 'high', sections: ['NewSection'] },
        }),
      }),
    ])

    const result = eventUpdates[0]!(existing)
    expect(result.activeTensions.length).toBeLessThanOrEqual(5)
  })

  it('extracts knowledge from reflection', async () => {
    await updateStateFromEventsWithReflections('user-1', 'ws-1', [
      makeEvent({
        reflection: makeReflection({
          knowledge: { fact: 'Deadline is March 15', source: 'email', confidence: 0.7 },
        }),
      }),
    ])

    const result = eventUpdates[0]!(emptyEventState())
    expect(result.activeKnowledge).toHaveLength(1)
    expect(result.activeKnowledge[0]?.fact).toBe('Deadline is March 15')
  })

  it('deduplicates knowledge', async () => {
    const existing: AIStateEvent = {
      recentEvents: [],
      activeTensions: [],
      activeKnowledge: [
        { fact: 'Deadline is March 15', source: 'email', confidence: 0.7, linkedSection: null, extractedAt: new Date().toISOString(), fromUserId: 'user-1', shared: false },
      ],
    }

    await updateStateFromEventsWithReflections('user-1', 'ws-1', [
      makeEvent({
        reflection: makeReflection({
          knowledge: { fact: 'Deadline is March', source: 'email', confidence: 0.8 },
        }),
      }),
    ])

    const result = eventUpdates[0]!(existing)
    // Should NOT add duplicate
    expect(result.activeKnowledge).toHaveLength(1)
  })

  it('caps knowledge at 10', async () => {
    const existing: AIStateEvent = {
      recentEvents: [],
      activeTensions: [],
      activeKnowledge: Array.from({ length: 10 }, (_, i) => ({
        fact: `Fact ${i}`,
        source: 'test',
        confidence: 0.3 + i * 0.05,
        linkedSection: null,
        extractedAt: new Date().toISOString(),
        fromUserId: 'user-1',
        shared: false,
      })),
    }

    await updateStateFromEventsWithReflections('user-1', 'ws-1', [
      makeEvent({
        reflection: makeReflection({
          knowledge: { fact: 'New fact', source: 'test', confidence: 0.9 },
        }),
      }),
    ])

    const result = eventUpdates[0]!(existing)
    expect(result.activeKnowledge.length).toBeLessThanOrEqual(10)
  })
})
