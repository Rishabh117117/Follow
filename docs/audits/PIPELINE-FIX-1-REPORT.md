# PIPELINE-FIX-1 — the live indexing pipeline was broken; root-caused & fixed

**Date:** 2026-06-17 · **Env:** new local env (Windows) driving the live Railway
deploy + prod Postgres over the public proxy. · **Branch:**
`claude/sprint-handoff-continuation-0datpq` (PR #11).

**One-line:** the production indexing pipeline had **never indexed anything** —
two Railway env-var misconfigurations silently killed every embedding and every
S3 write. Fixed via env vars + redeploy; verified end-to-end. This invalidates
the prior handoff's "loop proven live" claim and **gates all three sprints**
(they operate on embeddings that weren't being produced).

---

## How it was found

The prior handoff said the e2e loop was "proven green (5 passed)". A DB-observed
round-trip (push a sentinel via MCP `save_conversation`, then poll the **DB**, not
just the tool response) showed otherwise:

| Signal                                          | Result                                        |
| ----------------------------------------------- | --------------------------------------------- |
| `chat_conversations`                            | grows (save persists) ✅                      |
| `query_index` returns the sentinel              | ✅ — **but via raw-text fallback**, see below |
| `index_records`, `document_chunks`, `raw_files` | **0**                                         |
| `llm_usage` (any embedding call, ever)          | **0**                                         |
| `/api/health` (deep check)                      | **503**                                       |

**Why the e2e looked green:** its retrieval assertion is a soft `WARN`
(`deploy/e2e-smoke.ts` ~L159-167), and `query_index` falls back to keyword
search over raw `chat_conversations` when the LLM reference-agent errors. So it
"retrieved" sentinels with **nothing indexed** — a false green.

## Root causes (both Railway env-var misconfig on the `workspace-platform` service)

Confirmed from the live deploy logs:

```
Code: 'InvalidAccessKeyId', BucketName: 'follow'        ← S3 PutObject rejected
[Embedding] Retry 1/3 … 401 Missing Authentication header
[Embedding] Retry 2/3 … 401 …
[Embedding] Retry 3/3 … 401 …                           ← OpenRouter key undefined
[ReferenceAgent] Classifier failed, falling back to simple: … 401   ← the false-green path
```

1. **OpenRouter key var was named `Openrouter`**; all code reads
   `process.env['OPENROUTER_API_KEY']` (`config/env.ts`, `lib/ai-client.ts`,
   `services/embedding.ts`, …). → undefined → every embedding 401s.
2. **`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` did not match MinIO's**
   `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` → `storeRawFile`'s `uploadBuffer`
   (lib/s3.ts) throws `InvalidAccessKeyId`. Endpoint
   (`http://minio.railway.internal:9000`) and bucket (`follow`) were correct.

Both failures are swallowed by `save_conversation`'s `triggerIndexing()`
fire-and-forget `console.warn` catches (`mcp/tools/save-conversation.ts`
L822-906), so the tool returned success while indexing silently failed.

## The fix (applied via Railway project token, one redeploy)

On `workspace-platform` (production):

- set **`OPENROUTER_API_KEY`** = (value of the existing `Openrouter` var)
- set **`S3_ACCESS_KEY_ID`** = MinIO `MINIO_ROOT_USER`
- set **`S3_SECRET_ACCESS_KEY`** = MinIO `MINIO_ROOT_PASSWORD`

(The misnamed `Openrouter` var was left in place — harmless duplicate; remove at
leisure.)

## Verification (after redeploy)

A single `save_conversation` now grows `index_records +1`, `document_chunks +1`,
`llm_usage +1`, `raw_files +1`, and `query_index` returns a **real index hit** —
on the first poll. Pipeline confirmed working end-to-end.

## Residual (non-blocking)

- **ClickHouse `fallback`** → `/api/health` returns 503 "degraded" (postgres,
  redis, s3 all `ok`). ClickHouse is the signals/analytics store, off the
  `save_conversation → embeddings → index_records` path. Investigate separately
  (likely `CLICKHOUSE_URL`/auth at startup).
- Disposable prod test data: `[before-main] *` (30) + `VERIFY *` / `LOGPROBE *`
  convos, and the `deploy-smoke@follow.test` user.

## New diagnostics (committed under `scripts/preflight/`)

- `verify-pipeline.ts` — DB-verified MCP round-trip (the test that found this).
- `facet-census.ts`, `db-state.ts` — read-only corpus/table censuses.
- `seed-corpus.ts` — seed a varied corpus via `save_conversation` for the gate.

Run with `DATABASE_URL` set as a **real shell env var** (not just `.env.local` —
ESM import hoisting makes the dotenv-in-script approach fall back to PGlite).

---

## Impact on the three sprints

All three (FACET-FIX-1 / ANALYST-ON-1 / GRAPH-WIRE-1) consume embeddings that
were never produced, so **none of their live gates could ever have run** before
this fix. With the pipeline working, the FACET-FIX-1 PRE-1 gate was run for the
first time — see **FACET-FIX-1-REPORT.md** addendum / SESSION-HANDOFF for the
(inconclusive, HALT-leaning) result.
