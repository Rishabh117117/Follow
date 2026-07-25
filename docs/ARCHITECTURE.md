> **⚠ Predates CLEANUP-1 (2026-07-24).** The parked-surface strip removed every vault-gated feature (capture, canvas, rich-text/spreadsheet/presentation editors, notebooks, threads, timeline, comments, doc-intelligence, browser-nav, the off schedulers) and the dev-mode workspace chrome. Sections referencing those no longer apply — the code wins. A fresh architecture doc is planned.

# Architecture

System architecture of the Workspace Platform monorepo as of **2026-05-13**.

This doc covers structure, routes, services, data flow, and infrastructure. For AI-specific behavior (chat pipeline, reference agent, MCP, model tiers) see `docs/AI_SYSTEM.md`. For UI surfaces and stores see `docs/UI_INVENTORY.md`.

---

## 1. What this is

An AI-native workspace where documents (rich-text, spreadsheets, slides, notebooks, PDF), an infinite canvas, file management, and AI chat all live under one roof. A background "indexing pipeline" watches everything you do across desktop, browser, and Google Workspace, distills it into facts and stories, and exposes that memory to the chat agent and external AI agents over MCP.

Built as a single pnpm + Turbo monorepo.

## 2. Monorepo layout

```
workspace-platform/
├─ apps/
│   ├─ web/               Next.js 14 frontend (:3009)
│   ├─ desktop-agent/     Node file watcher → API sync
│   ├─ extension/         Chrome MV3 (web capture / annotation)
│   ├─ gws-extension/     Chrome MV3 (Google Workspace overlay)
│   ├─ gws-addon/         Google Apps Script sidebar (Docs/Sheets/Slides)
│   └─ mobile/            React Native (Expo) — minimal scaffold
├─ packages/
│   ├─ api/               Hono server + Drizzle + MCP + WS (:3001, :3002, :3003)
│   ├─ shared/            Zod schemas, types, constants, event tracker
│   ├─ ui/                Headless React components (Button, Modal, …)
│   ├─ canvas/            PixiJS infinite-canvas engine
│   └─ typescript-config/ Shared tsconfig
├─ scripts/
│   ├─ launch.ts          One-click full stack launcher
│   ├─ dashboard-server.ts  Dev console server (:4000)
│   └─ dashboard.html     React SPA, 7 tabs, live WS
├─ data/
│   ├─ model-overrides.json   Runtime model-tier overrides
│   └─ queue-state.json       Persistent index-queue state
├─ docs/                  This directory
└─ _archive/              Historical: pre-strip sprints, retired docs
```

## 3. Runtime services

| Service             | Port        | Container              | Purpose                                    |
| ------------------- | ----------- | ---------------------- | ------------------------------------------ |
| Web (Next.js)       | 3009        | host (`pnpm dev`)      | Frontend                                   |
| API (Hono)          | 3001        | host                   | REST + WS + MCP                            |
| WebSocket (signals) | 3002        | host                   | Realtime capture / presence                |
| Yjs sync            | 3003        | host                   | CRDT for collaborative editing             |
| Dashboard           | 4000        | host                   | Dev console (logs, traffic, MCP)           |
| Postgres + pgvector | 5432        | `workspace_postgres`   | Primary DB + vector index                  |
| Redis 7             | 6379        | `workspace_redis`      | Cache + pub/sub                            |
| ClickHouse 24       | 8123 / 9000 | `workspace_clickhouse` | High-volume analytics (signals, summaries) |
| MinIO (S3)          | 9090 / 9091 | `workspace_minio`      | Object storage                             |
| ngrok               | dynamic     | host                   | Public tunnel for API (free tier rotates)  |

Containers come up via `docker compose up -d`. All four have healthchecks and named volumes. The launcher (`scripts/launch.ts`) brings everything up in order — see `docs/CONVENTIONS.md` §"Startup" for details.

## 4. API package (`packages/api`)

### 4.1 Entry points

- `src/index.ts` — process bootstrap: load `.env*`, validate env, wait for DB, seed dev user, init ClickHouse / Redis, start prompting pipeline, semantic-index background, index queue worker, realtime scheduler (gated), Yjs WS server, signal WS server, HTTP server.
- `src/app.ts` — Hono app factory: registers middleware (CORS, traffic logger), mounts ~45 route routers, defines a few `/api/debug/*` endpoints.

### 4.2 Routes (`src/routes/*.ts`, 55 files)

Mounted unconditionally:

```
/api/auth          /api/users       /api/users/me     /api/workspaces
/api/files         /api/spaces      /api/browser-nav  /api/doc-memory
/api/gws           /api/sharing     /api/webhooks     /api/prompting
/api/knowledge     /api/notifications /api/sessions   /api/admin
/api/admin/server-vault             /api/dev/graph    /api/health
/api/public        /api/shared-state /api/ai-state    /api/search
/api/index         /api/index/items /api/indexes      /api/index-queue
/api/memory        /api/raw-files   /api/models       /api/openrouter
/api/scope         /api/queries     /api/discover
/api/mcp/keys      /api/agents      /api/mcp-rest
/mcp                                                  # JSON-RPC 2.0 (MCP)
```

Gated via `server-vault.ts` (mounted only if `isServerFeatureActive('route-x')`):

```
route-chat                ✓ active     /api/chat
route-capture             ✗ off        /api/capture
route-capture-realtime    ✗ off        /api/capture/realtime
route-timeline            ✗ off        /api/timeline (+ /api/timeline annotations)
route-threads             ✗ off        /api/threads
route-strands             ✗ off        /api/strands
route-comments            ✗ off        /api/comments
route-doc-intelligence    ✗ off        /api/doc-intelligence
route-doc-intelligence-web ✗ off       /api/doc-intelligence-web
route-notebooks           ✗ off        /api/notebooks
route-follow-notes        ✗ off        /api/follow-notes
route-recording-sessions  ✗ off        /api/recording-sessions
```

Unmounted in code (`FV-1` cleanup):

```
routes/capture-ask.ts        — no frontend caller
routes/document-context.ts   — no frontend caller
```

### 4.3 Services (`src/services/`, 28 namespaces)

```
ai-state/          User state across 4 layers (Immediate/Event/Session/Persistent)
browser/           Browser nav session service
capture/           analyze.ts, browsing-context.ts (dynamic imports from routes/capture.ts)
chat/              completion.ts, system-prompt.ts, tools.ts, mention-parser.ts, directory-routing.ts
directory/         User / workspace directory resolution
discover/          Recommendation engine
doc-intelligence/  Document suggestion engine
document/          Doc utility helpers
export/            File export (PDF, Markdown)
gws/               Google Workspace sidebar + snapshot capture
import/            File import (DOCX, XLSX, CSV, JSON)
indexing/          Index queue worker + indexing-agent
live-context/      Realtime workspace context aggregator
mcp/               (deprecated — see packages/api/src/mcp instead)
memory/            Memory profile + section service
notebook/          Notebook & block service
notifications/     Notification aggregation + delivery
pipeline/          5-role indexing pipeline: reporter, analyst, editor, archivist, profiler, runner, prompts, gc, tombstone, llm-call
prompting/         LLM call executor + cost tracking
query/             Saved query service
raw-file-store/    Raw file ↔ S3
realtime/          ClickHouse signal capture
reference-agent/   classifier → planner → retriever → assembler (see docs/AI_SYSTEM.md §3)
scope/             Scope (what to index) service
semantic-index/    Vector index, hash-chain evidence, chat-fact-extractor, background worker (see docs/AI_SYSTEM.md §2)
sessions/          Recording session CRUD
sharing/           Privacy filters, slice builder, context-request sync
```

Also: `realtime-scheduler.ts`, `session-manager.ts`, `embedding.ts`, `vector-search.ts`, `content-chunker.ts`, `document-strand-manager.ts`, `project-strand-manager.ts`, `import-thread.ts`, `recording-session-finalizer.ts`, `thread-distillation.ts`, `thread-speaker.ts`, `openrouter-stats.ts`, `action-buffer.ts` at the top level of `services/`.

### 4.4 Database schema (`src/db/schema/*.ts`, 27 files)

```
users.ts, workspaces.ts, spaces.ts        — identity / org
files.ts, raw-files.ts                    — files + content-addressed raw bytes
knowledge.ts, scope.ts                    — knowledge docs + indexing scope
semantic-index.ts, threads.ts             — episodes (vector index records), threads, strands, events
chat.ts                                   — conversations, members, messages, snapshots
notebooks.ts                              — notebook, page, block (10 block types)
sessions.ts                               — recording sessions
timeline.ts                               — timeline events (legacy, kept for migration)
ai-state.ts                               — AI state snapshots (4 layers)
memory-profiles.ts, memory-sections.ts    — workspace memory profiles
doc-intelligence.ts, doc-memory.ts        — doc suggestions + narrative phase
collaboration.ts, sharing.ts              — file shares, comments, API keys, access grants
mcp-active-project.ts                     — per-session MCP scope
browser-nav.ts                            — nav sessions
external-documents.ts                     — third-party doc refs
user-patterns.ts                          — behavior patterns
query.ts                                  — saved queries
llm-usage.ts                              — cost tracking
index.ts                                  — schema re-exports
```

Postgres holds everything except high-volume signals — those go to ClickHouse:

- `thread_signals` (5s client batches of extension events)
- `processed_intents` (distilled summaries)

ClickHouse has an **in-memory fallback** (`db/clickhouse.ts`) that activates when the container is missing, so dev still works without it.

### 4.5 MCP server (`src/mcp/`)

JSON-RPC 2.0 over WebSocket (`/mcp`) and a REST bridge (`/api/mcp-rest`). 12 tools live in `src/mcp/tools/`:

```
query_index           Vector + fuzzy search over the workspace index
set_scope             Set the active project scope for this session
save_conversation     Persist a chat conversation with reasoning trail
read_file             Read file content (text, doc, PDF) with full reasoning per assistant message
contribute            Add evidence to the semantic index
send_message          Send a message to workspace chat
send_conversation     Send a conversation to a dedicated thread
get_activity          Recent user activity
detect_contradictions Find contradictions in indexed documents
directory_query       Query the user / workspace directory
scope_configure       Configure advanced scope rules
discover_similar      Find documents similar to a query
```

See `docs/AI_SYSTEM.md` §4 for the read/write contract and known gotchas.

### 4.6 Lib (`src/lib/`)

- `ai-client.ts` — Claude API wrapper (prompt caching, streaming)
- `llm-logger.ts` — Cost tracking aggregator
- `s3.ts` — AWS S3 client; `ensureBucket()` auto-provisions on first write (BUCKET-1)
- `content-hash.ts` — SHA-256 of file content (matches desktop-agent dedup)

### 4.7 Scripts (`src/scripts/`)

```
init-db.ts            Drizzle schema push
seed*.ts              Dev users, discover, queries, scope, templates, constants, reset
backfill-index.ts     Re-index a workspace
migrate-*.ts          Data migrations (versioning, timeline→threads, index columns)
```

## 5. Web app (`apps/web`)

Next.js 14 app-router. Pages live in `src/app/`. State is Zustand (33 stores under `src/stores/`); server data is TanStack Query. Yjs (`y-websocket`) syncs collaborative documents to API port 3003. Auth is NextAuth with the Drizzle adapter.

See `docs/UI_INVENTORY.md` for the full page / store / component breakdown.

The web layer is heavily gated by `apps/web/src/config/feature-vault.ts` — almost every editor and advanced surface is currently `active: false`, leaving the stripped-down management UI (items, index, settings) as the live surface.

## 6. Other apps

| App             | What it is                                                                                                                                                                                                 | State                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `desktop-agent` | Node daemon, watches local folders, dedups by SHA-256, syncs to `/api/raw-files`. Config in `follow-agent.config.json`. Presets: `open` (auto), `balanced` (log + approve, partial), `private` (log only). | Active                                    |
| `extension`     | Chrome MV3 — popup, content scripts, service worker, signal capture, offline queue.                                                                                                                        | Active (frontend currently de-emphasised) |
| `gws-extension` | Chrome MV3 — Google Workspace overlay (separate from `extension`).                                                                                                                                         | Active                                    |
| `gws-addon`     | Google Apps Script project — sidebar, strand context, AI insert into Docs/Sheets/Slides.                                                                                                                   | Active, deployed via clasp                |
| `mobile`        | React Native + Expo.                                                                                                                                                                                       | Scaffold only; not maintained             |

## 7. Data flow (high level)

```
┌───────────────────── inputs ──────────────────────┐
│  Web app   Extension   GWS addon   Desktop agent  │
└─────────────┬────────────┬───────────┬────────────┘
              │            │           │
              │  signals   │ snapshots │ raw files (SHA-256 dedup)
              ▼            ▼           ▼
       ┌─────────────────────────────────────┐
       │           API (:3001)               │
       │  routes/* → services/*              │
       └──┬───────────────┬──────────────┬───┘
          │ Postgres      │ ClickHouse   │ S3 / MinIO
          ▼               ▼              ▼
   files, threads,   thread_signals,   raw_files
   chat, ai_state,   processed_intents content
   index_records,    (5s batches)
   evidence …
          │
          ▼
   ┌─────────────────────────────────────┐
   │ Indexing pipeline (5 roles)         │
   │ REPORTER → ANALYST → EDITOR →       │
   │ ARCHIVIST → PROFILER                │
   └──────┬──────────────────────────────┘
          ▼
   index_records (facts) + aiState (memory)
          │
          ▼
   ┌─────────────────────────────────────┐
   │  Reference agent (4 stages)         │
   │  classify → plan → retrieve → assemble
   └──────┬──────────────────────────────┘
          ▼
   Chat completion / MCP tool responses
```

See `docs/AI_SYSTEM.md` for what each pipeline role and reference-agent stage actually does.

## 8. Auth & sharing

- **Auth:** NextAuth on web side, JWT sessions, Drizzle adapter. Providers: Google, GitHub, Resend (email magic-link). Roles: `owner > admin > editor > viewer`.
- **API auth:** middleware reads JWT cookie or `Authorization: Bearer` for agent keys (HMAC-signed). Dev bypass via `DEV_BYPASS_AUTH=true` (seeds a dev user).
- **Sharing layer:** privacy presets (`Private`, `Balanced`, `Open`) + custom rules; passcode-locked slices with 30-min TTL; sync events to subscribers. Live in `services/sharing/` and `db/schema/sharing.ts`.

## 9. Feature vaults

There are two vaults, kept symmetric:

- **`apps/web/src/config/feature-vault.ts`** — UI gates. ~22 flags (canvas-editor, rich-text-editor, file-browser, comments, …). All currently `active: false` in the stripped state.
- **`packages/api/src/config/server-vault.ts`** — Server gates. ~13 flags. Currently active: `scheduler-sync`, `route-chat`. Everything else off.

Flag changes are read at startup, not at runtime — restart the API after flipping a flag. Inspect runtime state via `POST /api/admin/server-vault` (always mounted) and the dashboard.

## 10. Launcher & dashboard

`scripts/launch.ts` is the single entry point. It:

1. Loads `packages/api/.env.local` and `.env` **before** spawning children (STABILIZE-1 fix — otherwise children fall back to PGlite).
2. Runs `docker compose up -d`, polls postgres + redis readiness.
3. Spawns `npx tsx packages/api/src/index.ts` (API), polls `/health`.
4. Spawns `npx next dev --port 3009`, polls home.
5. Starts ngrok (self-installs via winget if missing, self-updates, reads token from `%LOCALAPPDATA%\ngrok\ngrok.yml` / `$NGROK_AUTHTOKEN` / `.ngrok-authtoken`).
6. Spawns desktop-agent (if config present).
7. Starts dashboard server on `:4000`; auto-opens `:4000` and `:3009` in default browser.

Dashboard (`scripts/dashboard.html`, ~2300 lines) is a single-page React app served by `dashboard-server.ts`. 7 tabs: Overview, Logs, Network, MCP, Timeline, Index, Settings. Live data streams from API over WebSocket at `ws://localhost:4000/ws`. The MCP tab reads `launcher?.ngrok?.url` to surface the public endpoint.

## 11. Build & test

```
pnpm dev        # turbo run dev across all packages
pnpm build      # turbo run build
pnpm test       # turbo run test (Vitest)
pnpm typecheck  # turbo run typecheck
pnpm lint       # turbo run lint
pnpm db:push    # drizzle-kit push to Postgres (local dev only)
pnpm db:studio  # Drizzle Studio
```

Production/Railway deploys run `db:deploy`, which since **MIGRATE-1** applies the single regenerated Drizzle baseline via `drizzle-kit migrate` (safe on populated DBs) — not `push --force`. See `docs/audits/MIGRATE-1-REPORT.md`.

Tests are Vitest. Web tests use React Testing Library. API tests use supertest. ~1250 tests; most pass post-`WEB-TSC-SWEEP-*` arc.

TS typecheck baseline as of `WEB-TSC-CUT-DEBT-COMBINED-1`: web 0 errors, api ~160 (mostly in code paths gated off; tracked in `docs/KNOWN_ISSUES.md`).

## 12. Where to look next

- **AI behavior, pipeline roles, MCP contracts, model tiers** → `docs/AI_SYSTEM.md`
- **UI surfaces, routes, stores, components, what's gated off** → `docs/UI_INVENTORY.md`
- **Coding conventions, file naming, startup, MCP authoring** → `docs/CONVENTIONS.md`
- **Live gotchas, type debt, env quirks** → `docs/KNOWN_ISSUES.md`
- **What landed when** → `docs/SPRINT_HISTORY.md`
- **Pre-strip / historical** → `_archive/docs-2026-05-13/`

## ANCHOR-1 (2026-06-02) — anchor substrate

Additive, gated tables `anchors` + `anchor_edges` carry hooks into source artifacts with a **versioned meaning** (the embeddable handle) + audit history, a typed `span` (text_range/pdf_box/image_region/message_ref), contributor `flavors`, and facet-embedding refs. Zod contract: `@workspace/shared/schemas` (`AnchorSchema`/`AnchorEdgeSchema`). Persistence: `packages/api/src/db/schema/anchors.ts`, captured in the single regenerated Drizzle baseline as of **MIGRATE-1** (legacy `index_records` untouched). Write path: `services/pipeline/anchor-writer.ts` (`buildAnchor` + gated `writeAnchorsForRecords`), invoked from `indexer.ts` only when the `node-anchors` vault flag is on (default off ⇒ byte-identical pipeline). See `docs/audits/ANCHOR-1-REPORT.md`.

## ADAPTER-1 (2026-06-02) — FollowAPI port

`@workspace/shared/schemas/follow-api.schema.ts` defines the window-agnostic **`FollowAPI`** contract: a typed interface over the 9 MCP-tool operations (query/contribute/getActivity/detectContradictions/setScope/readFile/directoryQuery/sendMessage/saveConversation), per-op Zod request/response schemas, a `FOLLOW_API_OPERATIONS` registry, and the **`QuerySpec`** union (point|regional|directional|trajectory|contrastive — schema only). The web adapter `apps/web/src/lib/follow-api.ts` (`followApi: FollowAPI`) posts to the mcp-rest bridge. A contract test (`mcp/tools/__tests__/follow-api-contract.test.ts`) guards drift between the shared contract and the backend tools' JSON Schemas. See `docs/audits/ADAPTER-1-REPORT.md`.

## GRAPH-1 (2026-06-02) — pipeline graph harness

`packages/api/src/services/pipeline/graph/` is an additive LangGraph router-over-shared-state harness (deps `@langchain/langgraph` + `@langchain/langgraph-checkpoint-postgres`). It runs in **shadow** (no writes) unless `meta.persist` is set; gated by the `pipeline-graph` vault flag (default off), so the live `runner`-driven pipeline is byte-identical when off. Entry: `runPipelineGraph()` in `graph/index.ts`; verdict via shared `computeShadowVerdict`. See `docs/audits/GRAPH-1-REPORT.md`.
