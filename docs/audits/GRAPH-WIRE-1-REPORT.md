# GRAPH-WIRE-1 — route the queue through the LangGraph harness

**Date:** 2026-06-16
**Branch:** `claude/sprint-handoff-continuation-0datpq` (per session branch directive; the
sprint prompt named `claude/graph-wire-1`, but the operating contract for this
session pins development to the continuation branch).
**Scope:** Put the LangGraph harness on the production path for pipeline
consolidation, with the Postgres checkpointer wired for durable/resumable runs —
**zero change to outputs.** Collapsing the two job types into one shared-state
`consolidation_run` remains out of scope (→ GRAPH-WIRE-2).

---

## What changed

| File                                                                    | Change                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/api/src/services/pipeline/graph/graph.ts`                     | Added single-role `buildArchivistGraph(checkpointer?)` / `buildProfilerGraph(checkpointer?)` — `START → role → END`, no reporter fact-gate. Checkpointer attached at compile time. `buildPipelineGraph` (ingest/shadow router) untouched.                                                                                                                                                    |
| `packages/api/src/services/pipeline/graph/index.ts`                     | Added `runRoleGraph({ role, userId, workspaceId, mode })`. Memoized Postgres checkpointer (one `setup()` per connection string); runs **checkpointer-less** when `DATABASE_URL` is absent. `persist: true`, stable `thread_id = role:userId:workspaceId:mode`, `events: []`.                                                                                                                 |
| `packages/api/src/services/pipeline/graph/nodes/index.ts`               | Enriched the archivist/profiler `nodeLog.counts` with `keptTentative` + `skipped` (archivist) and `skipped` (profiler), so the runner can log equivalently to the legacy lines. Counts only added on the `persist` branch → shadow path unchanged.                                                                                                                                           |
| `packages/api/src/services/pipeline/runner.ts`                          | `handleArchivistRun` / `handleProfilerRun` now route through `runRoleGraph(...)` when the `pipeline-graph` flag is on **and** `PIPELINE_GRAPH_DISABLE != 1`. Either lever reverts to the legacy direct `runArchivist`/`runProfiler`. Log lines preserved (suffixed `(graph)` / `(direct)`), read from the **last** `nodeLog` entry because append channels accumulate on a stable thread_id. |
| `packages/api/src/config/server-vault.ts`                               | Flipped `pipeline-graph` → `active: true`; description updated.                                                                                                                                                                                                                                                                                                                              |
| `packages/api/src/drizzle.config.ts`                                    | Added `tablesFilter: ['*', '!checkpoint*']` so future diff-based `generate`/`push` never drop the LangGraph checkpoint tables.                                                                                                                                                                                                                                                               |
| `packages/api/src/services/pipeline/graph/__tests__/role-graph.test.ts` | New — parity + no-checkpointer test (below).                                                                                                                                                                                                                                                                                                                                                 |
| `_archive/2026-06-16-graph-wire-1/`                                     | Pre-edit snapshots of runner, graph, graph index, server-vault.                                                                                                                                                                                                                                                                                                                              |

## Design notes / deviations

- **Single-role graphs (as specified).** A queue tick carries no events ⇒ the
  full router's `routeAfterReporter` returns `END` ⇒ archivist/profiler never
  run. So the queue path uses dedicated single-role graphs. Each job still runs
  exactly its one role via the SPLIT-1 `compute*`/`commit*` functions — identical
  outputs.

- **Checkpointer API verified against `@langchain/langgraph@1.3.4`.** `.compile()`
  accepts `{ checkpointer }` (compile-time), paired with
  `.invoke(input, { configurable: { thread_id } })`. No HALT.

- **Stable thread_id ⇒ append channels accumulate (verified empirically).** With
  an in-memory checkpointer and a stable `thread_id`, three successive
  `.invoke()`s **re-execute the node each time** (good — the role runs every
  tick) but the append-reducer channels (`nodeLog`, `contributors`) accumulate
  across ticks. This does **not** affect outputs: the role nodes read
  `state.meta` (last-write-wins merge), never `state.facts`/`nodeLog`, and the DB
  work is driven entirely by `{ userId, workspaceId, mode }`. The runner reads
  the **last** `nodeLog` entry for its log line. The accumulation lives only in
  the checkpoint row (tiny entries; bounded per (role,user,ws,mode) thread).
  Flagged as a minor follow-up — see "Known follow-ups".

- **Flag is a real gate.** Beyond the env switch, the runner honors
  `isServerFeatureActive('pipeline-graph')`, so the rollback runbook ("flip the
  flag off") actually reverts the runner — matching the prompt's Rollback
  section. Either lever is sufficient.

## Parity check (acceptance #5)

The role logic is reused verbatim — the graph nodes call the same SPLIT-1
`computeArchivist/commitArchivist` and `computeProfiler/commitProfiler` as the
direct path, with `persist: true`. There is no alternate write path. The new
test asserts the graph's reported counts equal `runArchivist`/`runProfiler` on a
seeded (mocked-deterministic) fixture; index_records/states are therefore
produced by identical code.

## New test (acceptance #1)

`graph/__tests__/role-graph.test.ts` (3 tests, all green):

1. archivist-via-graph commits once and its `nodeLog` counts
   (`promoted/demoted/superseded/keptTentative/skipped`) == direct `runArchivist`.
2. profiler-via-graph commits once and its counts
   (`patternsWritten/edgePriorsWritten/skipped`) == direct `runProfiler`.
3. runs with `DATABASE_URL` unset (no checkpointer) and still persists.

The pre-existing `shadow.test.ts` (3 tests) still passes.

## Gates (acceptance #2)

- `@workspace/api` TS errors: **164** (= baseline; the +2 introduced by the new
  test were `noUncheckedIndexedAccess` and were fixed).
- `@workspace/shared` TS errors: **0**.
- Pipeline test files (`graph/`, `split-roles`): **12/12 pass**.
- ESLint (`--max-warnings=0`) on all touched files: clean.
- Full `@workspace/api` suite in this sandbox is PGlite-flaky (no
  Docker/Postgres): the WASM saver aborts non-deterministically and cascades.
  Observed range across runs: clean tree 19 failed / changed tree 16 failed —
  **comparable; the failing files are all DB/integration-bound and unrelated to
  pipeline consolidation.** No regression attributable to this change.

## Checkpoint table confirmation (acceptance #3) — NOT RUNNABLE IN SANDBOX

This environment has no Postgres/Docker (the API suite falls back to PGlite),
so `saver.setup()` could not be exercised against a real Postgres, and no
checkpoint row could be observed. Verified by code/types instead:
`PostgresSaver.fromConnString(...).setup()` self-creates `checkpoints`,
`checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations` — distinct from
every Drizzle table (none start with `checkpoint`). `db:deploy` uses
`drizzle-kit migrate` (applies SQL files; never drops unknown tables), so the
checkpoint tables are safe at deploy; the new `tablesFilter` additionally
protects against diff-based commands. **Recommend the operator run an archivist
tick against the live/staging Postgres and confirm a `checkpoints` row before
relying on resume.**

## Live E2E (acceptance #4) — NOT RUN

Requires `E2E_URL` + `E2E_MCP_KEY` for the Railway deploy, which are not
available in this session. **Recommend running
`E2E_URL=… E2E_MCP_KEY=… pnpm --filter @workspace/api e2e` before merge.**

## Rollback

`PIPELINE_GRAPH_DISABLE=1` (runner → direct `runArchivist`/`runProfiler`) and/or
`pipeline-graph: { active: false }`. No schema destruction; checkpoint tables are
additive and harmless if unused.

## Known follow-ups

- **nodeLog accumulation on stable thread_id** — bounded and output-neutral, but
  if checkpoint-row growth becomes a concern, switch to a per-tick thread_id
  (e.g. append a timestamp) at the cost of automatic same-key resume, or prune
  old checkpoints. Track into GRAPH-WIRE-2.
- **GRAPH-WIRE-2** — collapse `archivist_run` + `profiler_run` into one
  shared-state `consolidation_run` (changes queue semantics + dedup).
