# Codebase walkthrough

A guided tour of the Follow platform for someone reading the code for the first time — or returning to it after a while. Written 2026-07-24, immediately after CLEANUP-1, so unlike the older docs it describes exactly what is in the tree today.

---

## 1. The mental model in one paragraph

Follow is a memory system wearing a workspace. Everything you do — browsing, editing Google docs, uploading files, talking to an AI — becomes **raw input**; a background **pipeline** distills that input into **facts** (`index_records`) that carry provenance, embeddings, versions, and typed relationships to other facts; and two consumers read the result: the **Follow dashboard** (a human browsing their own memory) and the **MCP server** (external AI agents querying it). Almost everything else in the repo exists to feed, transform, store, or expose that fact graph.

## 2. What languages am I looking at?

**It is TypeScript end to end.** There is no Python in this codebase. The things that look like other languages:

- `.gs` files in `apps/gws-extension/` are **Google Apps Script** — JavaScript that runs inside Google's servers for the Workspace add-on surface.
- `.sql` files under `packages/api/src/db/migrations/` are generated **Drizzle migrations** — the schema is authored in TypeScript (`db/schema/*.ts`) and compiled to SQL.
- `.cjs`/`.mjs` files are plain Node scripts (config, tooling).
- `.bat`/`.cmd` files are Windows launchers for the dev stack.

Runtime-wise: the API runs TypeScript directly via `tsx` (no build step in production); the web app compiles with Next.js.

## 3. The monorepo, piece by piece

```
packages/api        ~66k LOC   the platform server — where most of the system lives
apps/web            ~39k LOC   the Follow dashboard (Next.js 14)
apps/gws-extension  ~14k LOC   Google Workspace extension (snapshots + floating assistant)
apps/extension       ~8k LOC   Chrome extension (activity signals)
apps/mobile          ~4k LOC   Expo client shell
packages/shared      ~3k LOC   shared types, constants, dev-user seeds
apps/desktop-agent   ~1k LOC   local folder watcher syncing files in
packages/ui          ~2k LOC   small React primitives library
scripts/             ~2k LOC   dev launcher + dev console + preflight gates
```

`packages/api` is the heart. Inside `src/`:

- `routes/` — Hono HTTP routers, one file per resource. `app.ts` mounts them; `index.ts` boots the server, connects infra, and starts schedulers.
- `services/` — the actual logic. Routes are thin; services are where to read.
- `mcp/` — the MCP server: `transport.ts` (JSON-RPC over SSE + streamable HTTP), `tools/` (one file per tool), and a REST bridge for ChatGPT Actions.
- `db/` — Drizzle schema (`schema/`), the connection layer (`index.ts`, with a PGlite fallback for dev/test), ClickHouse client (with an in-memory fallback), migrations.
- `middleware/` — auth, error handling, traffic logging.
- `config/` — model tier registry (`models.ts`), server feature vault, env validation.

## 4. Life of the data — four journeys

The fastest way to understand the system is to follow each input to its destination.

### 4a. A browser signal

1. The Chrome extension (`apps/extension`) batches activity signals every ~5 s and sends them over WebSocket to the signal server (`packages/api/src/ws/index.ts`, port 3002).
2. Signals land in ClickHouse (`thread_signals` table) — high-volume, 7-day TTL (the processed/summary tables keep 90 days to 2 years), cheap to write. When ClickHouse is absent (as in prod today), an in-memory stand-in absorbs them (`db/clickhouse.ts`); `/api/health` reports `degraded`, which is the by-design steady state, not an outage.
3. Internal services also emit signals without HTTP — `services/signals.ts` (`insertSignals`) is the shared writer used by GWS ingestion and chat completion.
4. Session infrastructure (`services/sessions/`) brackets activity into sessions (idle reaper, queue bridge, pipeline crons) — these are what trigger the Archivist and Profiler roles at session start/end.

### 4b. An uploaded document

1. `POST /api/raw-files` (route `raw-files.ts` → `services/raw-file-store/`): content-addressed by SHA-256 (`check-hash` first), hash-chained (`previousHash`), stored to S3/MinIO under a `storageKey`. The store self-heals a vanished bucket.
2. The indexing queue (`services/indexing/index-queue.ts` → `indexing-agent.ts`) picks the file up: text extraction, **semantic chunking** (an LLM call on the MICRO_SUMMARY tier splits the doc at topic boundaries), enrichment, embeddings, `document_chunks`.
3. `services/indexing/fact-routing.ts` decides whether a fact extractor runs: chat artifacts → `chat-fact-extractor`; native uploads → `services/semantic-index/doc-fact-extractor.ts`.
4. The doc-fact extractor applies a **salience gate** (`doc-salience.ts`: importance ≥ 0.5, content-hash dedup, cap 50/doc) and indexes the survivors as facts carrying a real `source_version`.
5. On re-sync of a changed file, `planDocSupersession()` splits existing facts into carry-forward (content still present → re-stamped to the new version) and superseded (content gone → `superseded_at` set). Every current-serving reader filters through `current-fact-filter.ts` (`superseded_at IS NULL AND deleted_at IS NULL AND hidden = false`), so retrieval answers from the current version while history remains queryable.

### 4c. A chat message

1. `POST /api/chat/conversations/:id/messages` (route `chat.ts`) loads history, then streams the response over SSE.
2. Before the model is called, the **reference agent** (`services/reference-agent/`) runs active recall in four stages: `classifier.ts` (does this query need memory? which kind?), `planner.ts`, `retriever.ts` (multiple lanes: `index_records` vector search, memory layers, point-in-time states), `assembler.ts` (renders context blocks, attributes each fact to its author, marks cross-author `contradicts` pairs as `⚠ CONTESTED`).
3. `services/chat/completion.ts` sends system prompt + context + tools to OpenRouter (`CHAT_AGENT` tier; vision variant when images attach) and streams tokens back, executing tool calls (`services/chat/tools.ts`) along the way.
4. After the turn, the conversation becomes pipeline input itself via the chat fact extractor — chat is both a consumer and a producer of memory.

### 4d. An MCP query

1. An external agent (Claude, ChatGPT) connects to `/mcp` (SSE/streamable JSON-RPC) or `/api/mcp-rest` (REST bridge). Auth accepts `wsp_` machine keys (`middleware/api-key-auth.ts`) and the human-path headers (`middleware/auth.ts`).
2. Tools live one-per-file in `mcp/tools/` — querying (`query-index`, `directory-query`), writing (`save-conversation`), scope management (`set-scope`, `scope-configure`), sharing (`contribute`, `get_activity`), contradiction surfacing (`detect_contradictions`).
3. `query_index` in semantic mode returns the reference agent's assembled block verbatim — an external model reads the same attributed, contested-marked memory a chat user gets.

## 5. The five-role pipeline

The canonical cognitive loop (`services/pipeline/` + `services/semantic-index/`), staged 01–07: Ingest → Activate → **Reporter** (restate an event as a tentative node) → **Analyst** (classify typed edges between cosine-near nodes: references / supports / contradicts / elaborates / supersedes) → **Editor** (score confidence/importance/salience/freshness) → **Archivist** (promote tentative nodes to durable states; supersession) → **Profiler** (14-day pattern extraction feeding priors back to the Analyst).

Each role has its own model tier (`config/models.ts` — Gemma for volume, DeepSeek for the Analyst's reasoning, Qwen variants elsewhere) and its registered prompt (`config/model-tier-prompts.ts`). The queue consolidation path runs through **LangGraph** with a Postgres checkpointer (`pipeline-graph` flag, on) so runs are durable and resumable. The Analyst's LLM edge classification is feature-flagged (`pipeline-analyst-llm`); when off, a cosine + heuristic classifier runs instead. `dev-graph` (`/api/dev/graph`) renders the pipeline's shadow router for inspection.

## 6. The database layer

- Authored schema: `db/schema/*.ts` (Drizzle). Key areas: `semantic-index.ts` (facts, states, links, anchors), `ai-state.ts` (memory layers), chat, files/raw-files, workspaces/users/members, sharing (`shared_slices`), MCP keys.
- `db/index.ts` connects to Postgres; **without `DATABASE_URL` it silently falls back to PGlite** (in-process WASM Postgres, file-backed under `packages/api/data/pglite`). This powers dev and tests, and is also the classic footgun: a script that forgets env loading quietly writes to PGlite instead of your real DB. The PGlite DDL is hand-maintained in `db/index.ts` and must mirror new migrations.
- Migrations: a single clean baseline (`0000_*`) plus increments; deploys run `drizzle-kit migrate` via `db:deploy` (never `push --force` against prod data).

## 7. The web app

`apps/web/src` is a Next.js 14 app-router project. The product surface is the **Follow shell**: `app/workspace/[id]/page.tsx` renders `components/follow/dashboard/follow-dashboard.tsx`; `components/follow/` holds the shell (floating unit, chat panel, dev-mode button), the views (items, memory, vault, transcripts), and their stores (Zustand, in `stores/`). Auth pages, settings (`app/settings/*`), the public share page (`app/s/[token]`), and the notes editor (`components/editors/notes/`, TipTap + Yjs) round out the live surface. `lib/api-client.ts` is the fetch wrapper through which the dashboard talks to the API.

## 8. Auth, honestly

As of **security-gate-1** the platform is **multi-tenant-safe**. Identity comes only from verified credentials: a minted **JWT bearer** for the human path (the web app signs it server-side with `AUTH_API_SECRET`; the API verifies the signature) and `wsp_` machine keys for MCP (`middleware/api-key-auth.ts`). The `x-user-id` header is **no longer trusted** — a forged or absent header, or an invalid/expired bearer, is a hard 401 (`middleware/auth.ts`). The one escape hatch is `AUTH_ACCEPT_LEGACY_USER_HEADER=true`, a break-glass env flag that re-enables the legacy header path for emergency rollback (startup warns if it's on in production); `DEV_BYPASS_AUTH` still gates the local dev-user seed path and defaults off in production.

Cross-tenant access is closed by a **workspace-membership guard** (`services/workspace-access.ts`): access to any workspace requires the caller to be its owner or an active `workspace_members` row. It's enforced at every endpoint that takes a caller-supplied `workspaceId` (header, body, or query) and once at the MCP transport boundary for every session-scoped tool. So naming another workspace's id — or minting a `wsp_` key into it — returns 403, verified live. Finer _within_-workspace ACLs (per-conversation membership, per-user privacy rules) are the next layer of hardening, tracked separately.

## 9. Testing and quality culture

- **Vitest, colocated**, per package (`pnpm --filter <pkg> test`): ~1,350 tests across api/web/desktop-agent/gws-extension. API tests run on PGlite (fast, no Docker) — with the caveat that parallel workers share the file-backed data dir, which can flake; deleting `packages/api/data/pglite` resets it.
- **Baselines, not perfection:** web typecheck is 0-errors and must stay 0; the API carries a known ~91-error baseline (measured, tracked, advisory in the deploy image). The bar for changes is "no new errors, failing-test set unchanged".
- **Preflight gates** (`scripts/preflight/`) are runnable experiments that gate pipeline changes with measurements (e.g. facet separation) rather than vibes.
- **Audit reports** (`docs/audits/`, 44 of them): every significant change ships with a written audit of what was done and how it was verified — the engineering diary of the project.

## 10. Deploy and operations

Two Railway services deploy from `main`: the API (`deploy/Dockerfile` — installs, advisory typecheck, runs `tsx src/index.ts`; pre-deploy runs DB migrations) and the web app (`deploy/web.Dockerfile` — `next build` standalone output). Backing stores: Postgres (pgvector), Redis, MinIO; ClickHouse is currently absent in prod and the API runs its in-memory fallback, which is why `/api/health` reports `degraded` while everything user-facing works. A local ops dashboard can pause the whole platform to zero compute and resume it later — when paused, nothing serves and pushed commits simply deploy on the next resume.

## 11. Where to read next, by curiosity

| If you want to understand…           | Read                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| How a fact is born                   | `services/indexing/indexing-agent.ts` → `services/semantic-index/indexer.ts`     |
| How documents version                | `services/semantic-index/doc-fact-extractor.ts` + `docs/audits/VERSION-B1.md`    |
| How recall works                     | `services/reference-agent/` (classifier → planner → retriever → assembler)       |
| How contradictions surface           | `services/contradictions/` + the CONTESTED path in `retriever.ts`/`assembler.ts` |
| What external agents can do          | `mcp/tools/` + `mcp/transport.ts`                                                |
| The dashboard                        | `apps/web/src/components/follow/` starting at `dashboard/follow-dashboard.tsx`   |
| The models used                      | `packages/api/src/config/models.ts` + `model-tier-prompts.ts`                    |
| Why any given thing is the way it is | `docs/audits/` — find the sprint that touched it                                 |
