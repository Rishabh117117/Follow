# DATE-BIND-1 — fix the raw-SQL Date-binding crash (archivist + GC)

**Date:** 2026-06-17 · **Branch:** `claude/sprint-handoff-continuation-0datpq`
(PR #11) · **Status:** ✅ both sites fixed · ✅ broad-grep clean · ✅ consolidation
runs live without the crash · ✅ load-bearing static guard added.

**One-line:** a JS `Date` interpolated into a raw drizzle `sql` template crashes
on production postgres.js (`"…Received an instance of Date"`) but is tolerated by
PGlite (the test DB) — so tests never caught it. Fixed both occurrences; the
archivist + GC consolidation now run on prod.

## Sites fixed

| File                             | Line | Before                          | After                       |
| -------------------------------- | ---- | ------------------------------- | --------------------------- |
| `services/pipeline/archivist.ts` | 180  | `AND ir.indexed_at > ${cutoff}` | `> ${cutoff.toISOString()}` |
| `services/pipeline/gc.ts`        | 91   | `OR ir.deleted_at < ${cutoff}`  | `< ${cutoff.toISOString()}` |

In both, `cutoff` is a JS `Date` (`new Date(Date.now() - …)`). Postgres compares a
`timestamptz` column against the ISO-8601 string correctly. Query-builder writes
like `.set({ hiddenAt: new Date() })` were **left untouched** — drizzle's builder
types those params, so `Date` is fine there; only raw `sql` template
interpolation is broken.

## Broad-grep result (acceptance: be thorough)

Searched all of `packages/api/src` for other raw `sql` templates interpolating a
JS `Date` value (comparison operators with `${…}`; `new Date`/`cutoff`/`since`/
`before`/`window`/`date` locals feeding a template; `new Date(...)` declarations
in the pipeline cross-checked against their template usage). **Only the two sites
above** qualified. Every other interpolation hit is a number (`minSimilarity`,
`newPageNumber`), a pgvector literal, an already-stringified value (`sinceStr`),
a column reference (`${table.col}`, which drizzle types), or an SVG/HTML/log
string. Confirmed `editor.ts` / `tombstone.ts` `new Date()` uses are all drizzle
`.set({...})` or `.toISOString()` — safe.

## Verified it actually runs (acceptance #2)

`DATABASE_URL` set as a **real shell env var** (not dotenv-in-script).

- **Archivist** — `scripts/preflight/verify-checkpoint.ts`: the archivist node
  now **completes** (`nodeLog: {node:'archivist', persist:true, tentatives:0, …}`,
  "consolidation completed: YES") — the Date-binding crash is gone; the
  `indexed_at > …` query executed (returned 0 in-window) instead of throwing. A
  durable checkpoint row landed (rows 4 → 7 for `thread_id=archivist:…:scheduled`).
- **GC** — ran `runTombstoneGC()` against live Postgres: completed without the
  binding error (`{hardDeletedRecords:0, …}` — a clean no-op, as expected with no
  rows past the 30-day window).

## Regression guard — load-bearing, not faked (acceptance: don't fake it)

A PGlite unit test **cannot** catch this (PGlite tolerates the Date bind — that's
the whole problem). Added a **static source-scan** test instead:
`services/pipeline/__tests__/date-bind-guard.test.ts`. It collects each
pipeline-source local whose initializer contains `new Date(...)` (including
multi-line ternaries) and fails if any such local — or an inline `new Date(...)` —
is interpolated **bare** (no `.toISOString()`) into a `sql` template.

**Proven load-bearing:** run against the pre-fix snapshots in
`_archive/2026-06-17-date-bind-1/`, the guard **flags both** (`archivist.ts → ${cutoff}`,
`gc.ts → ${cutoff}`); against the fixed source it **passes** (17/17). The first
draft of the guard missed the archivist case (its `cutoff` is a multi-line
ternary, not `= new Date(...)` on one line) — caught by the snapshot proof and
fixed before commit, so the guard genuinely covers the exact bug it guards.

## Incidental cleanup

Removed a pre-existing **dead import** in `gc.ts` (`episodes` from the
semantic-index schema — line 138's `UPDATE episodes` is a raw-SQL literal, not a
use of the imported symbol). It was a relaxed-config warning in `_archive` but an
**error** under the main tree's `no-unused-vars`, so it blocked the commit hook
once `gc.ts` was touched. No behavior change.

## Gates (acceptance #3)

- `@workspace/api` TS: **164** (= baseline, no regression) · `@workspace/shared`: **0**
- eslint `--max-warnings=0` on `archivist.ts` + `gc.ts` + the new guard test: clean
- Pipeline suites green: `graph` (role-graph 3 + shadow 3), `date-bind-guard` (17),
  `facet-signal` (7), `anchor-writer` (6), `split-roles` (6) — 42/42.

## Follow-up filed — PG-FIDELITY-1 (not in this sprint)

The deeper issue: **PGlite (test DB) tolerates what production postgres.js
rejects**, so a whole class of prod-only bugs sails through CI. This is the
**second** false-green class hit this run (after LOCK-IN-1's soft-WARN). The
static guard closes the _Date-in-raw-sql_ instance, not the class. Options for
later: a Postgres-backed test slice in CI, or a lint rule banning `Date` values
in raw `sql` templates repo-wide. Flagged as a task chip; not solved here.

## Artifacts

- Fixed: `services/pipeline/archivist.ts`, `services/pipeline/gc.ts`
- New guard: `services/pipeline/__tests__/date-bind-guard.test.ts`
- Snapshots: `_archive/2026-06-17-date-bind-1/{archivist,gc}.ts`
- Repro: `scripts/preflight/verify-checkpoint.ts`
