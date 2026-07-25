# SPLIT-1 — Archivist/Profiler compute↔commit split (2026-06-02)

Part of `master-run/2026-06-02`. **Behavior-preserving.** Makes the two persisting pipeline roles runnable read-only, so GRAPH-1 can shadow them.

## What changed

- **`archivist.ts`**: `runArchivist` split into
  - `computeArchivist(input): ArchivistComputation` — fetch tentatives + build frame + LLM decision. **Reads + LLM only, no writes.** Returns `{ input, tentatives, decisions | null }` (null = LLM failed).
  - `commitArchivist(computation): RunArchivistResult` — `applyDecisions` (every promote/supersede insert, demote/keep update).
  - `runArchivist = commitArchivist(await computeArchivist(input))` — unchanged signature & behavior.
- **`profiler.ts`**: `runProfiler` split into `computeProfiler` (gather slice + frame + LLM; `{ records, llmResponse|null, ran }`) and `commitProfiler` (`persistProfilerOutput` — pattern + edge-prior inserts). `runProfiler = commitProfiler(await computeProfiler(input))`.
- Removed a pre-existing dead `randomUUID` import in `archivist.ts` (lint hook).

The early-return semantics are preserved exactly: no tentatives ⇒ empty; LLM fail ⇒ `skipped = tentatives.length`; too few records (profiler) ⇒ `skipped: true`.

## Tests (`split-roles.test.ts`, 6 — db + LLM mocked)

- `computeArchivist` / `computeProfiler` perform reads + decision but **0 db writes** (insert/update/delete spies untouched).
- `commitArchivist` / `commitProfiler` **do** write (insert called; result counts correct).
- `runArchivist` / `runProfiler` equal compute-then-commit on the fixture.

## Gates

- api TS **164 → 164** (no new errors); shared/web TS 0.
- api tests **886 → 892 passing** (+6), 16 failing + 14 failing files unchanged. No regression. eslint clean.

Per-file commits prefixed `SPLIT-1:`.
