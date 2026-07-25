# MIGRATE-1 — Regenerate the Drizzle baseline, switch deploys `push --force` → `migrate`

**Date:** 2026-06-15 · **Branch:** `claude/drizzle-baseline-migrate-vg3l3a` → PR
**Repo:** `Rishabh117117/workspace-platform` · **Backend:** `@workspace/api` (`packages/api`)

---

## Summary

Before this sprint, the Drizzle migration journal was **stale**: 8 `.sql` files
on disk (`0000`–`0007`) but only **3** journaled, and **no migration at all for
`anchors` / `anchor_edges`**. A fresh `drizzle-kit migrate` would therefore build
an **incomplete** schema, which is why DEPLOY-1 deployed with `drizzle-kit push
--force`. `push --force` syncs the schema but is **unsafe on a populated DB** (it
can drop/alter to match). Production is empty today; this sprint closes that
window before real data lands.

**What changed:**

1. Squashed all migrations into a **single clean baseline** (`0000_harsh_romulus.sql`)
   regenerated from the schema (the source of truth), journal reduced to **one** entry.
2. Switched `db:deploy` step 2 from `drizzle-kit push --force` → `drizzle-kit migrate`.
3. Added two guarded production-adoption one-offs: `db:reset` (recommended, empty DB)
   and `db:baseline-stamp` (zero-reset, DB-with-data).
4. Corrected stale docs (`CLAUDE.md`, `docs/ARCHITECTURE.md`, `deploy/DEPLOY-1.md`).

**Invariant now:** `db:deploy` runs `migrate`; a fresh `migrate` reproduces the
current schema exactly; deploys are safe on a populated DB.

**Safety basis:** production was provisioned via `push --force`, which syncs the
**schema**, so production == schema. A baseline regenerated from the same schema
== schema == production, by construction. The only residual risk (`generate` vs
`push` emitting cosmetically different DDL) is caught by the M4-LIVE schema diff
on a throwaway DB.

---

## M0 — Baseline

- TS: `pnpm --filter @workspace/api typecheck` = **164 errors** (matches the documented api baseline).
- Tests (this CC sandbox): api **1036 total**, 14 test **files** fail — all PGlite-WASM
  aborts (`RuntimeError: Aborted()` from `@electric-sql/pglite`), the documented
  "no Docker/PGlite in sandbox" environmental failures. The pass/skip split is
  nondeterministic run-to-run (PGlite aborts mid-suite) but the **14 failing
  files and the 1036 total are constant**. Migration `.sql` and the deploy
  scripts are imported by **zero** tests, so there is no regression path.
- Pre-squash migrations archived to `_archive/2026-06-15-migrate-1/migrations-pre/`
  (8 `.sql` + `meta/`, journal = 3 entries).

---

## M1 — Schema ↔ migration parity audit

Full table in `_reports/migrate-1-parity.md`. Result: **all rows = Y.**

| Migration                                 | Reflected in schema? | Evidence                                                                                                  |
| ----------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| `0000_smooth_black_bolt` (core baseline)  | **Y**                | all tables re-exported from `schema/index.ts`                                                             |
| `0001_sprint_c`                           | **Y**                | `chat_conversation_members`/`conversation_member_role` (`chat.ts`), `document_views` (`collaboration.ts`) |
| `0002_drop_knowledge_edges`               | **Y (absent)**       | no `knowledge_edges` anywhere in `schema/` (only tombstone comment)                                       |
| `0003_sessions`                           | **Y**                | `sessions.ts:30`                                                                                          |
| `0004_user_patterns`                      | **Y**                | `userPatterns`/`patternEdgePriors` (`user-patterns.ts`)                                                   |
| `0005_editor_scores`                      | **Y**                | `editorConfidence/Importance/Salience/Freshness/RunAt` (`semantic-index.ts:135-139`)                      |
| `0006_tombstones`                         | **Y**                | `deleted_at`+audit cols on `index_records`/`semantic_links`/`index_record_states`/`raw_files`             |
| `0007_mcp_active_project`                 | **Y**                | `mcp-active-project.ts:19`                                                                                |
| _(no migration)_ `anchors`/`anchor_edges` | **Y (schema only)**  | `anchors.ts:17,53` — the gap the new baseline closes                                                      |

**No N rows → no drift → no HALT.** No live non-gated pipeline write targets a
column absent from the schema.

---

## M2 — Regenerated baseline

- Deleted all of `src/db/migrations/`, ran `pnpm --filter @workspace/api db:generate`.
- Output: exactly **one** `0000_harsh_romulus.sql` (+ `meta/_journal.json` with one
  entry + `meta/0000_snapshot.json`). Snapshot `prevId` = all-zeros, **75 tables**
  = 75 `CREATE TABLE` statements (internally consistent).
- **Completeness grep — all pass:**
  - core: `users`, `accounts`, `workspaces`, `workspace_members`, `files`, `spaces`, `external_documents` ✅
  - additive: `sessions`, `user_patterns`, `mcp_active_project` ✅
  - anchors: `anchors`, `anchor_edges` ✅
  - `vector(...)` columns present: `embedding vector(1536)` ×4, `embedding_content vector(768)`, `embedding_causal vector(512)`, `embedding_context vector(512)` ✅
  - `knowledge_edges` / `knowledge_relationship` / `knowledge_entity_type` **ABSENT** ✅
- Journal has exactly **one** entry; `tag` = `0000_harsh_romulus` matches the file.

### M2b — pgvector ordering

`db-deploy.ts` step 1 (`CREATE EXTENSION IF NOT EXISTS vector`) runs before step 2
(`migrate`) — ordering preserved. As **belt-and-suspenders**, the baseline SQL was
also prepended with `CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint`
so the baseline is self-sufficient even if run without step 1.

---

## M3 — `db:deploy` runs `migrate`

The only behavioural change is step 2 (`packages/api/src/scripts/db-deploy.ts`);
step 1 (vector ext) and step 3 (verify `anchors`/`anchor_edges`/`index_records` +
vector ext) are unchanged. `railway.json` `preDeployCommand` is unchanged.

```diff
- // ── 2. Sync the schema via drizzle-kit push (reads drizzle.config.ts) ─────
- // --force makes it non-interactive (no TTY under `railway run`).
- console.info('[db:deploy] Running drizzle-kit push…')
- execSync('pnpm exec drizzle-kit push --force', { cwd: API_ROOT, stdio: 'inherit' })
+ // ── 2. Apply pending migrations via drizzle-kit migrate (reads
+ //       drizzle.config.ts). Idempotent + safe on populated DBs: applies only
+ //       un-applied journal entries, tracked in __drizzle_migrations.
+ console.info('[db:deploy] Running drizzle-kit migrate…')
+ execSync('pnpm exec drizzle-kit migrate', { cwd: API_ROOT, stdio: 'inherit' })
```

(The file's doc-comment was also rewritten to the new reality — see the commit.)

---

## M3b — Production-adoption helpers

Production already has the full schema (push-synced) but no `__drizzle_migrations`
ledger row for the new baseline, so a naive `migrate` would try the baseline
`CREATE TABLE`s and fail. Two guarded one-offs were added and wired as package
scripts (`db:reset`, `db:baseline-stamp`):

- **(a) `db:reset` — RECOMMENDED (prod is empty).** Drops & recreates the `public`
  schema, then a normal `db:deploy` applies the clean baseline from scratch.
  Guards: refuses unless `CONFIRM_RESET=1`; prints key-table row counts FIRST so
  an accidental run on a populated DB is loud; `--dry-run` = counts only, no drop.
- **(b) `db:baseline-stamp` — zero-reset (use if prod ever has data).** Computes the
  baseline migration hash exactly the way drizzle-orm's migrator does —
  `sha256(hex)` of the full raw `.sql`, `created_at` = the journal entry's `when`,
  ledger = `drizzle.__drizzle_migrations` — and inserts it as already-applied
  **without** executing the baseline SQL, so `migrate` treats the baseline as done
  and only applies FUTURE migrations. Idempotent (skips already-recorded hashes);
  `--dry-run` prints what it would insert.

**Recommendation: path (a) `db:reset`**, since production is empty today.

---

## M4-REPO — Static verification (CC) — PASS

- TS unchanged: api **164** (= baseline); zero errors in the two new scripts.
- Tests unchanged: same **14 failing files** (all PGlite-WASM, environmental),
  1036 total constant. Migration `.sql` + the three deploy scripts are imported by
  **zero** tests (verified by grep) → no regression path.
- eslint `--max-warnings=0` clean on all changed/added files (lint-staged + manual run).
- M2 completeness grep passes; journal = exactly one entry.

---

## M4-LIVE — Railway runbook (the real proof — run by Rishabh; NOT run in CC)

> No Docker/Postgres in the CC sandbox, so the real-DB proof is a runbook.

1. **Provision a throwaway empty Postgres** (scratch Railway pg service). Set its
   `DATABASE_URL` for the steps below.
2. **Fresh `migrate` path:**
   `railway run pnpm --filter @workspace/api db:deploy`
   → expect db-deploy's own verify to pass:
   `vector extension: ✅`, `table anchors/anchor_edges/index_records: ✅`,
   `✅ Migration complete — N tables in public schema`.
3. **Smoke:** point a scratch API at that DB and run
   `SMOKE_URL=<scratch-api-url> tsx deploy/smoke.ts` → green.
4. **Schema-equality proof:** on a SECOND throwaway DB run the OLD path
   (`drizzle-kit push --force` against the same schema); `pg_dump --schema-only`
   both DBs and diff. Expect only cosmetic ordering differences → proves
   `migrate`-baseline == `push` == production shape.
5. **Apply to production (empty → path a):**
   `CONFIRM_RESET=1 railway run pnpm --filter @workspace/api db:reset`
   (it prints key-table counts first — they MUST be 0; if not, STOP and use
   `db:baseline-stamp` instead and skip the reset), then redeploy so the
   pre-deploy `db:deploy` applies the baseline. Confirm `/health` → 200, smoke
   green, and `SELECT * FROM drizzle.__drizzle_migrations` shows the baseline
   applied (one row, `hash` = sha256 of `0000_harsh_romulus.sql`).

**M4-LIVE result (filled in after Rishabh runs it):** _pending._

---

## Files touched

| File                                                      | Change                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/api/src/db/migrations/**`                       | squashed to single `0000_harsh_romulus.sql` + one-entry journal + snapshot; `CREATE EXTENSION vector` prepended |
| `packages/api/src/scripts/db-deploy.ts`                   | step 2 `push --force` → `migrate`; doc-comment rewritten                                                        |
| `packages/api/src/scripts/db-reset.ts`                    | **new** — guarded drop/recreate `public` (empty-DB adoption)                                                    |
| `packages/api/src/scripts/db-baseline-stamp.ts`           | **new** — zero-reset ledger stamp (DB-with-data adoption)                                                       |
| `packages/api/package.json`                               | `db:reset`, `db:baseline-stamp` scripts                                                                         |
| `_archive/2026-06-15-migrate-1/migrations-pre/**`         | pre-squash snapshot                                                                                             |
| `_reports/migrate-1-parity.md`                            | parity audit                                                                                                    |
| `docs/audits/MIGRATE-1-REPORT.md`                         | this report                                                                                                     |
| `CLAUDE.md`, `docs/ARCHITECTURE.md`, `deploy/DEPLOY-1.md` | corrected stale `push --force` / stale-journal notes                                                            |
| `RUN-STATUS.md`                                           | MIGRATE-1 checkpoint                                                                                            |
