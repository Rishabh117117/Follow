# VERSION-B1 — Re-synced documents retire their old facts (current excludes superseded)

**Type:** EXECUTION sprint. **Base:** `claude/version-b1` off **`claude/doc-facts-b0`** (`3fd9d3f`, B-0/PR #21). **Date:** 2026-06-24/25.
**Branch + PR only — NOT merged, NOT deployed** (end-of-arc merge). Phase 4 prod probe was owner-approved and torn down to exact baseline.

**Goal (delivered):** when a document changes and a new `source_version` lands, the prior version's facts whose content is gone
are marked `superseded_at`, and normal retrieval returns only current facts — while **every existing current fact still
returns**. Structured "as of version" point-in-time and the `[SUPERSEDED]` surface tag are **explicitly deferred** (see end).

---

## What changed (by phase, with `file:line`)

### Phase 1 — schema

- `db/schema/semantic-index.ts:139` — new nullable `supersededAt: timestamp('superseded_at', { withTimezone: true })` on `index_records` (NULL = current; distinct from `hidden` and `deleted_at`).
- `db/migrations/0001_living_night_nurse.sql` — `ALTER TABLE "index_records" ADD COLUMN "superseded_at" timestamp with time zone;` (offline-generated; deploys with the merge).
- `db/index.ts:806` — same column added to the hand-maintained PGlite (dev/test) DDL so PGlite stays in parity.

### Phase 2 — the write (carry-forward + sweep), in the only versioned-fact producer

- `services/semantic-index/indexer.ts:81` — exported `resolveSourceVersion` so the extractor resolves `N` with the exact logic the indexer stamps (no drift).
- `services/semantic-index/doc-fact-extractor.ts`:
  - `existingDocFacts()` now returns `{ id, hash, sourceVersion, supersededAt }` (was a hash Set) — drives both the salience dedup and the carry-forward.
  - `planDocSupersession(existing, incomingHashes, newVersion)` — **pure** decision: `carryForwardIds` (content still present → re-stamp to N, revive if superseded) and `supersededIds` (content gone AND older version AND not already superseded). Unversioned facts are left untouched.
  - `extractAndIndexDocFacts()` now: resolve `N` → load existing → carry-forward `UPDATE source_version=N, superseded_at=NULL` → insert new chunks (unchanged B-0 path) → sweep `UPDATE superseded_at=now()` on `supersededIds`. Guarded on non-null `N`; runs even when 0 new facts (removal-only edits). `now()` via `sql` (not a JS `Date`) to avoid DATE-BIND-1.

### Phase 3 — the read filter (the highest-risk edit)

- `services/semantic-index/current-fact-filter.ts` — NEW shared `currentFactConditions()` → `[isNull(supersededAt), isNull(deletedAt), eq(hidden, false)]`. **Filters `superseded_at` only — never `source_version`** (the entire-index-drop invariant).
- `services/reference-agent/retriever.ts:306` (`retrieveFromIndexRecords`) — applies `currentFactConditions()` (was unfiltered).
- `services/query/runner.ts:46` (`runStructuredQuery`) — applies `currentFactConditions()` (was unfiltered).
- `services/semantic-index/query-executor.ts:122` (`executeIndexQuery`) — adds `superseded_at IS NULL` (already filtered `hidden`+`deleted`).
- (Both `retriever`/`runner` edits also close a pre-existing `hidden`/tombstone leak on those paths.)

> **Coverage (Phase 0 gating verdict):** these are the only `index_records` readers that serve _current_ facts to chat/MCP answers. `retrieveFromIndexStates` (the point-in-time path) is intentionally untouched — it returns old versions by design. ~30 other `from(indexRecords)` sites are write-pipeline / counts / admin and are out of scope.

---

## Phase 0 confirmations

- **Columns:** `source_file_id` + `source_version` (from B-0) present; **`hidden` and `deleted_at` are on `index_records` itself** (`:130`, `:145`) → the leak-bundle was applied. Composite index `idx_index_records_source_file_version` serves the sweep.
- **The B-0×B-1 interaction (caught in Phase 0, settled by owner):** B-0's content-hash dedup is **cross-version** (`existingChunkHashes` filters `sourceFileId` + `isNull(deletedAt)`, no version filter), so a _partial_ re-sync leaves unchanged chunks at the old version. A blunt `source_version < N` sweep would have retired those still-valid facts. Owner chose **carry-forward re-stamp**: unchanged content is bumped to `N` (never lost); only removed content is superseded. This moved the supersession logic into the doc extractor (it alone knows the incoming chunk set).
- **Baseline:** API `tsc` = 164 errors; held at 164 through every phase.

## The gate test (Phase 3)

`services/semantic-index/__tests__/current-fact-filter.test.ts` (7 tests):

- Renders `currentFactConditions()` to SQL and asserts it references `superseded_at`/`deleted_at`/`hidden` and **never `source_version`**.
- Ephemeral-PGlite partition: current facts (including a **versioned** doc fact, `source_version=2`) return; superseded/deleted/hidden excluded; a chat-only (null-version) workspace still returns its live facts.

`__tests__/doc-fact-supersession.test.ts` (9 tests) covers the write decision incl. **the safety guarantee: a fact whose content is still present is NEVER superseded**, revive-on-reappear, removal-only edits, and unversioned-untouched.

---

## Phase 4 — prod probe (owner-approved; torn down to exact baseline)

Because B-1 (and B-0/PR #21) is not deployed and prod lacked `superseded_at`, the probe (owner-approved) added the column temporarily, ran the **real B-1 code** against the prod public-proxy DB with a sentinel native doc, and **dropped the column + deleted all sentinels** in a `finally`. Raw evidence:

```
BASELINE  index_records=57  index_record_states=180  semantic_links=42  (real workspace facts=57)

v1 index (A,B,C)  -> factsIndexed:3  carriedForward:0  superseded:0
   facts: [sv:1 superseded:false] x3

re-sync v2 (A,B kept / C removed / D new)  -> factsIndexed:1  droppedDuplicate:2  carriedForward:2  superseded:1
   facts: [sv:1 superseded:true (C)] [sv:2] [sv:2] [sv:2]

READ-FILTER (real currentFactConditions vs prod postgres.js): 3 current facts (sv:2), C excluded
   VERDICT supersedes-removed-content: PASS (C/Gamma excluded)
   VERDICT carry-forward-kept-content: PASS (A,B,D present)
   57-unaffected: PASS (real workspace still 57)

AFTER-TEARDOWN  index_records=57  index_record_states=180  semantic_links=42  (real=57)   BASELINE-MATCH: PASS
```

Independent post-probe verification: `superseded_at` column gone (so migration `0001` applies cleanly at merge), zero `__VERB1__` rows, counts at exact baseline. The probe proved the carry-forward + sweep (`sql\`now()\``) and the read filter all work against **real postgres.js** (no DATE-BIND-1), and that re-sync retires only removed content while keeping carried-forward content live.

---

## Phase 5 — regression (NO deploy)

- **Chat-fact path unaffected:** chat facts have null `source_version` (never swept; the doc extractor is the only sweeper, guarded on non-null `N`) and null `superseded_at` (always pass the read filter). The gate test confirms a null-version workspace still returns its facts.
- **tsc parity:** API 164 = baseline 164 (every phase). Web untouched.
- **Test parity:** full API suite = **14 failed test files | 98 passed** — exactly the known PGlite/browser-flake baseline (16 failed tests, within the documented 16–64 swing). The 14 failing files are all the known integration/route/browser family; **none are in the edit area** (semantic-index / reference-agent / query). All edit-area test files pass in isolation (37 + 7 gate).

---

## Deferred (explicitly out of scope — for a later sprint)

- **Structured point-in-time** ("as of version/date") — the NL `temporalHint` → `asOfTimestamp` path (`retrieveFromIndexStates`) is untouched and carries known latent bugs (drops `timeRange`, drops `supersededBy`, no `deletedAt` filter, a false "static-preferred" docstring) — see [VERSION-RECON-1](VERSION-RECON-1.md).
- **The `[SUPERSEDED]` surface tag** — belongs with the point-in-time work (superseded facts no longer appear in normal retrieval once filtered). The SCOPE-A-1 `assembler.ts:208` contested hook is the reusable insertion point.
- **Drive (`gws`) ingestion** and **section-level distillation** — unchanged.

## Definition of done — met

Re-syncing a document to a new version marks the prior version's removed facts `superseded_at`, normal retrieval returns only current facts (incl. carried-forward unchanged content), and every existing current fact still returns (the gate test + the prod probe's "57 unaffected"). `source_version` is now first populated (B-0) and supersession-aware (B-1). Branch + PR; **not merged, not deployed.**

_No source merged. No deploy. The Phase 4 probe was the only prod write — fully torn down to baseline._
