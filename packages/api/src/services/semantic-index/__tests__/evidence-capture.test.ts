import { describe, it, expect } from 'vitest'
import {
  qualifyForEvidence,
  computeRecordHash,
  verifyHashChain,
} from '../evidence-capture'

describe('EvidenceCapture', () => {
  describe('qualifyForEvidence', () => {
    it('always captures AI interactions as ai_accepted', () => {
      expect(qualifyForEvidence('ai_interaction', 'low', false, true, {})).toBe('ai_accepted')
    })

    it('captures AI rejection when outcome is rejected', () => {
      expect(
        qualifyForEvidence('ai_interaction', 'low', false, true, { outcome: 'rejected' })
      ).toBe('ai_rejected')
    })

    it('always captures imports', () => {
      expect(qualifyForEvidence('import', 'low', false, false, {})).toBe('import')
    })

    it('captures edits with keyChange', () => {
      expect(qualifyForEvidence('edit', 'low', true, false, {})).toBe('content_change')
    })

    it('captures edits with medium+ magnitude', () => {
      expect(qualifyForEvidence('edit', 'medium', false, false, {})).toBe('content_change')
      expect(qualifyForEvidence('edit', 'high', false, false, {})).toBe('content_change')
    })

    it('skips low-magnitude edits without keyChange', () => {
      expect(qualifyForEvidence('edit', 'low', false, false, {})).toBeNull()
    })

    it('captures structural changes with medium+ magnitude', () => {
      expect(qualifyForEvidence('structural_change', 'medium', false, false, {})).toBe(
        'content_change'
      )
    })

    it('skips navigation events without AI involvement', () => {
      expect(qualifyForEvidence('navigation', 'low', false, false, {})).toBeNull()
    })

    it('captures navigation with AI involvement as source_introduced', () => {
      expect(qualifyForEvidence('navigation', 'low', false, true, {})).toBe('source_introduced')
    })

    it('skips gap events', () => {
      expect(qualifyForEvidence('gap', 'low', false, false, {})).toBeNull()
    })
  })

  describe('computeRecordHash', () => {
    it('produces consistent SHA-256 hash', () => {
      const content = {
        contentBefore: 'old text',
        contentAfter: 'new text',
        userId: 'user-1',
        timestamp: '2026-01-01T00:00:00.000Z',
      }

      const hash1 = computeRecordHash(content, null)
      const hash2 = computeRecordHash(content, null)
      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^[a-f0-9]{64}$/) // SHA-256
    })

    it('produces different hashes for different content', () => {
      const hash1 = computeRecordHash({ contentAfter: 'text A' }, null)
      const hash2 = computeRecordHash({ contentAfter: 'text B' }, null)
      expect(hash1).not.toBe(hash2)
    })

    it('chains with previous hash', () => {
      const hash1 = computeRecordHash({ contentAfter: 'first' }, null)
      const hash2 = computeRecordHash({ contentAfter: 'second' }, hash1)
      const hash2Alt = computeRecordHash({ contentAfter: 'second' }, null)
      expect(hash2).not.toBe(hash2Alt) // chaining matters
    })
  })

  describe('verifyHashChain', () => {
    it('verifies a valid chain', () => {
      const now = new Date().toISOString()
      const hash1 = computeRecordHash({ contentAfter: 'first', timestamp: now }, null)
      const hash2 = computeRecordHash({ contentAfter: 'second', timestamp: now }, hash1)

      const chain = [
        { recordHash: hash1, hashChainPrev: null, contentAfter: 'first', createdAt: now },
        { recordHash: hash2, hashChainPrev: hash1, contentAfter: 'second', createdAt: now },
      ]

      expect(verifyHashChain(chain)).toEqual({ valid: true })
    })

    it('detects broken chain', () => {
      const now = new Date().toISOString()
      const hash1 = computeRecordHash({ contentAfter: 'first', timestamp: now }, null)

      const chain = [
        { recordHash: hash1, hashChainPrev: null, contentAfter: 'first', createdAt: now },
        { recordHash: 'tampered_hash', hashChainPrev: hash1, contentAfter: 'second', createdAt: now },
      ]

      const result = verifyHashChain(chain)
      expect(result.valid).toBe(false)
      expect(result.brokenAt).toBe(1)
    })

    it('validates empty chain', () => {
      expect(verifyHashChain([])).toEqual({ valid: true })
    })

    it('validates single-record chain', () => {
      const now = new Date().toISOString()
      const hash = computeRecordHash({ contentAfter: 'only', timestamp: now }, null)
      const chain = [
        { recordHash: hash, hashChainPrev: null, contentAfter: 'only', createdAt: now },
      ]
      expect(verifyHashChain(chain)).toEqual({ valid: true })
    })
  })
})
