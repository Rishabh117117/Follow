# Workspace Platform — Claude Code Context

> **Audited and rewritten 2026-05-13; updated for CLEANUP-1 2026-07-24** (the parked-surface strip — all vault-gated features and the in-repo `_archive/` were deleted; git history preserves them). This file is intentionally short — durable rules and orientation only. Everything else lives under `docs/`.

---

## What this is

An AI-native workspace memory platform. A background indexing pipeline watches user activity across desktop, browser, and Google Workspace, distills it into versioned facts and memory with provenance, and exposes the result to the Follow dashboard, the chat agent, and external agents over MCP.

pnpm + Turbo monorepo:

```
apps/{web,desktop-agent,extension,gws-extension,mobile}
packages/{api,shared,ui,typescript-config}
scripts/   deploy/   docs/
```

Working directory is **`C:\Dev\Workspace App`** (moved out of OneDrive — see "Windows env quirks" below).

---

## Where to look for what

| Question                                                               | File                     |
| ---------------------------------------------------------------------- | ------------------------ |
| What's the overall architecture? Routes, services, schemas, data flow. | `docs/ARCHITECTURE.md`   |
| How does AI work? Pipeline, reference agent, MCP, model tiers.         | `docs/AI_SYSTEM.md`      |
| What UI exists? Pages, stores, components, what's gated off.           | `docs/UI_INVENTORY.md`   |
| What are the coding conventions and startup commands?                  | `docs/CONVENTIONS.md`    |
| What's currently broken or partial?                                    | `docs/KNOWN_ISSUES.md`   |
| What landed when?                                                      | `docs/SPRINT_HISTORY.md` |

If a question isn't answered by one of these, prefer reading the code over guessing.

---

## Mental model in one page

1. **Two cognitive loops.** Passive: the **5-role indexing pipeline** (REPORTER → ANALYST → EDITOR → ARCHIVIST → PROFILER, in `services/pipeline/`) consumes signals, GWS snapshots, raw files, and chat artifacts; writes facts (`index_records`) and memory layers (`aiState`). Active: the **reference agent** (`services/reference-agent/`, 4 stages: classify → plan → retrieve → assemble) sits between the user and chat completion, injecting context blocks.
2. **Three input paths** feed the pipeline: extension signals (5 s batches over WS to ClickHouse), GWS snapshots (`/api/gws`), and raw files (`/api/raw-files`, SHA-256 dedup). Chat conversations enter via `chat-fact-extractor`; native uploaded documents produce versioned facts via `doc-fact-extractor` (DOC-FACTS-B0/VERSION-B1).
3. **MCP server** exposes 12 tools over JSON-RPC at `/mcp` and a REST bridge at `/api/mcp-rest`. Claude Desktop connects over SSE, ChatGPT over REST. `MCP_PUBLIC_URL` must match the current ngrok URL.
4. **Feature vaults.** Two flag files: `apps/web/src/config/feature-vault.ts` (UI) and `packages/api/src/config/server-vault.ts` (server). **CLEANUP-1 (2026-07-24) deleted the code behind every permanently-off flag** (canvas, editors, notebooks, threads, timeline, comments, capture, doc-intelligence, browser-nav, the off schedulers). The server vault now holds only live gates: `scheduler-sync` + `route-chat` (on), `pipeline-analyst-llm` + `pipeline-graph` (on), `pipeline-editor-llm` + `node-anchors` (off, staged work). The web vault file remains as the catalog rendered by the Follow shell's Vault view — its entries describe archived surfaces, recoverable only from git history. Flag changes are read at startup — restart the API to take effect.
5. **The product spine right now** is: the 5-role pipeline + chat + MCP + dashboard + items view. That's what users actually see.

---

## Critical conventions (the rest are in `docs/CONVENTIONS.md`)

- **Startup.** Always launch via `npx tsx scripts/launch.ts` (or the desktop shortcut). Don't start services in individual terminals; the launcher handles dependency ordering, env loading, and ngrok. New services must register with `/api/health` to show up on the dashboard.
- **Provenance terms.** _Thread_ = back-and-forth on one context object. _Strand_ = a named line of work across threads. _Event_ = unit inside a thread. _Evidence_ = source attribution attached to an event. Use these terms consistently.
- **Model tiers.** Single registry at `packages/api/src/config/models.ts`. 10 tiers, every one with a live call site (CLEANUP-1 pruned the tiers of removed surfaces). The 5 pipeline roles use heterogeneous models (Gemma, DeepSeek, Qwen) tuned to their job; auxiliary tiers default to free Gemma. Don't add a tier without adding it to `ACTIVE_TIERS` if anything calls it.
- **Feature gates.** When adding a new editor / advanced surface, wrap it in `isFeatureActive('flag-id')` from `@/config/feature-vault` and return `<FeatureInactivePlaceholder/>` if off.
- **MCP tools.** One file per tool in `packages/api/src/mcp/tools/` exporting `{ name, description, inputSchema, handler }`. `inputSchema` is a Zod schema. Sharing tools require project scope to be set. See `docs/AI_SYSTEM.md` §4 for the full contract.
- **Raw files.** Content-addressed by SHA-256, hash-chained (`previousHash`), backed by S3 / MinIO via `storageKey`. Always check `GET /api/raw-files/check-hash` before uploading.
- **Tests.** Vitest, colocated. Don't merge new TS errors into web (web baseline is 0). API baseline ~91 after CLEANUP-1 (was ~160 inside gated-off handlers); don't add to it.

---

## Build & test

```bash
npx tsx scripts/launch.ts   # full stack — preferred
pnpm dev                    # turbo, no Docker
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm db:push                # schema → Postgres
pnpm db:studio              # Drizzle Studio
```

Ports: web 3009, api 3001, signal WS 3002, Yjs WS 3003, dashboard 4000. Containers: postgres 5432 (+pgvector), redis 6379, clickhouse 8123/9000, minio 9090/9091.

---

## Non-obvious gotchas

- **Project location.** Work in `C:\Dev\Workspace App`. The OneDrive copy at `C:\Users\risha\OneDrive\Desktop\Workspace App` is empty stubs locked by the OneDrive driver (may clear after reboot). Never edit there.
- **Dynamic imports.** Several live paths load modules via `await import(...)` (e.g. `routes/gws.ts` → `services/gws/snapshot-capture`, `mcp/tools/scope-configure.ts` → `services/live-context/activate`, the semantic-index state-capture sites). Static `from '...'` greps miss these — when auditing dead code, grep for dynamic imports too.
- **DB migrations.** As of **MIGRATE-1**, `src/db/migrations/` is a single clean baseline (`0000_*`) regenerated from `schema/index.ts`; the journal has exactly one entry. Deploys run `db:deploy` → `drizzle-kit migrate` (safe on populated DBs), **not** `push --force`. The old 8-file/3-entry stale journal is archived under `_archive/2026-06-15-migrate-1/`. First-time adoption on a `push`-provisioned DB uses `db:reset` (empty DB) or `db:baseline-stamp` (DB with data). See `docs/audits/MIGRATE-1-REPORT.md`.
- **Launcher env loading.** `scripts/launch.ts` calls `loadDotenv` on `packages/api/.env.local` and `.env` **before** spawning children. Without this, children see `DATABASE_URL=undefined` and `db/index.ts` falls back to PGlite (ephemeral in-process DB). STABILIZE-1 fix; do not move.
- **ngrok on Windows.** Self-installs via winget if missing; winget ships an outdated version so the launcher self-updates. Authtoken read order: env var → `%LOCALAPPDATA%\ngrok\ngrok.yml` → project-local `.ngrok-authtoken` (gitignored). The launcher caches a working token to `.ngrok-authtoken` because Node's `existsSync` sometimes lies about AppData paths on Windows.
- **Dashboard MCP URL.** Reads `launcher?.ngrok?.url` from the launcher state object — **not** `config.publicUrl` from `/api/health`. LAUNCH-2 fixed this; before that the dashboard showed localhost even with ngrok live.
- **`ensureProjectStrand` arity bug.** `routes/indexes.ts:320` calls with 3 args but signature wants 4. Swallowed by the surrounding try/catch — `POST /api/indexes` still succeeds. Fix when you next touch project creation. See `docs/KNOWN_ISSUES.md`.
- **`save_conversation` aliases.** Accepts both canonical names (`reasoningChain`, `toolCalls`, `sources`, `modelId`, `tokensIn`) and alias names (`chain_of_thought`, `tool_invocations`, `citations`, `model_id`, `input_tokens`). `normalizeSources()` coerces source shapes. If you add a new alias, mirror it in `read_file` and `reasoning-panel.tsx`.
- **Chat artifacts have two IDs.** `chat_artifact` raw_files row + the original conversation row. `resolveSourceVersion` sets `sourceFileId = conversationId` for chat threads, so `/api/index/items/status` matches `index_records.sourceFileId` against **both** the wrapper id and the conversation id.
- **`workspaceId="default"`** fails Zod UUID validation on UUID-validated routes. Seed a workspace first.

---

## When you're stuck

1. Check `docs/KNOWN_ISSUES.md` — your symptom may already be cataloged.
2. Check the dashboard at `localhost:4000` — Network tab shows traffic, Logs tab tails `logs/api.log`, Settings tab shows live vault flag state.
3. Grep the relevant `services/` folder before grepping `routes/` — most logic lives there.
4. Retired docs and superseded code copies (the old `_archive/`) were removed from the tree in CLEANUP-1; recover them from git history (`git log --all -- _archive/`) if ever needed. Code wins on any conflict with docs.

---

## SCOPE-A-1 (2026-06-22): cross-author contradiction surfacing in retrieval

The reference agent now attributes facts by author and surfaces cross-author contradictions. See `docs/audits/SCOPE-A-1.md`.

- **Author attribution.** `retriever.ts attachAuthorNames()` resolves `index_records.user_id → users.name` (one batched query; falls back to cached `user_name → email → short id`) and sets `RetrievedItem.citation.author`. The assembler renders ` — by <author>` inline per fact (not per section — one section can hold multiple authors) and carries `author` in `versionCitations[]`.
- **Contested surfacing.** `retriever.ts findContradictsEdgesAmong(recordIds)` looks up `semantic_links` `contradicts` edges whose **both** endpoints are in the retrieved set (reason/confidence come from `metadata.analyst`, not the null top-level `reason`). The orchestrator (`reference-agent/index.ts`) passes them to the assembler, which marks facts `⚠ CONTESTED` and emits a `[CONTESTED — teammates disagree]` block (both authors + reason + cross/same-author). `AssembledContext.contested: ContestedPair[]` is the structured output for a UI. **We surface both sides; we never auto-resolve** (no `conflict-resolver`).
- **`query_index` semantic mode** returns this assembled block verbatim (`mcp/tools/query-index.ts:138-184`), so an LLM querying a shared project reads who-said-what + the contested marker.
- **Co-residence** requires both authors to `save_conversation(save_to='project')` into the same `activeProjectId` (the candidate pool is `workspaceId`-scoped, no `userId` filter — `indexer.ts:771-784`). `contribute` does NOT merge into `index_records` (it writes `shared_slices`), so it does not form cross-author edges.
- **Behaviorally confirmed in prod** (PR #18, merged + deployed 2026-06-23): a sentinel two-author probe formed a real cross-author `contradicts` edge (`cross_user=true`, deepseek-v4-pro) and the deployed reference agent rendered both authors + the `[CONTESTED]` block, with no `superseded_by` overwrite; teardown returned the DB to exact baseline.
- **Not yet:** doc-version supersession, `activeProjectId` membership enforcement (it's a bare per-user id in `mcp_active_project`), and a live (vs cached `user_name`) author resolver in `contradictions/edges.ts`.

## DOC-FACTS-B0 (2026-06-24): native documents produce facts (versioned, salience-gated)

Native uploaded files (`raw_files.source_type` ∈ `{upload, local}`) now produce `index_records` facts, not just `document_chunks`. See `docs/audits/DOC-FACTS-B0.md`. **Merged + live on `main` (PR #21, 2026-06-25).**

- **The producer.** `services/semantic-index/doc-fact-extractor.ts` `extractAndIndexDocFacts()` — the document analogue of `chat-fact-extractor`: a `type:'doc'` thread (`metadata.fileId = raw_files.id`), one `DistilledEvent` per salient chunk (`type:'edit'`, `distilledFrom:['document']`), routed through the **unchanged** `indexDistilledEvents`. So embeddings, episodes, ANALYST edges, and state-capture all run as for chat. Doc facts are `thread_type='doc'`, `isAIInvolved=false`.
- **The guard.** `services/indexing/fact-routing.ts` `routeFactExtraction()` drives the post-index branch in `indexing-agent.ts` (~382): `chat_artifact→chat` (unchanged), `upload|local→doc`, `gws`/else → no facts. The chat path is byte-for-byte unchanged.
- **Salience gate.** `services/semantic-index/doc-salience.ts` `selectSalientChunks()` (pure): importance ≥ 0.5 (unset→0.5, so a 429-degraded enrichment never silently drops facts) → content-hash dedup per `source_file_id` (+ intra-batch) → per-doc cap 50. **Identical re-index produces 0 new facts** — this closes the blind-append behavior for documents.
- **Versioning — the substrate is now live.** `resolveSourceVersion`'s `'file'` branch gained a **`raw_files` fallback**: file-manager files still use `file_versions.versionNumber`; native uploads (no `file_versions` row) use `raw_files.version` + `raw_files.contentHash`. So doc facts carry a real `source_version` for the first time. `buildDocTemplate` now also embeds `chunkContent` (parity with `buildAITemplate`) so doc-fact vectors carry the actual content.
- **Prod-confirmed (Phase 4, owner-approved, torn down to baseline):** a sentinel native upload produced 2 doc facts with `source_version=1`, embeddings, the boilerplate chunk dropped, and identical re-index yielding 0 new facts.
- **Still B-1 (not this sprint):** **supersession on _changed_ re-sync** — when `raw_files.version` increments, B-0 _appends_ a new generation (prior facts not marked `superseded`). The substrate (`source_version`) is now ready for it. Also deferred: Drive (`gws`) → facts; section-level distillation.

## VERSION-B1 (2026-06-25): re-synced documents retire their old facts (current excludes superseded)

When a document changes and a new `source_version` lands, its prior-version facts whose content is gone are marked `superseded_at`, and normal retrieval returns only current facts. See `docs/audits/VERSION-B1.md`. **Merged + live on `main` (PR #22, 2026-06-25; migration `0001` applied in prod).**

- **The column.** `index_records.superseded_at timestamptz` (NULL = current; migration `0001_living_night_nurse.sql`). Distinct from `hidden` (manual) and `deleted_at` (tombstone) — lifecycles are not conflated. Mirrored into the PGlite dev/test DDL (`db/index.ts`).
- **The write (carry-forward + sweep).** In `doc-fact-extractor.ts` (the only versioned-fact producer). `planDocSupersession()` (pure) splits the file's existing facts into **carry-forward** (content still present in the new version → re-stamp `source_version=N`, revive if previously superseded) and **supersede** (content gone AND older version). New content inserts via the unchanged B-0 path. **Carry-forward, not a blunt `source_version < N` sweep** — because B-0's content-hash dedup is cross-version, so a partial re-sync leaves unchanged chunks at the old version; a blunt sweep would have lost them. `superseded_at` is set via `sql\`now()\``(not a JS`Date` → avoids DATE-BIND-1). Chat facts (null version) are never swept.
- **The read filter.** `services/semantic-index/current-fact-filter.ts` `currentFactConditions()` = `superseded_at IS NULL AND deleted_at IS NULL AND hidden=false`, applied to the three current-serving readers: `reference-agent/retriever.ts retrieveFromIndexRecords`, `query/runner.ts runStructuredQuery` (both were unfiltered — this also closes a pre-existing hidden/tombstone leak), and `semantic-index/query-executor.ts executeIndexQuery`. **Filters `superseded_at` only — NEVER `source_version`** (a chat-only workspace has all-null versions; excluding by version would drop the whole index). The point-in-time path `retrieveFromIndexStates` is intentionally untouched (it returns old versions by design).
- **Prod-confirmed (Phase 4, owner-approved, torn down to exact baseline):** a sentinel doc indexed at v1, re-synced at v2 (one chunk kept, one removed, one added) → the removed chunk's fact marked `superseded_at`, the kept chunk carried forward to v2, the new chunk inserted at v2; the real reader returned only current facts; the 57 existing prod facts were unaffected; temp column dropped + all sentinels removed.
- **Deferred:** structured "as of version" point-in-time (the NL `temporalHint`→`asOfTimestamp` path is untouched and has latent bugs — see `docs/audits/VERSION-RECON-1.md`); the `[SUPERSEDED]` citation tag (reuses the SCOPE-A-1 `assembler.ts:208` hook); Drive; section distillation.
