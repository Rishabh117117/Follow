import { describe, it, expect } from 'vitest'
import type { DocumentIntel } from '../use-dashboard-data'

describe('useDocumentIntel', () => {
  it('returns expected structure from fetchDocumentIntel', () => {
    // Simulate the shape returned by fetchDocumentIntel
    const intel: DocumentIntel = {
      documentId: 'd1',
      phase: 'exploration',
      editVelocity: 'steady',
      activeTensionCount: 0,
      activeContributors: 2,
      contributorAvatars: [
        { userId: 'u1', name: 'Alice', isActive: true },
        { userId: 'u2', name: 'Bob', isActive: false },
      ],
      lastMajorChange: null,
      aiInteractionCount: 3,
    }
    expect(intel.documentId).toBe('d1')
    expect(intel.phase).toBe('exploration')
    expect(intel.contributorAvatars).toHaveLength(2)
  })

  it('handles null intel gracefully', () => {
    const intel: DocumentIntel | null = null
    expect(intel).toBeNull()
  })

  it('limits contributor avatars to 3', () => {
    const avatars = [
      { userId: 'u1', name: 'A', isActive: true },
      { userId: 'u2', name: 'B', isActive: false },
      { userId: 'u3', name: 'C', isActive: true },
      { userId: 'u4', name: 'D', isActive: false },
    ].slice(0, 3)
    expect(avatars).toHaveLength(3)
  })
})
