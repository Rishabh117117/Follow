import { describe, it, expect } from 'vitest'
import {
  processEpisodesForDashboard,
  buildWeekSummary,
} from '../use-dashboard-data'

// ─── processEpisodesForDashboard ────────────────────────────────────────────

describe('processEpisodesForDashboard', () => {
  it('groups events by episodeId', () => {
    const results = [
      { episodeId: 'ep1', eventId: 'e1', timestamp: '2024-01-01T10:00:00Z', userName: 'Alice', threadType: 'doc', documentId: 'd1', documentTitle: 'Doc A' },
      { episodeId: 'ep1', eventId: 'e2', timestamp: '2024-01-01T10:05:00Z', userName: 'Alice', threadType: 'ai', documentId: 'd1', documentTitle: 'Doc A' },
      { episodeId: 'ep2', eventId: 'e3', timestamp: '2024-01-01T11:00:00Z', userName: 'Bob', threadType: 'doc', documentId: 'd2', documentTitle: 'Doc B' },
    ]
    const episodes = processEpisodesForDashboard(results, {})
    expect(episodes).toHaveLength(2)
  })

  it('includes documentTitle from results', () => {
    const results = [
      { episodeId: 'ep1', eventId: 'e1', timestamp: '2024-01-01T10:00:00Z', userName: 'Alice', threadType: 'doc', documentId: 'd1', documentTitle: 'Research Paper' },
    ]
    const episodes = processEpisodesForDashboard(results, {})
    expect(episodes[0]!.documentTitle).toBe('Research Paper')
  })

  it('sorts episodes by most recent endTime', () => {
    const results = [
      { episodeId: 'ep1', eventId: 'e1', timestamp: '2024-01-01T10:00:00Z', userName: 'A', threadType: 'doc', documentId: 'd1', documentTitle: 'D1' },
      { episodeId: 'ep2', eventId: 'e2', timestamp: '2024-01-02T10:00:00Z', userName: 'B', threadType: 'doc', documentId: 'd2', documentTitle: 'D2' },
    ]
    const episodes = processEpisodesForDashboard(results, {})
    expect(episodes[0]!.id).toBe('ep2')
  })

  it('skips results without episodeId', () => {
    const results = [
      { eventId: 'e1', timestamp: '2024-01-01T10:00:00Z', userName: 'A', threadType: 'doc' },
    ]
    const episodes = processEpisodesForDashboard(results, {})
    expect(episodes).toHaveLength(0)
  })

  it('collects unique surfaces per episode', () => {
    const results = [
      { episodeId: 'ep1', eventId: 'e1', timestamp: '2024-01-01T10:00:00Z', userName: 'A', threadType: 'doc', documentId: 'd1' },
      { episodeId: 'ep1', eventId: 'e2', timestamp: '2024-01-01T10:05:00Z', userName: 'A', threadType: 'ai', documentId: 'd1' },
      { episodeId: 'ep1', eventId: 'e3', timestamp: '2024-01-01T10:10:00Z', userName: 'A', threadType: 'doc', documentId: 'd1' },
    ]
    const episodes = processEpisodesForDashboard(results, {})
    expect(episodes[0]!.surfaces).toEqual(['doc', 'ai'])
  })

  it('uses episodeMap for title and primarySection', () => {
    const results = [
      { episodeId: 'ep1', eventId: 'e1', timestamp: '2024-01-01T10:00:00Z', userName: 'A', threadType: 'doc', documentId: 'd1' },
    ]
    const episodeMap = { ep1: { title: 'Custom Title', primarySection: 'Section 1' } }
    const episodes = processEpisodesForDashboard(results, episodeMap)
    expect(episodes[0]!.title).toBe('Custom Title')
    expect(episodes[0]!.primarySection).toBe('Section 1')
  })
})

// ─── buildWeekSummary ───────────────────────────────────────────────────────

describe('buildWeekSummary', () => {
  const episodes = [
    { id: 'ep1', title: 'T1', startTime: '2024-01-01T10:00:00Z', endTime: '2024-01-01T10:30:00Z', userNames: ['A'], surfaces: ['doc'], hasKeyChange: false, documentId: 'd1', documentTitle: 'Doc A', primarySection: 'Intro' },
    { id: 'ep2', title: 'T2', startTime: '2024-01-01T11:00:00Z', endTime: '2024-01-01T11:20:00Z', userNames: ['A'], surfaces: ['doc', 'ai'], hasKeyChange: false, documentId: 'd1', documentTitle: 'Doc A', primarySection: 'Intro' },
    { id: 'ep3', title: 'T3', startTime: '2024-01-02T09:00:00Z', endTime: '2024-01-02T09:45:00Z', userNames: ['B'], surfaces: ['browser'], hasKeyChange: true, documentId: 'd2', documentTitle: 'Doc B', primarySection: 'Methods' },
  ]

  it('computes documentsWorkedOn sorted by episode count', () => {
    const summary = buildWeekSummary({}, episodes as any)
    expect(summary).not.toBeNull()
    expect(summary!.documentsWorkedOn).toHaveLength(2)
    expect(summary!.documentsWorkedOn[0]!.documentId).toBe('d1')
    expect(summary!.documentsWorkedOn[0]!.episodeCount).toBe(2)
  })

  it('includes patterns from AI state', () => {
    const aiState = {
      persistent: {
        patterns: { workStyle: 'methodical researcher', productiveHours: [9, 14] },
      },
      session: { currentSession: { aiInteractionCount: 5 } },
    }
    const summary = buildWeekSummary(aiState, episodes as any)
    expect(summary!.workStyle).toBe('methodical researcher')
    expect(summary!.productiveHours).toEqual([9, 14])
    expect(summary!.totalAIInteractions).toBe(5)
  })

  it('returns null when no state and no episodes', () => {
    const summary = buildWeekSummary(null, [])
    expect(summary).toBeNull()
  })

  it('collects top sections', () => {
    const summary = buildWeekSummary({}, episodes as any)
    expect(summary!.topSections).toContain('Intro')
    expect(summary!.topSections).toContain('Methods')
  })
})
