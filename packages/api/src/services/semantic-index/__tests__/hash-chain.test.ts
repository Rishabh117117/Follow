import { describe, it, expect } from 'vitest'
import { computeRecordHash, verifyHashChain } from '../hash-chain'

describe('HashChain', () => {
  describe('computeRecordHash', () => {
    it('produces consistent SHA-256 hash', () => {
      const hash1 = computeRecordHash({ contentAfter: 'test', timestamp: '2026-01-01' }, null)
      const hash2 = computeRecordHash({ contentAfter: 'test', timestamp: '2026-01-01' }, null)
      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^[a-f0-9]{64}$/)
    })

    it('produces different hashes for different content', () => {
      const hash1 = computeRecordHash({ contentAfter: 'A' }, null)
      const hash2 = computeRecordHash({ contentAfter: 'B' }, null)
      expect(hash1).not.toBe(hash2)
    })

    it('chains with previous hash', () => {
      const hash1 = computeRecordHash({ contentAfter: 'first' }, null)
      const chained = computeRecordHash({ contentAfter: 'second' }, hash1)
      const unchained = computeRecordHash({ contentAfter: 'second' }, null)
      expect(chained).not.toBe(unchained)
    })

    it('handles null/undefined fields gracefully', () => {
      const hash = computeRecordHash({}, null)
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('verifyHashChain', () => {
    it('validates empty chain', () => {
      expect(verifyHashChain([])).toEqual({ valid: true })
    })

    it('validates single-record chain', () => {
      const now = '2026-01-01T00:00:00Z'
      const hash = computeRecordHash({ contentAfter: 'only', timestamp: now }, null)
      expect(
        verifyHashChain([{ recordHash: hash, hashChainPrev: null, contentAfter: 'only', createdAt: now }])
      ).toEqual({ valid: true })
    })

    it('validates multi-record chain', () => {
      const now = '2026-01-01T00:00:00Z'
      const hash1 = computeRecordHash({ contentAfter: 'first', timestamp: now }, null)
      const hash2 = computeRecordHash({ contentAfter: 'second', timestamp: now }, hash1)

      expect(
        verifyHashChain([
          { recordHash: hash1, hashChainPrev: null, contentAfter: 'first', createdAt: now },
          { recordHash: hash2, hashChainPrev: hash1, contentAfter: 'second', createdAt: now },
        ])
      ).toEqual({ valid: true })
    })

    it('detects tampered hash', () => {
      const now = '2026-01-01T00:00:00Z'
      const hash1 = computeRecordHash({ contentAfter: 'first', timestamp: now }, null)

      const result = verifyHashChain([
        { recordHash: hash1, hashChainPrev: null, contentAfter: 'first', createdAt: now },
        { recordHash: 'tampered', hashChainPrev: hash1, contentAfter: 'second', createdAt: now },
      ])

      expect(result.valid).toBe(false)
      expect(result.brokenAt).toBe(1)
    })
  })
})
