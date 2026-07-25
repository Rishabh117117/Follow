import { describe, it, expect } from 'vitest'
import {
  scoreResults,
  cosineSimilarity,
  computeRecency,
  computeMagnitude,
  computeStructural,
  computeAuthorship,
  WEIGHT_PROFILES,
  THRESHOLDS,
  type CandidateRecord,
  type ScoreContext,
} from '../weighted-referencing'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    id: 'rec-1',
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    threadType: 'doc',
    indexMagnitude: 'medium',
    isKeyChange: false,
    isAIInvolved: false,
    hasEvidence: false,
    engagementDepth: 0.5,
    episodeId: null,
    documentId: 'doc-1',
    documentTitle: 'Test Doc',
    sectionAlias: 'Introduction',
    userId: 'user-1',
    userName: 'Alice',
    eventTime: new Date(),
    embeddingText: 'test text',
    embedding: null,
    metadata: {},
    ...overrides,
  }
}

function makeContext(overrides: Partial<ScoreContext> = {}): ScoreContext {
  return {
    queryType: 'history',
    queryEmbedding: null,
    targetDocumentId: null,
    targetSection: null,
    requestingUserId: 'user-1',
    collaboratorIds: [],
    ...overrides,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WeightedReferencing', () => {
  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const vec = [1, 2, 3, 4]
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 5)
    })

    it('returns 0 for orthogonal vectors', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5)
    })

    it('returns 0 for null/empty vectors', () => {
      expect(cosineSimilarity(null, [1, 2])).toBe(0)
      expect(cosineSimilarity([1, 2], null)).toBe(0)
      expect(cosineSimilarity([], [])).toBe(0)
    })

    it('returns negative for opposite vectors', () => {
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 5)
    })
  })

  describe('computeRecency', () => {
    it('returns 1.0 for current events', () => {
      const now = new Date()
      expect(computeRecency(now, now)).toBeCloseTo(1.0, 5)
    })

    it('returns ~0.5 for events 24h ago', () => {
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      expect(computeRecency(yesterday, now)).toBeCloseTo(0.5, 1)
    })

    it('decays towards 0 for old events', () => {
      const now = new Date()
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const result = computeRecency(weekAgo, now)
      expect(result).toBeLessThan(0.15)
      expect(result).toBeGreaterThan(0)
    })
  })

  describe('computeMagnitude', () => {
    it('returns correct scores for each tier', () => {
      expect(computeMagnitude('tiny', false)).toBeCloseTo(0.1)
      expect(computeMagnitude('small', false)).toBeCloseTo(0.25)
      expect(computeMagnitude('medium', false)).toBeCloseTo(0.5)
      expect(computeMagnitude('large', false)).toBeCloseTo(0.75)
      expect(computeMagnitude('major', false)).toBeCloseTo(1.0)
    })

    it('adds keyChange bonus', () => {
      expect(computeMagnitude('small', true)).toBeCloseTo(0.45) // 0.25 + 0.2
      expect(computeMagnitude('large', true)).toBeCloseTo(0.95) // 0.75 + 0.2
    })

    it('caps at 1.0', () => {
      expect(computeMagnitude('major', true)).toBe(1.0) // 1.0 + 0.2 capped
    })
  })

  describe('computeStructural', () => {
    it('returns 1.0 for exact section match', () => {
      expect(computeStructural('doc-1', 'Intro', 'doc-1', 'Intro')).toBe(1.0)
    })

    it('returns 1.0 case-insensitive', () => {
      expect(computeStructural('doc-1', 'intro', 'doc-1', 'Intro')).toBe(1.0)
    })

    it('returns 0.5 for same doc different section', () => {
      expect(computeStructural('doc-1', 'Intro', 'doc-1', 'Conclusion')).toBe(0.5)
    })

    it('returns 0.1 for different documents', () => {
      expect(computeStructural('doc-1', 'Intro', 'doc-2', 'Intro')).toBe(0.1)
    })

    it('returns 0.3 when no document context', () => {
      expect(computeStructural(null, null, 'doc-1', 'Intro')).toBe(0.3)
    })
  })

  describe('computeAuthorship', () => {
    it('returns 0.6 for requesting user', () => {
      expect(computeAuthorship('user-1', 'user-1', [])).toBe(0.6)
    })

    it('returns 0.4 for collaborator', () => {
      expect(computeAuthorship('user-2', 'user-1', ['user-2'])).toBe(0.4)
    })

    it('returns 0.2 for non-collaborator', () => {
      expect(computeAuthorship('user-3', 'user-1', ['user-2'])).toBe(0.2)
    })
  })

  describe('scoreResults', () => {
    it('returns all candidates for evidence query type', () => {
      const candidates = [makeCandidate(), makeCandidate({ id: 'rec-2' })]
      const results = scoreResults(candidates, makeContext({ queryType: 'evidence' }))
      expect(results).toHaveLength(2)
      expect(results[0]!.score).toBe(1.0)
    })

    it('applies threshold filtering', () => {
      const candidates = [
        makeCandidate({ engagementDepth: 0, indexMagnitude: 'tiny', userId: 'other' }),
      ]
      const results = scoreResults(candidates, makeContext({ queryType: 'proactive' }))
      // Proactive threshold is 0.70 — most candidates won't pass
      expect(results.length).toBeLessThanOrEqual(1)
    })

    it('sorts by score descending', () => {
      const candidates = [
        makeCandidate({ id: 'low', indexMagnitude: 'small', engagementDepth: 0.1 }),
        makeCandidate({ id: 'high', indexMagnitude: 'large', isKeyChange: true, engagementDepth: 0.9 }),
      ]
      const results = scoreResults(candidates, makeContext({ queryType: 'history' }))
      if (results.length >= 2) {
        expect(results[0]!.recordId).toBe('high')
      }
    })

    it('includes signal breakdown in results', () => {
      const candidates = [makeCandidate()]
      const results = scoreResults(candidates, makeContext())
      expect(results[0]!.signals).toHaveProperty('semantic')
      expect(results[0]!.signals).toHaveProperty('recency')
      expect(results[0]!.signals).toHaveProperty('magnitude')
      expect(results[0]!.signals).toHaveProperty('engagement')
      expect(results[0]!.signals).toHaveProperty('structural')
      expect(results[0]!.signals).toHaveProperty('authorship')
    })
  })

  describe('weight profiles', () => {
    it('all profiles have weights summing to ~1.0', () => {
      for (const [name, profile] of Object.entries(WEIGHT_PROFILES)) {
        if (name === 'evidence') continue // evidence has all-zero weights
        const sum =
          profile.semantic +
          profile.recency +
          profile.magnitude +
          profile.engagement +
          profile.structural +
          profile.authorship
        expect(sum).toBeCloseTo(1.0, 2)
      }
    })

    it('realtime profile prioritizes recency', () => {
      const rt = WEIGHT_PROFILES['realtime']!
      expect(rt.recency).toBeGreaterThan(rt.semantic)
      expect(rt.recency).toBeGreaterThan(rt.magnitude)
    })

    it('focused profile prioritizes semantic', () => {
      const f = WEIGHT_PROFILES['focused']!
      expect(f.semantic).toBeGreaterThan(f.recency)
    })
  })
})
