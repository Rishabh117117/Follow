import { describe, it, expect } from 'vitest'
import type { WeekSummary } from '@/hooks/use-dashboard-data'

describe('WeekSummaryCard', () => {
  const summary: WeekSummary = {
    documentsWorkedOn: [
      { documentId: 'd1', title: 'Capstone Pitch', episodeCount: 8, eventCount: 20, timeSpentMinutes: 120 },
      { documentId: 'd2', title: 'Research Notes', episodeCount: 5, eventCount: 15, timeSpentMinutes: 90 },
      { documentId: 'd3', title: 'Meeting Notes', episodeCount: 2, eventCount: 5, timeSpentMinutes: 30 },
    ],
    totalEpisodes: 15,
    totalAIInteractions: 8,
    aiAcceptanceRate: 0.85,
    workStyle: 'Research-first writer who restructures after first drafts',
    productiveHours: [10, 14],
    topSections: ['Introduction', 'Methods'],
  }

  it('has correct stats', () => {
    expect(summary.totalEpisodes).toBe(15)
    expect(summary.documentsWorkedOn.length).toBe(3)
    expect(summary.totalAIInteractions).toBe(8)
  })

  it('renders work style when patterns exist', () => {
    expect(summary.workStyle).toBe('Research-first writer who restructures after first drafts')
  })

  it('renders productive hours', () => {
    expect(summary.productiveHours).toEqual([10, 14])
  })

  it('documents sorted by episode count', () => {
    expect(summary.documentsWorkedOn[0]!.episodeCount).toBe(8)
    expect(summary.documentsWorkedOn[1]!.episodeCount).toBe(5)
    expect(summary.documentsWorkedOn[2]!.episodeCount).toBe(2)
  })

  it('renders nothing when summary is null', () => {
    const nullSummary: WeekSummary | null = null
    expect(nullSummary).toBeNull()
  })

  it('renders nothing when no documents worked on', () => {
    const empty: WeekSummary = { ...summary, documentsWorkedOn: [] }
    expect(empty.documentsWorkedOn.length).toBe(0)
  })
})
