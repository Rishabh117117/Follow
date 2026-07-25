# EDGE-FACET-1 — per-facet edge similarity (2026-06-02)

Part of `master-run/2026-06-02`. Additive. ANALYST now sees similarity **per facet**, not one composite scalar — the contradiction signature becomes geometric.

## What landed

- **`services/pipeline/facet-signal.ts`** (new, pure — no db/LLM): `FacetSimilarity {content,causal,context}`, `facetEdgeSignal()` (geometric pattern: high-content+low-causal → contradiction; high-content+high-causal → elaboration; high-context+low-content → reference), and `isContradictionCandidate()` for surfacing. Unit-tested (`__tests__/facet-signal.test.ts`, 7 tests).
- **`analyst.ts`**: `ClassifyEdgeInput` gains optional `facetSimilarity` (scalar `cosineSimilarity` kept for back-compat). When present, the LLM message includes the three facet cosines + a derived `facetPattern`; `JSON.stringify` drops the keys when absent, so the back-compat message is byte-identical.
- **`prompts.ts`**: ANALYST system prompt teaches reading the facet geometry (as a prior, not a verdict).
- **`indexer.ts`** (candidate generator `detectAndInsertLinks`): carries the new record's facet embeddings through `linkValues`; computes the per-facet cosine triple per candidate pair (candidate facets come from the existing `.select()`); passes `facetSimilarity` to `classifyEdge`; records `facets` in the analyst link metadata. **Candidate surfacing**: a near-content/far-causal pair (the contradiction signature) is routed to ANALYST even when the _composite_ cosine misses the link threshold — gated to the LLM path (`pipeline-analyst-llm` flag) so the legacy heuristic stays byte-identical. Also dropped a pre-existing dead `getReadingContext` import (forced by the lint hook).

## Back-compat & safety

- Facets are built only when **both** records carry the content facet; legacy/retro records (null facets) fall through to the scalar-only path untouched.
- When `pipeline-analyst-llm` is OFF, surfacing is disabled and the legacy linkType heuristic is unchanged.

## Tests / gates

- New: `facet-signal.test.ts` — near-content/far-causal yields **higher contradiction** than near-both (the prescribed fixture), pattern classification, candidate-surfacing, clamping. **7/7 pass.**
- api TS errors: **164 → 164** (baseline, none in modified files). web/shared TS: 0.
- api tests: **862 → 869 passing** (+7), 16 failing unchanged (pre-existing env/PGlite), 125 skipped. No regression.

Per-file commits prefixed `EDGE-FACET-1:`.
