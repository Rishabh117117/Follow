# Follow — an AI-native workspace platform

Follow watches the work you already do — browser activity, Google Workspace files, uploaded documents, AI conversations — and distills it into a living, queryable memory. A five-role indexing pipeline (Reporter → Analyst → Editor → Archivist → Profiler) turns raw activity into versioned facts with provenance, typed relationships between them (including contradictions), and long-term memory layers. The Follow dashboard lets you browse and interrogate that memory; an MCP server exposes the same memory to external agents, so Claude or ChatGPT can query what you know, save conversations into it, and share context across tools.

This is the actual production codebase behind the Follow product shown in [Rishabh Salian's portfolio](https://rishabhsalian.design/work/follow). The portfolio page runs a faithful interactive replica of the dashboard; the source of that demo lives in [`demo/`](demo/), and the real system it replicates lives in the rest of this repo.

> **Snapshot note.** Published 2026-07-24 as a clean snapshot after CLEANUP-1, a full strip of parked feature surfaces (early explorations of canvas, rich-text/spreadsheet/presentation editors, notebooks, threads, timeline, and capture UIs were removed after being feature-flagged off since April). Day-to-day development continues in a private working repository; this mirror is refreshed from it.

## What's here

| Path                             | What it is                                                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/api`                   | The platform server (Hono): HTTP API, the 5-role indexing pipeline, the reference agent (active recall), the MCP server, chat completion, memory + sharing services, Drizzle schema |
| `apps/web`                       | The Follow dashboard (Next.js 14): items, memory, vault, settings, share pages, notes editor                                                                                        |
| `apps/extension`                 | Chrome extension that streams activity signals (5s batches over WebSocket)                                                                                                          |
| `apps/gws-extension`             | Google Workspace extension: Docs/Sheets/Slides snapshots + floating assistant                                                                                                       |
| `apps/desktop-agent`             | Local folder watcher that syncs files into the workspace                                                                                                                            |
| `apps/mobile`                    | Expo mobile client shell                                                                                                                                                            |
| `packages/shared`, `packages/ui` | Shared types/constants and UI primitives                                                                                                                                            |
| `scripts/`                       | Dev launcher (`launch.ts`), dev console, preflight gates for pipeline changes                                                                                                       |
| `docs/`                          | Architecture notes and 30+ engineering audit reports (`docs/audits/`)                                                                                                               |
| `demo/`                          | Source of the portfolio's interactive Follow demo (sandbox replica of the dashboard)                                                                                                |

## How it works

- **Ingest.** Three input paths feed the system: extension signals (WebSocket → ClickHouse), Google Workspace snapshots (`/api/gws`), and content-addressed raw files (`/api/raw-files`, SHA-256 dedup, S3/MinIO storage). AI conversations enter through the chat fact extractor; native uploaded documents produce versioned facts through the doc fact extractor.
- **The pipeline.** Five LLM roles with heterogeneous models transform activity into an evidence graph: nodes (`index_records`) carry provenance and embeddings; the Analyst classifies typed edges between cosine-near facts (references / supports / contradicts / elaborates / supersedes); memory layers accumulate per-user state.
- **Versioned facts.** When a document changes, re-syncing retires facts whose content disappeared (`superseded_at`) and carries forward what survived, so retrieval always answers from the current version while history remains.
- **Contested knowledge.** Cross-author contradictions are surfaced, not auto-resolved: retrieval attributes each fact to its author and marks conflicting pairs as contested, with both sides shown.
- **Active recall.** A reference agent (classify → plan → retrieve → assemble) sits in front of chat completion and injects the relevant slice of workspace memory into every conversation.
- **MCP.** The same memory is exposed over the Model Context Protocol at `/mcp` (SSE for Claude, REST bridge for ChatGPT Actions), with per-key auth, project scoping, and tools for querying, saving conversations, and sharing.

## Tech stack

Next.js 14 · Hono · Drizzle ORM · PostgreSQL + pgvector · Redis · ClickHouse (with an in-memory fallback) · MinIO/S3 · OpenRouter models (Gemma / DeepSeek / Qwen tuned per pipeline role) · LangGraph with a Postgres checkpointer for durable pipeline runs · PGlite for dev/test · Vitest (~1,350 tests) · pnpm + Turborepo monorepo · Docker · deployed on Railway.

## Getting started

```bash
pnpm install
docker compose up -d      # Postgres (pgvector), Redis, ClickHouse, MinIO
pnpm db:push
npx tsx scripts/launch.ts # full stack: API :3001, web :3009, dev console :4000
```

`pnpm dev` runs the turbo dev tasks without Docker (the API falls back to in-process PGlite / in-memory stores, useful for poking at the UI). Copy `.env.example` to `packages/api/.env.local` and set `OPENROUTER_API_KEY` to exercise the AI paths. The stack runs single-user by design; multi-tenant hardening is staged work.

## Commands

| Command                           | Description                                             |
| --------------------------------- | ------------------------------------------------------- |
| `npx tsx scripts/launch.ts`       | One-click full stack (Docker + API + Web + Dev console) |
| `pnpm dev`                        | Start all apps in dev mode (no Docker)                  |
| `pnpm build`                      | Build all packages                                      |
| `pnpm typecheck` / `pnpm lint`    | Type checking / ESLint                                  |
| `pnpm db:push` / `pnpm db:studio` | Push schema to Postgres / open Drizzle Studio           |

## Services

| Service               | Port | Purpose                   |
| --------------------- | ---- | ------------------------- |
| Next.js web app       | 3009 | The Follow dashboard      |
| API server (Hono)     | 3001 | Backend API + MCP         |
| Dev console           | 4000 | Monitoring + live traffic |
| PostgreSQL + pgvector | 5432 | Primary database          |
| Redis                 | 6379 | Caching, sessions         |
| ClickHouse            | 8123 | High-volume signal store  |
| MinIO (S3)            | 9000 | Raw file object storage   |

## Reading guide

Start with [`CLAUDE.md`](CLAUDE.md) (the working mental model), then `packages/api/src/services/pipeline/` and `services/semantic-index/` for the pipeline, `services/reference-agent/` for recall, `mcp/tools/` for the agent surface, and `apps/web/src/components/follow/` for the dashboard. The audit reports in [`docs/audits/`](docs/audits/) document how each major change was verified — they are the engineering diary of this codebase.
