# ANALYST-ON-1 — switch on the ANALYST edge classifier

**Date:** 2026-06-16
**Branch:** `claude/sprint-handoff-continuation-0datpq` (session-pinned branch;
the sprint allowed reusing the session's branch convention). Stacked on the
GRAPH-WIRE-1 work in the same branch / PR #11.

## Outcome (TL;DR)

The ANALYST edge classifier is now **production-ready** — but the flag is
**deliberately left OFF**. The two code fixes (FIX-1, FIX-2a) and the PRE-1 gate
script are landed; they are behavior-neutral while the flag is off. The flag
flip is **gated on PRE-1/PRE-2, which require a live Postgres + minted key that
this sandbox does not have**, and PRE-1 guards against a degeneracy risk I found
by reading the facet composition (below). Per the sprint's own HALT discipline
("if degenerate → do NOT flip"), flipping blind here would be wrong. The flip +
measurement are handed off to an operator with deploy access, with a runbook.

This decision was put to the user, who delegated it back ("let you decide").

## FIX-1 — ANALYST now sees BOTH texts

**Verified the stale comment was wrong:** the new record's text _is_ available.
`insertValues[i].embeddingText` is set to `composedTexts[i]` (indexer.ts:332) and
already read elsewhere (anchor write :446, evidence :488). The old code passed
`b.text: ''` so the model classified a relationship seeing only the candidate
side at full `deepseek-v4-pro` cost.

Threaded the new record's own `embeddingText` + identity into
`detectAndInsertLinks` via `linkValues` (added `embeddingText`, `documentTitle`,
`userName`, `eventTime`, `metadata`), and built a symmetric `b` object
(`text`, `documentTitle`, `contributor`, `timestamp`, `topics`) mirroring the
candidate `a`. The `.slice(0,320)` cap in `analyst.ts` is untouched (cost).

**Acceptance:** `analyst-link.test.ts` asserts `classifyEdge` receives `a.text`
and `b.text` both non-empty for a normal pair, plus the new side's identity
fields.

## FIX-2 — choice: (2a) parallelize within a record

Chose **2a** (the sprint's recommendation): the nested `for` loops no longer
`await` each `classifyEdge` sequentially. The loop now **collects qualifying
(new × candidate) pairs**, then classifies them with **bounded concurrency**
(`mapWithConcurrency`, limit `ANALYST_CONCURRENCY = 5`). Worst case was
`inserted × 20` sequential deepseek calls inline in indexing (~tens of seconds);
now at most 5 are in flight. The heuristic path stays byte-identical (it builds
links inline from the same qualifying pairs — no I/O, no concurrency needed).
2b (defer to a queue `analyst_run` job) is **out of scope → ANALYST-ON-2**.

**Acceptance:** `analyst-link.test.ts` drives 12 qualifying candidates through a
latency-instrumented `classifyEdge` mock and asserts `1 < maxInFlight ≤ 5`
(actually parallel, properly bounded).

## Pre-flight gates — status

These need live Postgres / a minted `wsp_` key. **This sandbox has neither**
(`DATABASE_URL` unset → PGlite fallback; no `data/model-overrides.json`). So they
are **handed off, not run.**

### PRE-1 — facet separation (GATE) — script landed, run pending

`scripts/preflight/facet-separation.ts` samples ~500 `index_records` with full
facet triples, computes per-facet pairwise cosines over ~2000 random pairs, and
reports: per-facet distributions (min/median/mean/p90/max), **Pearson r between
the content-cosine and causal-cosine series**, the contradiction-candidate count
(content ≥ 0.7 AND causal ≤ 0.45), and the above-threshold count (cost dry-run).
The script self-flags `r ≥ 0.95` as DEGENERATE → do not flip.

**Smoke-tested in-sandbox:** env loading + DB connect + drizzle `execute()` +
the return-shape normalization all run; the full report needs a live, migrated
Postgres (the PGlite fallback lacks the migrated `index_records` schema).

**Degeneracy risk I found by reading the code (this is _why_ PRE-1 is a real
gate):** `composeCausalFacet` returns `parts.join('. ') || event.label`
(compose-embedding-text.ts:231) — i.e. it **falls back to `event.label`** when a
record has no `contextNotes` / `chatQuestion` / `outcome` / `keyChange`. And
`composeContentFacet` _leads_ with `event.label` (:192). For any record lacking
causal signal, the content and causal embeddings will be near-identical, and the
content/causal cosines will correlate → exactly the degenerate case PRE-1
catches. How pervasive this is depends on how many real records carry causal
signal — **only PRE-1 on live data can answer.** If PRE-1 fails, fix the causal
composition (e.g. drop the `|| event.label` fallback, or compose a distinct
"no explicit reason" sentinel) before flipping.

### PRE-2 — live model + cost — pending

No `data/model-overrides.json` in-repo (gitignored; the live override may differ
from the `deepseek/deepseek-v4-pro` default). Operator: read
`GET /api/models/overrides` (or the live file), look up the OpenRouter per-token
price, multiply by PRE-1's pairs/run for cost/index-batch.

### PRE-3 — priors (informational)

`pattern_edge_priors` is written by PROFILER/`commitProfiler`. If PROFILER hasn't
run it's empty and `fetchEdgePriors` degrades silently (already try/caught).
Can't observe population without the live DB; non-blocking either way.

## Measurement — pending (needs flag on + live LLM + DB)

Edges/run, edge-type distribution, cost/run (`llm_usage` rows tagged
`analyst:classify_pair`), latency delta vs heuristic, 10 `reason` samples, and
contradiction-surfacing confirmation are all to be captured by the operator on
the first flag-on seeded run. None are runnable here.

## Gates (acceptance #5)

- `@workspace/api` TS errors: **164** (= baseline).
- `@workspace/shared` TS errors: **0**.
- ESLint (`--max-warnings=0`) on touched files: clean.
- New `analyst-link.test.ts`: **3/3 green** (FIX-1 both-texts + symmetry; FIX-2a
  bounded concurrency; rollback heuristic path). `facet-signal.test.ts` (7) still
  green. The root PRE-1 script is outside any package's typecheck scope.

## Operator runbook (to finish the sprint)

1. `DATABASE_URL=<prod> npx tsx scripts/preflight/facet-separation.ts` → read the
   Pearson r + contradiction-candidate count. If `r ≥ 0.95` (degenerate) → STOP,
   fix the causal facet, re-run. (PRE-1)
2. Read the live ANALYST model + price; compute cost/index-batch from PRE-1's
   pair count. If over budget → tighten concurrency/candidate filter/tier. (PRE-2)
3. If both pass: set `pipeline-analyst-llm: { active: true }` in
   `server-vault.ts`, restart the API.
4. Seed a sample run; capture the Measurement metrics above and confirm
   `detect_contradictions` returns LLM-verified tensions (acceptance #3).

## Rollback

Flip `pipeline-analyst-llm: false` → the indexer's `else` branch runs the
`classifyLinkType` heuristic verbatim. FIX-1/FIX-2a only shape the LLM path's
input/concurrency and are no-ops when the flag is off (proven by the rollback
test), so they stay.

## Deviations from the prompt

- **Flag left OFF** (sprint headline is "switch on") — because the authorizing
  gates (PRE-1/PRE-2) cannot run in this sandbox and PRE-1 guards a real
  degeneracy risk. Honors the sprint's HALT condition rather than flipping blind.
  User delegated the call.
- **PRE-1 script path** is the sprint's `scripts/preflight/facet-separation.ts`;
  it imports the api package's `db` via relative path and runs under `tsx`.
- The link function is named `detectAndInsertLinks` (sprint called it
  `linkRecords`); exported for the unit test.
