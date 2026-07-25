import { describe, it, expect } from 'vitest'
import { processEpisodes, mapToProvenanceEvent } from '../use-provenance-data'

// ─── processEpisodes ────────────────────────────────────────────────────────

describe('processEpisodes', () => {
  it('groups events by episodeId', () => {
    const results = [
      { episodeId: 'ep1', eventId: 'e1', timestamp: '2024-01-01T10:00:00Z', userId: 'u1', userName: 'Alice', threadType: 'doc' },
      { episodeId: 'ep1', eventId: 'e2', timestamp: '2024-01-01T10:05:00Z', userId: 'u1', userName: 'Alice', threadType: 'ai' },
      { episodeId: 'ep2', eventId: 'e3', timestamp: '2024-01-01T11:00:00Z', userId: 'u2', userName: 'Bob', threadType: 'doc' },
    ]
    const episodeMap = {
      ep1: { title: 'Research phase', primarySection: 'Section 1', outcome: 'done' },
      ep2: { title: 'Writing phase', primarySection: 'Section 2', outcome: null },
    }

    const episodes = processEpisodes(results, episodeMap)
    expect(episodes).toHaveLength(2)
    expect(episodes[0]!.eventIds).toContain('e3')
    expect(episodes[1]!.eventIds).toContain('e1')
    expect(episodes[1]!.eventIds).toContain('e2')
  })

  it('sorts episodes by most recent endTime first', () => {
    const results = [
      { episodeId: 'ep1', eventId: 'e1', timestamp: '2024-01-01T10:00:00Z', userId: 'u1', userName: 'Alice', threadType: 'doc' },
      { episodeId: 'ep2', eventId: 'e2', timestamp: '2024-01-01T12:00:00Z', userId: 'u2', userName: 'Bob', threadType: 'doc' },
    ]
    const episodes = processEpisodes(results, {})
    expect(episodes[0]!.id).toBe('ep2')
    expect(episodes[1]!.id).toBe('ep1')
  })

  it('returns empty array when no results have episodeId', () => {
    const results = [{ eventId: 'e1', timestamp: '2024-01-01T10:00:00Z' }]
    const episodes = processEpisodes(results, {})
    expect(episodes).toHaveLength(0)
  })

  it('collects unique userIds and surfaces per episode', () => {
    const results = [
      { episodeId: 'ep1', eventId: 'e1', timestamp: '2024-01-01T10:00:00Z', userId: 'u1', userName: 'Alice', threadType: 'doc' },
      { episodeId: 'ep1', eventId: 'e2', timestamp: '2024-01-01T10:05:00Z', userId: 'u1', userName: 'Alice', threadType: 'ai' },
      { episodeId: 'ep1', eventId: 'e3', timestamp: '2024-01-01T10:10:00Z', userId: 'u2', userName: 'Bob', threadType: 'doc' },
    ]
    const episodes = processEpisodes(results, {})
    const ep = episodes[0]!
    expect(ep.userIds).toEqual(['u1', 'u2'])
    expect(ep.userNames).toEqual(['Alice', 'Bob'])
    expect(ep.surfaces).toEqual(['doc', 'ai'])
  })

  it('sets hasKeyChange when any event has isKeyChange', () => {
    const results = [
      { episodeId: 'ep1', eventId: 'e1', timestamp: '2024-01-01T10:00:00Z', userId: 'u1', isKeyChange: false, threadType: 'doc' },
      { episodeId: 'ep1', eventId: 'e2', timestamp: '2024-01-01T10:05:00Z', userId: 'u1', isKeyChange: true, threadType: 'doc' },
    ]
    const episodes = processEpisodes(results, {})
    expect(episodes[0]!.hasKeyChange).toBe(true)
  })

  it('uses episodeMap data for title and primarySection', () => {
    const results = [
      { episodeId: 'ep1', eventId: 'e1', timestamp: '2024-01-01T10:00:00Z', userId: 'u1', threadType: 'doc', sectionRef: 'fallback' },
    ]
    const episodeMap = { ep1: { title: 'Custom title', primarySection: 'Intro', outcome: 'merged' } }
    const episodes = processEpisodes(results, episodeMap)
    expect(episodes[0]!.title).toBe('Custom title')
    expect(episodes[0]!.primarySection).toBe('Intro')
    expect(episodes[0]!.outcome).toBe('merged')
  })
})

// ─── mapToProvenanceEvent ───────────────────────────────────────────────────

describe('mapToProvenanceEvent', () => {
  it('maps all fields correctly', () => {
    const result = {
      id: 'id1',
      eventId: 'ev1',
      label: 'Edited paragraph',
      type: 'edit',
      threadType: 'doc',
      timestamp: '2024-01-01T10:00:00Z',
      sectionRef: 'Section 1',
      userId: 'u1',
      userName: 'Alice',
      isKeyChange: true,
      isAIInvolved: false,
      hasEvidence: true,
      relevanceScore: 0.85,
    }

    const event = mapToProvenanceEvent(result)
    expect(event.id).toBe('id1')
    expect(event.eventId).toBe('ev1')
    expect(event.label).toBe('Edited paragraph')
    expect(event.type).toBe('edit')
    expect(event.threadType).toBe('doc')
    expect(event.sectionRef).toBe('Section 1')
    expect(event.userId).toBe('u1')
    expect(event.userName).toBe('Alice')
    expect(event.isKeyChange).toBe(true)
    expect(event.isAIInvolved).toBe(false)
    expect(event.hasEvidence).toBe(true)
    expect(event.relevanceScore).toBe(0.85)
  })

  it('handles missing fields with defaults', () => {
    const result = { id: 'id2', eventId: 'ev2' }
    const event = mapToProvenanceEvent(result)
    expect(event.userName).toBe('Unknown')
    expect(event.isKeyChange).toBe(false)
    expect(event.relevanceScore).toBe(0)
    expect(event.sectionRef).toBeNull()
  })

  it('handles sectionRef as object with heading property', () => {
    const result = {
      id: 'id3',
      eventId: 'ev3',
      sectionRef: { heading: 'Introduction', depth: 1 },
    }
    const event = mapToProvenanceEvent(result)
    expect(event.sectionRef).toBe('Introduction')
  })

  it('falls back to embeddingText when label is missing', () => {
    const result = {
      id: 'id4',
      eventId: 'ev4',
      embeddingText: 'This is a long embedding text that should be truncated at 100 characters',
    }
    const event = mapToProvenanceEvent(result)
    expect(event.label).toContain('This is a long embedding')
  })
})
