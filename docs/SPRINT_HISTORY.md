# Sprint History

Chronological digest of completed sprints. Each line is a sprint code + landing date + one-sentence summary. For full sprint write-ups see `_archive/docs-2026-05-13/CLAUDE-2026-04-23.md` and the per-sprint reports in `_archive/docs-2026-05-13/root-reports/` and `docs/audits/`.

Read from the bottom up for chronological order; the most recent work is at the top.

---

## 2026-04 / 2026-05 — Stabilization & debt reduction

| Sprint                         | Date       | Summary                                                                                                                                           |
| ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH-LOGIN-SUSPENSE-1`        | 2026-05-12 | Wrap `useSearchParams` in a Suspense boundary on the login page (Next.js 14 requirement).                                                         |
| `WEB-TSC-CUT-DEBT-COMBINED-1`  | 2026-05-10 | TS-error cleanup on web: rename `prov` → `memory` in unit chat panel; rewrite `notebooks-grid.tsx` and `notebook-picker.tsx` to direct API fetch. |
| `WEB-TSC-SWEEP-PROD-NULL-1`    | 2026-05-08 | Production null/variance fixes: `dash-grid-view.tsx`, `use-section-tracker.ts`, `CreateStrandFlow.tsx`.                                           |
| `WEB-TSC-SWEEP-TEST-ONLY-1`    | 2026-05-06 | Test-only TS cleanup: `timeline-logic`, `screenshot-logic`, `notebook`, `doc-intel-web`, `threads-ui`, `polish-v2`, `follow-notes`.               |
| `WEB-TSC-TRIAGE-1`             | 2026-05-04 | Triage report of remaining web TS errors.                                                                                                         |
| `PDF-VIEWER-OBJECTSTYLE-FIX-1` | 2026-05-03 | Fix `fontWeight` ObjectStyle issue in PDF viewer.                                                                                                 |
| `PAGE-SHAPE-CLEANUP-1`         | 2026-05-01 | Settings pages refactor — extracted `_body.tsx` per route to satisfy Next.js page contract.                                                       |
| `LINT-BASELINE-1`              | 2026-04-30 | Consistent import cleanup and lint baseline pass.                                                                                                 |
| `LAUNCHER-LOG-BUFFER-1`        | 2026-04-29 | API log streaming buffered to `logs/api.log` for dashboard tail.                                                                                  |
| `SERVER-VAULT-DASHBOARD-1`     | 2026-04-29 | New `/api/admin/server-vault` inspector; dashboard surfaces feature-flag state.                                                                   |
| `POST-STRIP-CLEANUP-1`         | 2026-04-28 | Archived procedural routes; cleaned lint configs after CORE-STRIP-3.                                                                              |
| `KNOWLEDGE-EDGES-DROP-1`       | 2026-04-27 | Dropped `knowledge_edges` table + enum (unused).                                                                                                  |
| `CORE-STRIP-3`                 | 2026-04-26 | Route gates extended to all non-core HTTP endpoints (timeline, chat, comments, threads, etc.).                                                    |
| `CORE-STRIP-RESTART-SMOKE`     | 2026-04-26 | End-to-end smoke validating gated-off state still boots.                                                                                          |
| `CORE-STRIP-2`                 | 2026-04-25 | `server-vault.ts` introduced; 5 non-core schedulers in `index.ts` made flag-gated.                                                                |
| `CORE-STRIP-1`                 | 2026-04-24 | First round of feature-vault gating on the web side.                                                                                              |
| `RELATIONSHIP-SCAN-CUT-1`      | 2026-04-23 | Removed relationship-scan writer from `indexing-agent`.                                                                                           |
| `EDGE-TYPE-VERIFY-1`           | 2026-04-22 | Edge-type schema verification report.                                                                                                             |
| `AUDIT-CORE-1`                 | 2026-04-21 | Service-dependency audit; documented post-refactor landscape (see `docs/audits/AUDIT-CORE-1-REPORT.md`).                                          |
| `GOVERNANCE-AUDIT-FIX-1`       | 2026-04-21 | Targeted correctness fixes on 3 MCP tools (governance layer).                                                                                     |

## 2026-04 — MCP & model strategy

| Sprint          | Date          | Summary                                                                                                                                                                                                                                                                                                                         |
| --------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP-FIX-5`     | 2026-04-21    | `save_conversation` round-trips reasoning provenance: accepts `conversation_id` for update-in-place, syncs `chat_artifact` wrapper raw_file on every save, accepts alias fields, `normalizeSources()` for source coercion, sets `space_id` on project creates. `read_file` surfaces full reasoning trail per assistant message. |
| `BADGE-1`       | 2026-04-21    | `IndexStatusBadge` renders for all non-fact items; new Cancel button wired to `/api/index-queue/jobs/:jobId/cancel`. Status endpoint resolves conversation IDs → wrapper raw_file.                                                                                                                                              |
| `CHAT-INDEX-1`  | 2026-04-21    | New `services/semantic-index/chat-fact-extractor.ts` post-index hook: chat artifacts produce `index_records` without the realtime-capture pipeline. Fixed `buildAITemplate` in `compose-embedding-text.ts`.                                                                                                                     |
| `BUCKET-1`      | 2026-04-21    | `lib/s3.ts` `ensureBucket()` auto-provisions MinIO/S3 bucket on first write (HEAD → CreateBucket on miss, memoized).                                                                                                                                                                                                            |
| `MODEL-1`       | 2026-04-21    | Originally pointed all tiers at `google/gemma-4-31b-it:free`; subsequently superseded by the 5-role pipeline (REPORTER/ANALYST/EDITOR/ARCHIVIST/PROFILER) verified 2026-04-29 against the v5.2 product doc. New `ACTIVE_TIERS` export.                                                                                          |
| `MCP-FIX-4`     | 2026-04-18    | `filePaths[]` parallel array preserves folder structure into `raw_files.file_path`. Per-folder queue controls.                                                                                                                                                                                                                  |
| `MCP-3`         | 2026-04-18    | Conversation versioning: `chat_conversations.{content_hash, version}`, `chat_messages.superseded_by_message_id`, new `chat_conversation_snapshots` table. Idempotent `save_conversation`. Upload/index split.                                                                                                                   |
| `STABILIZE-3`   | 2026-04-17    | `AddToIndexModal` + `McpReadyIndicator`. Persistent queue state (`data/queue-state.json`). `raw_files.space_id`. Paused/stopped queues no longer auto-resume.                                                                                                                                                                   |
| `WIRE-2`        | 2026-04-17    | `items-view.tsx` rewritten as unified list+tree+detail over conversations/files/facts. Per-file status badges.                                                                                                                                                                                                                  |
| `LAUNCH-2`      | 2026-04-14    | ngrok hardening: self-install, self-update, authtoken caching. Dashboard reads `launcher?.ngrok?.url`.                                                                                                                                                                                                                          |
| `MCP-FIX-1..3`  | 2026-04-14/15 | MCP read/write pipeline stabilization.                                                                                                                                                                                                                                                                                          |
| `STABILIZE-1/2` | 2026-04-14    | Launcher loads `.env.local` before spawning children; auth middleware updates; desktop-agent onboarding.                                                                                                                                                                                                                        |

## 2026-04 — Architecture additions

| Sprint      | Date       | Summary                                                                                                                                                                   |
| ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IX-8/9/10` | 2026-04-09 | New semantic-index tables: `gws_snapshots`, `index_record_states`, `raw_files`. Hash-chain evidence, sealed snapshots, reading context.                                   |
| `RA-1/2`    | 2026-04-09 | `services/reference-agent/` introduced: 4-stage pipeline (classify → plan → retrieve → assemble).                                                                         |
| `SH-1/2/3`  | 2026-04-09 | Sharing layer: passcode locks, privacy filters (Private/Balanced/Open), slice builder, context-request sync.                                                              |
| `FE-4/5`    | 2026-04-09 | Frontend surfaces for chat citations, lock indicator, REQUEST INBOX, preset selector, passcode dialog. Sharing store.                                                     |
| `FV-1`      | 2026-04-09 | First wave of feature-vault gating (web). Unmounted `capture-ask`, `document-context` routes.                                                                             |
| `DA-1`      | 2026-04-09 | Desktop Agent onboarding flow + hash-dedup against `/api/raw-files/check-hash`.                                                                                           |
| `CL-1`      | 2026-04-08 | Dead code purge: 15 of 17 audit-flagged files removed (`capture/analyze.ts` and `capture/browsing-context.ts` retained — live via dynamic import in `routes/capture.ts`). |

## Pre-2026-04 — Feature-build era (archived in detail)

These sprints are referenced for context only; details live in `_archive/docs-2026-05-13/CLAUDE-2026-04-23.md`.

- `N1..N4` — Notebook editor (10 block types, Yjs per-document, page templates, AI annotation).
- `IX-4..IX-7` — AI State system (4 layers: Immediate/Event/Session/Persistent; reflector + condenser + extraction + pattern detection).
- `FE-1..FE-3` — Frontend follow-mode refactor (three-column editor layout, canvas panels, ItemsView v1/v2).
- `G6..G8` — Google Workspace addon + extension (sidebar, strand context, snapshot capture, provenance panel).
- `M1..M5` — Inline AI Materialization (Ghost Draft nodes, Highlight Revision cards, commit handler, provenance signals).
- `D1..D6` — v8 UI overhaul (Figma-style Follow Dashboard, three-column editor, Canvas/Focus toggle).
- `F2` — Live Recording removed from UI (web mode → signal-only capture). Backend infra retained but dormant.
- Sprints 1..24 — Original buildout. Tables and historic notes archived in `_archive/docs-2026-05-13/docs/APP_STATUS.md` §5–9.

---

## What "completed" means here

A sprint is listed as completed when its changes are merged on `main` and verified by smoke tests. Many of the features referenced (canvas editor, rich-text editor, notebooks, threads, timeline, etc.) are now **gated off by default** via the feature/server vaults — the code is on disk but inactive. See `apps/web/src/config/feature-vault.ts` and `packages/api/src/config/server-vault.ts` for the live flag set, or `docs/UI_INVENTORY.md` for which surfaces this hides.

The current product spine is the 5-role indexing pipeline + chat + MCP + dashboard. Everything else is dormant pending re-activation.
