/**
 * Facet edge signal (EDGE-FACET-1 · 2026-06-02)
 *
 * The semantic index stores three embedding facets per node:
 *   - content (768d) — WHAT happened
 *   - causal  (512d) — WHY it happened
 *   - context (512d) — WHERE it happened
 *
 * A single composite cosine collapses these into one scalar and loses the
 * *shape* of a relationship. Per-facet cosines make the contradiction
 * signature geometric: two nodes that agree on WHAT but diverge on WHY are a
 * contradiction; agreement on both is elaboration; shared WHERE with different
 * WHAT is a reference.
 *
 * This module is intentionally pure (no db / no LLM) so it is unit-testable
 * and importable from both ANALYST and the indexer's candidate generator.
 */

export interface FacetSimilarity {
  /** cosine of the content (WHAT) facets, ~[-1,1] */
  content: number
  /** cosine of the causal (WHY) facets */
  causal: number
  /** cosine of the context (WHERE) facets */
  context: number
}

export type FacetPattern = 'contradiction' | 'elaboration' | 'reference' | 'neutral'

export interface FacetEdgeSignal {
  /** the dominant geometric pattern — a *hint* for ANALYST, never a decision */
  pattern: FacetPattern
  /** high content + divergent causal → contradicts / supersedes */
  contradiction: number
  /** high content + high causal → elaborates / supports */
  elaboration: number
  /** high context + low content → references */
  reference: number
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0)

/** Minimum top-score for a pattern to be asserted over `neutral`. */
const PATTERN_FLOOR = 0.25

/**
 * Derive the geometric edge signal from a per-facet cosine triple.
 * Pure and deterministic.
 */
export function facetEdgeSignal(f: FacetSimilarity): FacetEdgeSignal {
  const content = clamp01(f.content)
  const causal = clamp01(f.causal)
  const context = clamp01(f.context)

  // Agree on WHAT, diverge on WHY.
  const contradiction = content * (1 - causal)
  // Agree on WHAT and WHY.
  const elaboration = content * causal
  // Shared WHERE, different WHAT.
  const reference = context * (1 - content)

  const ranked: [FacetPattern, number][] = [
    ['contradiction', contradiction],
    ['elaboration', elaboration],
    ['reference', reference],
  ]
  const top = ranked.reduce((best, cur) => (cur[1] > best[1] ? cur : best))
  const pattern: FacetPattern = top[1] >= PATTERN_FLOOR ? top[0] : 'neutral'

  return { pattern, contradiction, elaboration, reference }
}

// ─── Candidate surfacing ─────────────────────────────────────────────────────
//
// A pair that agrees on WHAT (content) but diverges on WHY (causal) is a
// contradiction candidate worth routing to ANALYST even when the *composite*
// cosine falls below the normal link threshold — exactly the pairs a single
// scalar similarity would silently drop.

export const CONTRADICTION_CONTENT_MIN = 0.7
export const CONTRADICTION_CAUSAL_MAX = 0.45

export function isContradictionCandidate(f: FacetSimilarity): boolean {
  return f.content >= CONTRADICTION_CONTENT_MIN && f.causal <= CONTRADICTION_CAUSAL_MAX
}
