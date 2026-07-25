# GRAPH-1 — LangGraph harness landing (2026-06-02)

Part of `master-run/2026-06-02`. Additive, gated, **shadow** — the router-over-shared-state harness, proving the `totalFacts:0 / topicsCovered:[]` bug is structurally gone. Depends on SPLIT-1.

## Phase 1 — deps

Added `@langchain/langgraph` (1.3.4) + `@langchain/langgraph-checkpoint-postgres` to `packages/api`. (Side effect: `pg` entered the workspace, re-pinning drizzle-orm's pnpm peer-variant; a `pnpm install` reconciled `apps/web`'s symlink back to web TS 0.)

## Phase 2 — files

- `packages/shared/src/pipeline-state.ts` — the `PipelineState` Zod contract (`facts, edges, scores, episodes, profileDelta, retrievalTrace, contributors, nodeLog, meta.persist`) + `computeShadowVerdict()` (pure; pass ⟺ facts>0 ∧ topics>0).
- `packages/api/src/services/pipeline/graph/`:
  - `state.ts` — `Annotation.Root` mapping PipelineState onto LangGraph channels (append reducers ⇒ facts accumulate).
  - `nodes/index.ts` — reporter/archivist/profiler nodes. Archivist/Profiler call SPLIT-1's **`compute*` always, `commit*` only when `meta.persist`** ⇒ shadow performs no writes.
  - `graph.ts` — the router `StateGraph`: `START → reporter → (router on shared state) → archivist → profiler → END`. The router enters the persisting roles only when REPORTER produced facts.
  - `index.ts` — `runPipelineGraph()` + `shadowVerdict()` + lazy `getPostgresCheckpointer()` (durable/live path).

## Phase 3 — flag + observability

- `pipeline-graph` vault flag (default **off**).
- `dev-graph` route gains `GET /shadow`: when the flag is on, runs the harness in shadow on a fixture and returns `{ nodeLog, verdict }`; off ⇒ `{ active: false }`.

## Phase 4 — shadow test (`graph/__tests__/shadow.test.ts`, 3)

Drives reporter→archivist→profiler through the graph with the role internals mocked:

- **`shadowVerdict().pass`** — `facts > 0` and `topicsCovered` contains the seeded topic; nodeLog spans reporter/archivist/profiler.
- shadow (persist=false) performs **no commits** (`commit*` never called).
- router over shared state: no facts ⇒ persisting roles skipped, verdict fails.

## Gates

- shared TS 0; web TS **0** (restored after `pnpm install`); api TS **164 → 164**.
- api tests **892 → 895 passing** (+3), 16 failing + 14 failing files unchanged; web tests 956/13 unchanged. eslint clean.

**Done:** flag off ⇒ the live pipeline (runner → `runArchivist`/`runProfiler`) is untouched and byte-identical; flag on shadow ⇒ verdict passes. Per-file commits prefixed `GRAPH-1:`.
