# LOCK-IN-1 — make the test honest; verify the live pipeline for real

**Date:** 2026-06-17 · **Branch:** `claude/sprint-handoff-continuation-0datpq`
(PR #11) · **Status:** ✅ E2E gate hardened (false-green now structurally
impossible) · ✅ live indexing verified for real · ✅ GRAPH-WIRE-1 checkpoint
confirmed · ⚠️ exposed a real pre-existing consolidation bug (reported, not
swallowed).

**One-line:** the E2E harness used to report green while _nothing was indexed_
(soft WARN + keyword fallback). It now hard-asserts, at the DB level, that a save
actually produced embeddings — and that honest test, run live post env-fix,
passes for real. The same honesty exposed a latent archivist crash.

---

## 1. What changed in the gate (`deploy/e2e-smoke.ts`)

The retrieval check was a soft `WARN`: "tool responded but sentinel not surfaced
… soft pass." Combined with `query_index`'s keyword fallback over raw
`chat_conversations`, a completely dead pipeline (0 embeddings) still passed.

Replaced it with **hard DB-level assertions** (logic from
`scripts/preflight/verify-pipeline.ts`). After the sentinel `save_conversation`,
the harness polls the DB and requires **all** of:

- `index_records` delta ≥ 1
- `document_chunks` delta ≥ 1
- `llm_usage` delta ≥ 1 (proves an embedding call actually happened)
- `raw_files` delta ≥ 1
- a **real index hit**: an `index_records` row whose `embedding_text` matches the
  sentinel **AND `embedding IS NOT NULL`** — i.e. it came through the embedded
  path, not the `ilike` keyword fallback.

Any failure → the check records `FAIL` → non-zero exit. Additional hardening:

- **DATABASE_URL is now required** when the loop runs. Without DB access we can't
  prove indexing, so a "green" is refused (hard FAIL, not skip). It must be a
  **real shell env var** — a dotenv-in-script load is too late (the db module
  picks Postgres-vs-PGlite at import; see PIPELINE-FIX-1).
- The "real index hit" is asserted **against the DB**, not by parsing
  `query_index`'s text — sidestepping HALT-condition #2 (the response doesn't
  label fallback vs indexed; the DB does, unambiguously).

## 2. The assertion is load-bearing (acceptance #1)

The verdict is a pure function `evaluateIndexing(before, after, realIndexHit)`,
exercised by a no-network/no-DB self-test (`E2E_SELFTEST=1 tsx deploy/e2e-smoke.ts`):

```
healthy case      → ok=true  (expected true)
dead-pipeline case → ok=false (expected false);
  failures: index_records did not grow (delta=0); document_chunks did not grow
  (delta=0); llm_usage did not grow (delta=0); no real index hit (...)
✅ SELF-TEST PASSED — a dead pipeline FAILS the gate. False-green is structurally impossible.
```

The "dead-pipeline" case mirrors the exact PIPELINE-FIX-1 pre-fix state
(`llm_usage` delta = 0, conversation persisted but nothing embedded) — and it
**fails**, which is the whole point.

## 3. Hardened E2E vs the live deploy (acceptance #2) — GREEN for real

`E2E_URL=…production… E2E_MCP_KEY=wsp_… DATABASE_URL=…live… tsx deploy/e2e-smoke.ts`

```
✅ GET /health — 200
✅ DB snapshot (before) — idx=31 chunks=31 llm=11 raw=31
✅ save_conversation — saved
   [attempt 1] deltas idx=+0 chunks=+0 llm=+0 raw=+1 realHit=false
   [attempt 2] deltas idx=+1 chunks=+1 llm=+1 raw=+1 realHit=true
✅ indexing (DB-verified) — all tracked tables grew + real index hit
✅ query_index real index hit — index_records row with non-null embedding matched the sentinel
✅ directory_query — reachable
✅ detect_contradictions — reachable (scope-gated)
E2E: 7 passed, 0 failed — exit 0
```

The four table deltas are each ≥ 1 and the embedded index hit is confirmed.
(Attempt 1 caught the `raw_file` before async embedding finished; the poll
resolves it — exactly the eventual-consistency the old soft-WARN papered over.)

## 4. GRAPH-WIRE-1 checkpoint (acceptance #3) — CONFIRMED

`scripts/preflight/verify-checkpoint.ts` runs a real archivist consolidation tick
through `runRoleGraph` (persist + Postgres checkpointer) and inspects the
LangGraph checkpoint tables:

```
checkpoint tables created:  YES  (checkpoints, checkpoint_blobs, checkpoint_writes, checkpoint_migrations)
checkpoint rows for thread_id="archivist:792d98b1…:e88d65de…:scheduled": 4 (grew 2 → 4)
✅ GRAPH-WIRE-1 CHECKPOINT CONFIRMED: the consolidation tick writes a durable checkpoint row.
```

The PostgresSaver created its tables on first use and wrote durable, thread-keyed
checkpoint rows for the tick — GRAPH-WIRE-1's one live-only acceptance item.

## ⚠️ Finding exposed by the honest verification — a real consolidation crash

The archivist consolidation **node itself threw** during the tick (the checkpoint
row is written at invoke-start, before the node body, so it lands regardless):

```
The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date
```

**Root cause (confirmed by isolated test):** a JS `Date` bound into a _raw_
drizzle `sql\`\``template fails on the live`postgres.js`driver —`sql\`… indexed_at > ${cutoff}\`` throws, while `${cutoff.toISOString()}`succeeds. It originates in`archivist.ts` `fetchTentativeRecords`
(`WHERE ir.indexed_at > ${cutoff}`), and is **systemic** (any raw-sql Date
interpolation, not just the archivist).

Why it went unnoticed: it's **pre-existing** (archivist.ts is _not_ in PR #11's
diff), the archivist had no records to consolidate until the pipeline was
repaired (PIPELINE-FIX-1), and the unit tests run on **PGlite**, which tolerates
the Date bind — another false-green that only a live, DB-asserted run catches.

**Impact / safety:** not triggered by current prod config (the consolidation
schedulers in `server-vault.ts` are OFF, so no `archivist_run`/`profiler_run` jobs
are enqueued). It does **not** block merging PR #11 (whose code doesn't introduce
it), but it **must be fixed before any consolidation scheduler/flag is enabled**.
Suggested follow-up **DATE-BIND-1**: grep all raw `sql\`\``templates for
interpolated`Date`values and convert to`.toISOString()`(or use the drizzle
query-builder comparators, which type the param). Quick local repro:`scripts/preflight/verify-checkpoint.ts`.

## Gates (acceptance #5)

- `@workspace/api` TS: **164** (= baseline, no regression) · `@workspace/shared`: **0**
- eslint `--max-warnings=0` on `deploy/e2e-smoke.ts` + `scripts/preflight/verify-checkpoint.ts`: clean
- No test regressions (gate change is in the live smoke harness, not unit suites)

## PR #11 — ready to merge (human's call), with eyes open

LOCK-IN-1's deliverables are done and PR #11 is **mergeable and verified** for what
it ships: the honest E2E gate, live-proven indexing, and the confirmed
checkpointer. **Merge is the human's call** (it auto-deploys `main`). Two caveats
to merge with — neither blocks the merge, both gate _enabling_ features:

1. **Do not flip `pipeline-analyst-llm`** — FACET-FIX-1's PRE-1 was HALT-leaning
   (facets already separated on `main`; causal=question is a subset of content;
   context is boilerplate). See PIPELINE-FIX-1 / FACET-FIX-1 reports.
2. **Do not enable any consolidation scheduler** until **DATE-BIND-1** is fixed
   (the archivist crash above). `pipeline-graph` ON is safe today because no jobs
   are enqueued.

## Artifacts

- Hardened gate: `deploy/e2e-smoke.ts` (snapshot: `_archive/2026-06-17-lock-in-1/e2e-smoke.ts`)
- New: `scripts/preflight/verify-checkpoint.ts`
- Reuses: `scripts/preflight/verify-pipeline.ts` (PIPELINE-FIX-1)
