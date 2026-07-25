# FACET-FIX-1 — make the three facets carry distinct signal

**Date:** 2026-06-16
**Branch:** `claude/sprint-handoff-continuation-0datpq` (session-pinned; stacked
on GRAPH-WIRE-1 + ANALYST-ON-1 in PR #11).
**Scope:** Data-shaping of the facet composition so content (WHAT) / causal
(WHY) / context (WHERE) are built from genuinely different source text, so the
contradiction geometry (`isContradictionCandidate`: content-high & causal-low)
can fire. Prerequisite for ANALYST-ON-1's flag flip. No flag, no schema change.

## Step 0 — Discovery inventory (per source type)

What WHAT-signal and WHY-signal actually exist on the distilled event + metadata:

| Source                              | WHAT (content)                                                          | WHY (causal)                                                                                                                                                                                             | Notes                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **chat** (`chat-fact-extractor.ts`) | `label` (summary) + `metadata.chunkContent` (the real ~4 KB chunk text) | **user turn**, recoverable from the chunk: the transcript is serialized `[user] …\n\n[assistant] …` (save-conversation `syncConversationWrapper`), so a chunk window usually contains a `[user]` segment | Previously `contextNotes = "Topics: …"` (WHAT masquerading as WHY) and `chatQuestion`/`outcome` were never set. Chunks are flat fixed-window slices (no structured Q/A field) → per-chunk question is recovered heuristically, not threaded. A clean Q/A split is **FACET-FIX-2**. |
| **doc** (`buildDocTemplate` inputs) | `metadata.plainText` + `blockType`                                      | `contextNotes` (genuine edit reasoning), `keyChange`                                                                                                                                                     | contextNotes here IS real WHY — kept.                                                                                                                                                                                                                                              |
| **browser / user / import**         | `pageTitle`/`url`, `label`                                              | `contextNotes` when present                                                                                                                                                                              | No dedicated causal source; causal will be empty (→ NULL) unless contextNotes carries reasoning. Correct.                                                                                                                                                                          |

**Root cause confirmed:** on the chat path, content and causal were both carved
from thin metadata (label + topics) and overlapped heavily; causal had no real
source and fell back to `event.label` (a copy of WHAT). Their cross-record
cosines tracked each other ⇒ `isContradictionCandidate` couldn't separate.

## Step 1 — Composition fix (`compose-embedding-text.ts`)

- **content (WHAT):** lead with `label`, then include the **substance** —
  `metadata.chunkContent` (chat) or block `plainText` (doc blocks), ~400 cap.
  **Removed the `contextNotes` append** (the overlap source). `context` facet
  unchanged.
- **causal (WHY):** genuine why-signal only — `chatQuestion` ("After asking…"),
  `outcome`, reasoning `contextNotes`, `keyChange` marker. **Removed the
  `|| event.label` fallback** (returns `''` when no real WHY) and added a guard
  so a bare `Topics: …` contextNotes is **not** treated as a reason (defensive,
  even though Step 3 stops producing it).

## Step 2 — Indexer stores NULL for empty facets

`embedFacetSparse(texts, dim)` embeds **only non-empty** facet texts and scatters
results back to their original indices; empty/whitespace facet text → `null`
(not an embedding of `""`). Applied to all three facets. On embedding-API failure
the facet degrades to all-null (scalar path still works). This makes "no real WHY
⇒ no causal facet ⇒ no false contradiction," the correct semantics — and the
facet-cosine path in `indexer.ts` already treats a null facet as "no comparison"
and falls back to the scalar.

## Step 3 — Cheap extraction wins (`chat-fact-extractor.ts`)

- **`metadata.chatQuestion`** is now populated by `extractQuestionFromChunk()`,
  which recovers the `[user]` turn from the transcript chunk → gives causal a
  real source on the live path. Null when the window has no user turn.
- **Stopped routing topics into causal-shaped `contextNotes`** (now `null`).
  Topics still flow via `metadata.topics` and reach the main embedding + content
  facet through `chunkContent`.
- Did **not** refactor the chunker. A structured per-chunk Q/A split (instead of
  the heuristic `[user]` recovery on flat windows) is deferred to **FACET-FIX-2**.

## Main embedding integrity (HALT condition #2)

The main 1536d embedding keeps the **full content** — `buildAITemplate` still
emits `Content: {chunkContent}`. The only thing that drops from the chat main
embedding is the redundant `Context: Topics: …` line; topics are derived from
content that's already embedded, and remain in `metadata.topics`. No content loss.

## Step 4 — PRE-1 before/after — pending (needs live Postgres)

This sandbox has no `DATABASE_URL` (PGlite fallback, empty), so the before/after
`scripts/preflight/facet-separation.ts` run is **handed off**. Procedure:

1. **Before:** run PRE-1 on the current corpus → record Pearson(content,causal)
   and the contradiction-candidate count (baseline degeneracy).
2. Deploy this change; index a representative **fresh** sample (existing rows keep
   their old facets — the fix is forward-only).
3. **After:** run PRE-1 on the freshly-indexed sample.

**Acceptance signal:** Pearson(content,causal) drops meaningfully; contradiction
candidates become non-trivial but not spurious; spot-checked qualifying pairs
look like genuine WHAT-agree / WHY-differ. **If correlation does NOT drop →
HALT:** the WHY signal genuinely isn't there yet and FACET-FIX-2 (extraction
restructuring) is required before ANALYST is worth flipping.

The composition change makes content and causal structurally distinct (content =
chunk substance; causal = question/reason or empty), so the correlation _should_
drop — the unit test proves content≠causal on a representative chat event — but
the empirical magnitude needs the live run.

## Deferred

- **FACET-FIX-2** — restructure chat extraction to thread a clean per-chunk Q/A
  split (vs. the heuristic `[user]` recovery from flat fixed-window chunks).
  Required only if PRE-1-after still shows high correlation.
- **FACET-BACKFILL-1** — re-embed existing `index_records` so old rows get the
  improved facets (optional; this sprint is forward-only).

## Gates (acceptance #6)

- `@workspace/api` TS errors: **164** (= baseline). `@workspace/shared`: **0**.
- ESLint (`--max-warnings=0`) on touched files: clean.
- Tests: `tensor-facets.test.ts` updated to the new contract (content carries no
  contextNotes; causal empty-not-label; topics not a reason; content≠causal on a
  chat event) + new `chat-fact-extractor.test.ts` (question recovery). Facet/
  extractor/compose suites **39/39**; full `semantic-index` suite **99/99** green.

## Rollback

Revert the composer/indexer/extractor changes — data-shaping only, no flag, no
schema. Existing rows are unaffected either way (facets recompute on new
indexing).

## Deviations

- **Step 4 PRE-1 run** handed off (no live Postgres in sandbox); script reused
  verbatim from ANALYST-ON-1.
- `chatQuestion` is recovered heuristically from the `[user]` transcript markers
  rather than from a structured field (none exists at the chunk layer) — clean
  threading is FACET-FIX-2, as the sprint allows.

## Step 4 ADDENDUM (2026-06-17) — PRE-1 run live; inconclusive, HALT-leaning

Live PRE-1 was finally runnable only after the indexing pipeline itself was
repaired (it had never produced embeddings — see `PIPELINE-FIX-1-REPORT.md`).
Run against `main` (deployed, pre-FACET-FIX-1) over a 30-conversation seeded
corpus:

- **Pearson(content,causal) = 0.41** — already separated; `main` is **NOT
  degenerate**. In these chat-fact-extractor records causal resolved to a
  compressed _topics/label_ form (and `chatQuestion` is null because main lacks
  the extractor), so the literal `|| event.label` collapse the sprint targets did
  not reproduce. A meaningful "drop" can't be shown from a 0.41 baseline.
- **0 contradiction-candidates** — the seeded corpus was 30 distinct topics
  (content cosine maxes at 0.61, never ≥ 0.7). The geometry needs
  content-similar / causal-different clusters; re-test with a purpose-built
  clustered corpus.
- **Design concern beyond the `|| event.label` fix:** causal = the user
  _question_ is a **subset of** content = _question + answer_, so causal still
  tracks content rather than being an independent WHY. And `context` is
  boilerplate (cosine ≈ 0.95). Both weaken the contradiction geometry.

**Verdict: HALT the `pipeline-analyst-llm` flip** pending FACET-FIX-2 (give causal
an independent WHY-signal + context a real WHERE-signal) or an empirical
clustered before/after that demonstrates separation. See SESSION-HANDOFF.
