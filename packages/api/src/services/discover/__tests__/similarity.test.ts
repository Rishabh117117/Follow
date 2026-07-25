import { describe, it, expect } from 'vitest'
import { cosineSimilarity } from '../similarity'

describe('cosineSimilarity', () => {
  it('identical vectors → 1', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
  })

  it('orthogonal vectors → 0', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0)
  })

  it('opposite vectors → -1', () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1)
  })

  it('zero vector → 0 (no division by zero)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0)
  })

  it('length mismatch → 0', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })

  it('real-ish vectors produce expected similarity', () => {
    const a = [1, 2, 3]
    const b = [2, 3, 4]
    const s = cosineSimilarity(a, b)
    expect(s).toBeGreaterThan(0.9)
    expect(s).toBeLessThan(1)
  })
})
