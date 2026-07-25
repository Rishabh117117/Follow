import { describe, it, expect } from 'vitest'
import { processExtensionEpisodes } from '../services/provenance-service'

describe('Extension ProvenanceService', () => {
  it('processExtensionEpisodes groups by episodeId', () => {
    const results = [
      { episodeId: 'ep1', eventId: 'e1', timestamp: '2024-01-01T10:00:00Z', userName: 'Alice', threadType: 'doc', label: 'Edited intro' },
      { episodeId: 'ep1', eventId: 'e2', timestamp: '2024-01-01T10:05:00Z', userName: 'Alice', threadType: 'ai', label: 'AI assist' },
      { episodeId: 'ep2', eventId: 'e3', timestamp: '2024-01-01T11:00:00Z', userName: 'Bob', threadType: 'doc', label: 'Wrote section' },
    ]
    const episodes = processExtensionEpisodes(results, {})
    expect(episodes).toHaveLength(2)
  })

  it('processExtensionEpisodes sorts by most recent', () => {
    const results = [
      { episodeId: 'ep1', eventId: 'e1', timestamp: '2024-01-01T10:00:00Z', userName: 'A', threadType: 'doc' },
      { episodeId: 'ep2', eventId: 'e2', timestamp: '2024-01-02T10:00:00Z', userName: 'B', threadType: 'doc' },
    ]
    const episodes = processExtensionEpisodes(results, {})
    expect(episodes[0]!.id).toBe('ep2')
  })

  it('includes event details in episodes', () => {
    const results = [
      { episodeId: 'ep1', eventId: 'e1', timestamp: '2024-01-01T10:00:00Z', userName: 'A', threadType: 'doc', label: 'Typed text', isKeyChange: true, isAIInvolved: false, hasEvidence: true },
    ]
    const episodes = processExtensionEpisodes(results, { ep1: { title: 'Writing session' } })
    expect(episodes[0]!.title).toBe('Writing session')
    expect(episodes[0]!.events[0]!.isKeyChange).toBe(true)
    expect(episodes[0]!.events[0]!.hasEvidence).toBe(true)
  })

  it('handles empty results', () => {
    const episodes = processExtensionEpisodes([], {})
    expect(episodes).toHaveLength(0)
  })

  it('skips results without episodeId', () => {
    const results = [{ eventId: 'e1', timestamp: '2024-01-01T10:00:00Z' }]
    const episodes = processExtensionEpisodes(results, {})
    expect(episodes).toHaveLength(0)
  })
})
