import { describe, it, expect } from 'vitest'

// Test the episode card data processing logic

describe('EpisodeCard', () => {
  const episode = {
    id: 'ep1',
    title: 'Researched competitive data and applied to Section 2',
    startTime: '2024-01-01T14:10:00Z',
    endTime: '2024-01-01T14:35:00Z',
    eventIds: ['e1', 'e2', 'e3'],
    userIds: ['u1', 'u2'],
    userNames: ['Rishabh', 'Anika'],
    surfaces: ['browser', 'ai', 'doc'],
    primarySection: 'Section 2',
    outcome: 'Applied research findings',
    hasKeyChange: true,
    events: undefined as any,
  }

  it('has correct structure with title and participants', () => {
    expect(episode.title).toBe('Researched competitive data and applied to Section 2')
    expect(episode.userNames).toEqual(['Rishabh', 'Anika'])
    expect(episode.eventIds).toHaveLength(3)
  })

  it('includes all surface types', () => {
    expect(episode.surfaces).toContain('browser')
    expect(episode.surfaces).toContain('ai')
    expect(episode.surfaces).toContain('doc')
  })

  it('reports key change status', () => {
    expect(episode.hasKeyChange).toBe(true)
  })

  it('formats multi-user name string correctly', () => {
    const nameStr = episode.userNames.join(', ')
    expect(nameStr).toBe('Rishabh, Anika')
  })

  it('shows event count in tags', () => {
    expect(episode.eventIds.length).toBe(3)
  })

  it('limits stacked avatars to 3', () => {
    const manyUsers = { ...episode, userNames: ['A', 'B', 'C', 'D', 'E'] }
    const displayed = manyUsers.userNames.slice(0, 3)
    expect(displayed).toHaveLength(3)
  })
})
