import { describe, it, expect } from 'vitest'
import { facetEdgeSignal, isContradictionCandidate, type FacetSimilarity } from '../facet-signal'

const nearContentFarCausal: FacetSimilarity = { content: 0.9, causal: 0.15, context: 0.5 }
const nearBoth: FacetSimilarity = { content: 0.9, causal: 0.9, context: 0.5 }
const sharedContextLowContent: FacetSimilarity = { content: 0.2, causal: 0.3, context: 0.9 }

describe('facetEdgeSignal (EDGE-FACET-1)', () => {
  it('near-content / far-causal yields higher contradiction than near-both', () => {
    const a = facetEdgeSignal(nearContentFarCausal)
    const b = facetEdgeSignal(nearBoth)
    expect(a.contradiction).toBeGreaterThan(b.contradiction)
  })

  it('agreement on WHAT + WHY reads as elaboration', () => {
    const s = facetEdgeSignal(nearBoth)
    expect(s.pattern).toBe('elaboration')
    expect(s.elaboration).toBeGreaterThan(s.contradiction)
  })

  it('agreement on WHAT + divergence on WHY reads as contradiction', () => {
    const s = facetEdgeSignal(nearContentFarCausal)
    expect(s.pattern).toBe('contradiction')
    expect(s.contradiction).toBeGreaterThan(s.elaboration)
  })

  it('shared WHERE + low WHAT reads as reference', () => {
    const s = facetEdgeSignal(sharedContextLowContent)
    expect(s.pattern).toBe('reference')
    expect(s.reference).toBeGreaterThan(s.contradiction)
  })

  it('clamps out-of-range / non-finite inputs and defaults to neutral', () => {
    const s = facetEdgeSignal({ content: 0, causal: 0, context: 0 })
    expect(s.pattern).toBe('neutral')
    const t = facetEdgeSignal({ content: NaN, causal: 2, context: -3 })
    expect(Number.isFinite(t.contradiction)).toBe(true)
    expect(t.contradiction).toBeGreaterThanOrEqual(0)
    expect(t.contradiction).toBeLessThanOrEqual(1)
  })
})

describe('isContradictionCandidate (candidate surfacing)', () => {
  it('flags near-content / far-causal pairs', () => {
    expect(isContradictionCandidate(nearContentFarCausal)).toBe(true)
  })

  it('does not flag near-both pairs', () => {
    expect(isContradictionCandidate(nearBoth)).toBe(false)
  })
})
