import { describe, it, expect } from 'vitest'

describe('AIUsageSection', () => {
  const aiUsage = {
    totalInteractions: 25,
    acceptedCount: 20,
    rejectedCount: 5,
    acceptanceRate: 80,
    sectionsWithAIContent: ['Section 1', 'Section 3'],
    byUser: [
      { userId: 'u1', userName: 'Rishabh', interactions: 15, acceptRate: 87 },
      { userId: 'u2', userName: 'Anika', interactions: 10, acceptRate: 70 },
    ],
  }

  it('computes acceptance rate bar width', () => {
    expect(Math.round(aiUsage.acceptanceRate)).toBe(80)
  })

  it('determines correct color for acceptance rate', () => {
    const getColor = (rate: number) =>
      rate > 70 ? 'green' : rate >= 40 ? 'amber' : 'red'
    expect(getColor(80)).toBe('green')
    expect(getColor(50)).toBe('amber')
    expect(getColor(30)).toBe('red')
  })

  it('lists sections with AI content', () => {
    expect(aiUsage.sectionsWithAIContent).toHaveLength(2)
    expect(aiUsage.sectionsWithAIContent).toContain('Section 1')
  })

  it('sorts per-user breakdown by interaction count', () => {
    const sorted = [...aiUsage.byUser].sort((a, b) => b.interactions - a.interactions)
    expect(sorted[0]!.userName).toBe('Rishabh')
  })
})
