import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DocumentSharedState } from '@workspace/shared/types'

// Track state updates
let sharedUpdater: ((current: DocumentSharedState) => DocumentSharedState) | null = null

vi.mock('../state-manager', () => ({
  updateSharedState: vi.fn(async (_d: string, _w: string, updater: (c: DocumentSharedState) => DocumentSharedState) => {
    sharedUpdater = updater
    return true
  }),
}))

vi.mock('../shared-state-propagator', () => ({
  scheduleSharedStatePush: vi.fn(),
}))

vi.mock('../../../db', () => ({
  db: {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }), where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    selectDistinct: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }) }),
  },
}))

vi.mock('../../../db/schema/threads', () => ({
  strandCollaborators: { id: 'id', strandId: 'strand_id', userId: 'user_id' },
  strands: { id: 'id', workspaceId: 'workspace_id' },
  strandThreadRefs: { strandId: 'strand_id' },
}))

import { updateSharedStateFromEvents, type SharedStateEventInput } from '../shared-state-updater'

function emptyShared(): DocumentSharedState {
  return {
    contributions: [],
    knowledge: [],
    tensions: [],
    dynamics: { documentPhase: null, activeContributors: 0, editVelocity: 'steady', lastMajorChange: null, openQuestions: [] },
    aiUsage: { totalInteractions: 0, acceptedCount: 0, rejectedCount: 0, acceptanceRate: 0, sectionsWithAIContent: [], byUser: [] },
  }
}

function makeEvent(overrides: Partial<SharedStateEventInput> = {}): SharedStateEventInput {
  return {
    eventId: 'ev-1', label: 'Edited intro', type: 'edit', section: 'Introduction',
    threadType: 'doc', timestamp: new Date().toISOString(), isKeyChange: false,
    isAIInvolved: false, magnitude: 'medium', userId: 'user-1', userName: 'Alice',
    documentId: 'doc-1', documentTitle: 'Doc', wordsDelta: 10, reflection: null,
    ...overrides,
  }
}

beforeEach(() => {
  sharedUpdater = null
})

describe('updateSharedStateFromEvents', () => {
  it('adds contributor on first event', async () => {
    await updateSharedStateFromEvents('doc-1', 'ws-1', [makeEvent()])
    const result = sharedUpdater!(emptyShared())
    expect(result.contributions).toHaveLength(1)
    expect(result.contributions[0]?.userName).toBe('Alice')
  })

  it('tracks section-level edits', async () => {
    await updateSharedStateFromEvents('doc-1', 'ws-1', [makeEvent({ section: 'Methods' })])
    const result = sharedUpdater!(emptyShared())
    const contributor = result.contributions[0]!
    expect(contributor.sections).toHaveLength(1)
    expect(contributor.sections[0]?.sectionRef).toBe('Methods')
    expect(contributor.sections[0]?.editCount).toBe(1)
  })

  it('computes contributor roles based on share', async () => {
    await updateSharedStateFromEvents('doc-1', 'ws-1', [
      makeEvent({ userId: 'user-1', userName: 'Alice' }),
      makeEvent({ userId: 'user-1', userName: 'Alice' }),
      makeEvent({ userId: 'user-1', userName: 'Alice' }),
      makeEvent({ userId: 'user-1', userName: 'Alice' }),
      makeEvent({ userId: 'user-1', userName: 'Alice' }),
      makeEvent({ userId: 'user-2', userName: 'Bob' }),
    ])
    const result = sharedUpdater!(emptyShared())
    const alice = result.contributions.find(c => c.userId === 'user-1')!
    const bob = result.contributions.find(c => c.userId === 'user-2')!
    expect(alice.role).toBe('heavy_editor')
    expect(bob.role).toBe('light_editor')
  })

  it('increments AI usage counter', async () => {
    await updateSharedStateFromEvents('doc-1', 'ws-1', [makeEvent({ isAIInvolved: true })])
    const result = sharedUpdater!(emptyShared())
    expect(result.aiUsage.totalInteractions).toBe(1)
  })

  it('tracks active contributors (24h window)', async () => {
    await updateSharedStateFromEvents('doc-1', 'ws-1', [makeEvent()])
    const result = sharedUpdater!(emptyShared())
    expect(result.dynamics.activeContributors).toBe(1)
  })

  it('detects edit velocity', async () => {
    await updateSharedStateFromEvents('doc-1', 'ws-1', [makeEvent()])
    const result = sharedUpdater!(emptyShared())
    // 1 edit = slowing
    expect(['slowing', 'steady', 'stalled']).toContain(result.dynamics.editVelocity)
  })

  it('extracts knowledge from key change reflections', async () => {
    await updateSharedStateFromEvents('doc-1', 'ws-1', [
      makeEvent({
        isKeyChange: true,
        reflection: { tension: null, knowledge: { fact: 'Budget is $50k', source: 'doc', confidence: 0.7 } },
      }),
    ])
    const result = sharedUpdater!(emptyShared())
    expect(result.knowledge).toHaveLength(1)
    expect(result.knowledge[0]?.fact).toBe('Budget is $50k')
  })

  it('adds cross-user tension only when multiple users involved', async () => {
    const base = emptyShared()
    base.contributions.push({
      userId: 'user-2', userName: 'Bob', sections: [{ sectionRef: 'Budget', editCount: 1, lastEditAt: new Date().toISOString(), wordsDelta: 0, isAIAssisted: false }],
      totalEvents: 1, lastActiveAt: new Date().toISOString(), role: 'light_editor',
    })

    await updateSharedStateFromEvents('doc-1', 'ws-1', [
      makeEvent({
        userId: 'user-1',
        reflection: { tension: { description: 'Budget conflict', severity: 'high', sections: ['Budget'] }, knowledge: null },
      }),
    ])

    const result = sharedUpdater!(base)
    expect(result.tensions.length).toBeGreaterThanOrEqual(1)
    expect(result.tensions.some(t => t.description.includes('Budget conflict'))).toBe(true)
  })

  it('does NOT add single-user tension to shared state', async () => {
    await updateSharedStateFromEvents('doc-1', 'ws-1', [
      makeEvent({
        reflection: { tension: { description: 'Self tension', severity: 'low', sections: ['Methods'] }, knowledge: null },
      }),
    ])
    const result = sharedUpdater!(emptyShared())
    expect(result.tensions).toHaveLength(0)
  })

  it('caps knowledge at 30', async () => {
    const base = emptyShared()
    base.knowledge = Array.from({ length: 30 }, (_, i) => ({
      id: `k-${i}`, fact: `Fact ${i}`, source: 'test', confidence: 0.5,
      contributedBy: 'user-1', contributedByName: 'Alice', sharedAt: new Date().toISOString(),
      method: 'extracted' as const, linkedSection: null, conflictsWith: null, status: 'active' as const,
    }))

    await updateSharedStateFromEvents('doc-1', 'ws-1', [
      makeEvent({
        isKeyChange: true,
        reflection: { tension: null, knowledge: { fact: 'New unique fact here', source: 'doc', confidence: 0.9 } },
      }),
    ])

    const result = sharedUpdater!(base)
    expect(result.knowledge.length).toBeLessThanOrEqual(30)
  })

  it('detects concurrent edit conflict', async () => {
    const base = emptyShared()
    base.contributions.push({
      userId: 'user-2', userName: 'Bob',
      sections: [{ sectionRef: 'Introduction', editCount: 1, lastEditAt: new Date().toISOString(), wordsDelta: 5, isAIAssisted: false }],
      totalEvents: 1, lastActiveAt: new Date().toISOString(), role: 'light_editor',
    })

    await updateSharedStateFromEvents('doc-1', 'ws-1', [
      makeEvent({ userId: 'user-1', section: 'Introduction', type: 'edit' }),
    ])

    const result = sharedUpdater!(base)
    expect(result.tensions.some(t => t.type === 'dependency')).toBe(true)
  })
})
