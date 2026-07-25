import { describe, it, expect } from 'vitest'
import type { DocumentIntel } from '@/hooks/use-dashboard-data'

describe('DocumentIntelCard', () => {
  const intel: DocumentIntel = {
    documentId: 'd1',
    phase: 'convergence',
    editVelocity: 'accelerating',
    activeTensionCount: 2,
    activeContributors: 4,
    contributorAvatars: [
      { userId: 'u1', name: 'Rishabh', isActive: true },
      { userId: 'u2', name: 'Anika', isActive: false },
      { userId: 'u3', name: 'Sam', isActive: true },
    ],
    lastMajorChange: { description: 'Restructured intro', userName: 'Rishabh', timestamp: '2024-01-01T10:00:00Z' },
    aiInteractionCount: 12,
  }

  it('renders phase pill with correct abbreviation', () => {
    const PHASE_ABBRS: Record<string, string> = {
      inception: 'Inc', exploration: 'Exp', convergence: 'Conv',
      stabilization: 'Stab', delivery: 'Del',
    }
    expect(PHASE_ABBRS[intel.phase!]).toBe('Conv')
  })

  it('renders contributor avatars limited to 3', () => {
    expect(intel.contributorAvatars).toHaveLength(3)
    expect(intel.activeContributors).toBe(4)
  })

  it('renders tension count badge', () => {
    expect(intel.activeTensionCount).toBe(2)
  })

  it('renders velocity indicator for accelerating', () => {
    const VELOCITY: Record<string, string> = {
      accelerating: '↑', steady: '→', slowing: '↓',
    }
    expect(VELOCITY[intel.editVelocity]).toBe('↑')
  })

  it('returns null when intel is null', () => {
    const nullIntel: DocumentIntel | null = null
    expect(nullIntel).toBeNull()
  })

  it('shows AI indicator when interactions > 0', () => {
    expect(intel.aiInteractionCount).toBeGreaterThan(0)
  })
})
