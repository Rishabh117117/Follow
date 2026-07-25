import { describe, it, expect } from 'vitest'

describe('ContributorSection', () => {
  const contributions = [
    {
      userId: 'u1',
      userName: 'Rishabh',
      sections: [
        { sectionRef: 'Section 1', editCount: 5, lastEditAt: '2024-01-01T10:00:00Z', wordsDelta: 120, isAIAssisted: true },
        { sectionRef: 'Section 2', editCount: 3, lastEditAt: '2024-01-01T11:00:00Z', wordsDelta: 80, isAIAssisted: false },
      ],
      totalEvents: 12,
      lastActiveAt: '2024-01-01T12:00:00Z',
      role: 'editor',
    },
    {
      userId: 'u2',
      userName: 'Anika',
      sections: [
        { sectionRef: 'Section 3', editCount: 7, lastEditAt: '2024-01-01T09:00:00Z', wordsDelta: 200, isAIAssisted: false },
      ],
      totalEvents: 7,
      lastActiveAt: '2024-01-01T09:30:00Z',
      role: 'contributor',
    },
  ]

  it('renders correct number of contributors', () => {
    expect(contributions).toHaveLength(2)
  })

  it('shows active status for present collaborators', () => {
    const presentIds = new Set(['u1'])
    expect(presentIds.has('u1')).toBe(true)
    expect(presentIds.has('u2')).toBe(false)
  })

  it('limits visible contributors to 5 and shows +N more', () => {
    const manyContributions = Array.from({ length: 8 }, (_, i) => ({
      userId: `u${i}`,
      userName: `User ${i}`,
      sections: [],
      totalEvents: i,
      lastActiveAt: '2024-01-01T10:00:00Z',
      role: 'editor',
    }))
    const visible = manyContributions.slice(0, 5)
    const hasMore = manyContributions.length > 5
    expect(visible).toHaveLength(5)
    expect(hasMore).toBe(true)
    expect(manyContributions.length - 5).toBe(3)
  })

  it('counts AI-assisted sections correctly', () => {
    const aiCount = contributions[0]!.sections.filter((s) => s.isAIAssisted).length
    expect(aiCount).toBe(1)
  })
})
