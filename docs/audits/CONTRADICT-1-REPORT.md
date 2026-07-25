# CONTRADICT-1 — contradiction detection, working end-to-end

**Date:** 2026-06-20 · **Branch:** `claude/contradict-1` (off `main`) · **Status:**
✅ a planted contradiction is detected by ANALYST, written as a `contradicts`
edge, and surfaced through the bridge with both sides + the reason — proven live.
**The `pipeline-analyst-llm` flip is NOT merged to prod** (left for the human; see
recommendation).

**One-line:** ANALYST now judges textually-similar pairs, writes a `contradicts`
edge to `semanticLinks`, and a new read-side bridge surfaces those edges (both
record texts + contributors + `metadata.analyst.reason`) through
`detect_contradictions`. Verified on a purpose-built corpus where two notes
genuinely conflict.

## Step 0 — the two disconnected systems (confirmed against live code)

- **Writer:** `indexer.detectAndInsertLinks` → when `pipeline-analyst-llm` is on →
  `classifyEdge` (ANALYST LLM) → `semanticLinks` rows: `linkType='contradicts'`
  (exact enum value, `analyst.ts`), `metadata.analyst.{reason,confidence,directionality}`,
  `crossUser`, `similarity`. Thresholds: same-thread 0.55 / cross-thread 0.65.
- **Reader (old):** `detect_contradictions` read **only** `documentSharedState.state.tensions`
  (a separate ai-state pipeline). It never touched `semanticLinks`. **No bridge.**

## Bridge direction chosen: **read-side**

ANALYST writes edges; the surface should read edges. Added
`services/contradictions/edges.ts`:

- `getContradictionEdges({ workspaceId, topic? })` — reads `contradicts` edges for
  a workspace, resolves **both** records (text, contributor, document title) in one
  round-trip, returns `{source, target, reason, confidence, similarity, crossUser}`.
  Reason falls back `metadata.analyst.reason → reason` column; skips edges whose
  records were hard-deleted; optional case-insensitive topic filter.
- `formatContradictionEdges()` — renders both sides + reason + confidence.

Wired into `detect_contradictions` (it now appends the ANALYST edges to its
output, alongside the legacy tensions path). The ai-state `tensions` path is left
untouched. Unit tests: `services/contradictions/__tests__/edges.test.ts` (6).

## The fix that made it actually work (root cause)

Turning the flag on alone produced **zero** edges. Diagnosis from the live run:
ANALYST **fired** (so the corpus/threshold were fine — that HALT is ruled out),
but every call failed JSON parsing (`length=0`, `Unterminated string`). Root
cause: the ANALYST tier model **`deepseek/deepseek-v4-pro` is a reasoning model**
— it spends completion tokens on a `reasoning` preamble before the JSON `content`.
`classifyEdge` capped `maxTokens: 300`, so the reasoning starved the JSON. Fixes:

- `analyst.ts`: `maxTokens` **300 → 1500** (room for reasoning + the small verdict JSON).
- `AnalystResponseSchema.reason`: `max(160) → max(400)` — the reasoning model
  writes 1–2 sentence reasons; 160 was dropping otherwise-valid verdicts.

## Verified end-to-end (live Postgres, ANALYST on)

`scripts/preflight/verify-contradiction.ts` indexes each clustered pair (note A,
then note B as a separate conversation so they cross-link) through the real
chat-fact-extractor → indexer → `detectAndInsertLinks` → ANALYST path, then reads
back through `getContradictionEdges`. Result: **4 `contradicts` edges** (+4), all
three planted contradictions surfaced with both sides + reason:

| Pair                                  | Similarity | Conf | ANALYST reason (verbatim)                                                                                                                   |
| ------------------------------------- | ---------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth: server-side sessions **vs** JWT | 94%        | 80%  | "A claims stateful sessions, no JWT; B claims stateless JWT tokens; directly contradictory."                                                |
| Launch date: March 15 **vs** April 20 | 88%        | 80%  | "A states the launch date is locked to March 15, while B states it moved to April 20 — direct semantic opposition on the same proposition." |
| Session cache: Postgres **vs** Redis  | 87%        | 70%  | "Both claims directly conflict on the chosen technology for session cache (Postgres vs Redis)."                                             |

(The corpus pairs live in `scripts/preflight/seed-corpus.ts` `CONTRADICTION_PAIRS`,
also seedable over a flag-on deploy via `SEED_MODE=contradictions`.)

## Cost (acceptance #3)

deepseek-v4-pro on OpenRouter: **$0.435 / $0.870 per Mtok** (prompt / completion).
Observed per ANALYST classify call: **~989 input + ~393 output tokens ≈ $0.00077/call**
(the output is higher than a non-reasoning model because of the reasoning preamble).
One classify call == one qualifying pair, so **≈ $0.0008 per classified pair**.
Even at 1,000 qualifying pairs/day that's **< $1/day**. Affordable.

> Note: `llm_usage.cost_usd` logged **$0** for these calls — the local pricing
> table (`models.ts`) has no entry for `deepseek-v4-pro`, so the dashboard
> under-reports ANALYST cost. Real cost is computed above from OpenRouter pricing.
> Follow-up: add the price to `models.ts` so `llm_usage` is accurate.

## Gates (acceptance #4)

- `@workspace/api` TS: **164** (= baseline) · `@workspace/shared`: **0** · eslint clean.
- Tests: new `contradictions/edges` (6); no regression in `analyst-link` (3) or `facet-signal` (7) — 16/16.

## Recommendation / merge gate (acceptance #5)

**`pipeline-analyst-llm` is flipped ON only on this branch — NOT merged to prod.**
The contradiction loop works and cost is cheap (~$0.0008/pair). Recommendation:
**safe to merge the flag flip** after this review — but note two things first:

1. ANALYST runs on **every** cosine-near pair during indexing. At current prod
   volume that's negligible; watch `llm_usage` (tier ANALYST) after enabling.
2. Add `deepseek-v4-pro` pricing to `models.ts` first so cost is actually tracked.

Non-blocking observations:

- `[Reflector] … 429` warnings during the run are a **separate** ai-state
  component (not ANALYST), non-fatal, pre-existing.
- Test data (titles `[CONTRADICT-1] *`) is disposable in the live DB.

## Artifacts

- Bridge: `services/contradictions/edges.ts` (+ test)
- Tool wiring: `mcp/tools/detect-contradictions.ts`
- Flag + ANALYST fixes: `config/server-vault.ts`, `services/pipeline/analyst.ts`
- Corpus + verifier: `scripts/preflight/{seed-corpus,verify-contradiction}.ts`
