# CORE-STRIP-3 — API Route Gating Report

**Date:** 2026-04-22
**Author:** Claude Code
**Sprint:** CORE-STRIP-3 (source-modifying, archive-backed)
**Status:** Complete-with-deferred-runtime-check — tsc + tests + pre-cut health all pass; post-restart startup-log validation (Gate E) deferred to next launcher restart (shared deferral with CORE-STRIP-2).
**Repo commit SHA at sprint start:** `3d2e1ce`
**Repo commit SHA at sprint end:** `b802a03` (final commit will be this report's commit)

---

## 0. Executive summary

- **13 route flags added to `server-vault.ts`**, each `category: 'route'`, all default `active: false`. Plus 14 mount blocks in `app.ts` (one shared flag for the two `/api/timeline` mounts) wrapped in `if (isServerFeatureActive(...)) { app.route(...) } else { console.info('[Startup] route-X gated off ...') }`. Import of `isServerFeatureActive` added to `app.ts`.
- **3 routes originally slated for gating were downgraded to KEEP** after Phase 2 cross-check: `doc-memory` (Items ShareV2Panel), `prompting` (settings/ai), `memory-sections` (Follow dashboard Memory view). Documented in §2.
- **Verification:** tsc parity (164 errors — zero new in modified files), test parity (12 failed / 85 passed files, 9 failed / 883 passed / 125 skipped tests — identical to CORE-STRIP-2 exit), pre-cut `/api/health` still 200 with 12 MCP tools. Gate E (post-restart) deferred — running dev server is pre-cut.

---

## 1. Pre-flight baseline

| Check                                   | Result                                                                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branch                                  | `main`                                                                                                                                                                                                             |
| Starting SHA                            | `3d2e1ce CORE-STRIP-2: finalize report, README, diffs, and CLAUDE.md`                                                                                                                                              |
| tsc (`packages/api`)                    | **164 errors**, all in known-baseline files (yjs-text-extractor, import-thread, export-page, recording-session-finalizer, query-executor, thread-distillation, test files). None in `app.ts` or `server-vault.ts`. |
| API tests                               | **12 failed / 85 passed** test files, **9 failed / 883 passed / 125 skipped** tests — all pre-existing pglite WASM env failures.                                                                                   |
| `/api/health` on running pre-cut server | 200 OK, 12 MCP tools enumerated, postgres/clickhouse/redis/s3 all green.                                                                                                                                           |
| `git status` line count                 | 464 (unrelated in-flight scaffolding).                                                                                                                                                                             |

Baseline identical to CORE-STRIP-2 exit state. Proceeding.

## 2. Route-mount inventory + KEEP-surface verification

All route mounts live in `packages/api/src/app.ts` (confirmed via grep; `index.ts` has no `app.route` calls). 47 mount lines total, of which the sprint scope proposed to gate 16.

Phase 2 evidence (grep of `/api/X` callers in `apps/web/src` for each target, plus reverse-trace through React component composition to determine whether any caller is reachable from a KEEP surface):

| Route                                              | Callers found                                                                                                                                                                                                                                                      | KEEP reach? | Final verdict                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------- |
| `/api/chat`                                        | `app/workspace/[id]/chat/page.tsx` (GATED in CORE-STRIP-1), `components/canvas/use-canvas-chat.ts` (canvas is GATED)                                                                                                                                               | **No**      | **GATE** `route-chat`                                                                           |
| `/api/capture`                                     | `app/workspace/[id]/captures/page.tsx` (GATED), `components/capture/bookmarklet-generator.tsx` (gated feature)                                                                                                                                                     | **No**      | **GATE** `route-capture`                                                                        |
| `/api/capture/realtime`                            | companion of `/api/capture`; same callers                                                                                                                                                                                                                          | **No**      | **GATE** `route-capture-realtime`                                                               |
| `/api/threads`                                     | `components/threads/ThreadsPage.tsx` (GATED), `components/editors/rich-text/doc-control-bar.tsx` (editor is GATED), `components/threads/TimelineLanes.tsx` (timeline is GATED)                                                                                     | **No**      | **GATE** `route-threads`                                                                        |
| `/api/strands`                                     | `components/follow/strand-section.tsx` → rendered by `components/follow/editor-panels/right-panel.tsx:486` → editor panel → rich-text-editor is GATED                                                                                                              | **No**      | **GATE** `route-strands`                                                                        |
| `/api/doc-memory`                                  | `stores/doc-memory-store.ts` (editor-gated consumer), `components/follow/share-v2-panel.tsx:410` → rendered by `item-action-menu.tsx` → used in `items-view.tsx` (**Items KEEP surface**)                                                                          | **YES**     | **KEEP** (downgrade from GATE)                                                                  |
| `/api/doc-intelligence`                            | `app/pdf-viewer/page.tsx` (pdf-viewer is GATED via existing `pdf-viewer` flag), `components/canvas/pdf-viewer-overlay.tsx` (GATED), `components/editors/presentation/presentation-editor.tsx` (GATED), `components/editors/rich-text/rich-text-editor.tsx` (GATED) | **No**      | **GATE** `route-doc-intelligence`                                                               |
| `/api/doc-intelligence-web`                        | same callers as `/api/doc-intelligence`                                                                                                                                                                                                                            | **No**      | **GATE** `route-doc-intelligence-web`                                                           |
| `/api/notebooks`                                   | `app/workspace/[id]/notebook/[fileId]/page.tsx` (GATED), `components/notebook/*` (family GATED)                                                                                                                                                                    | **No**      | **GATE** `route-notebooks`                                                                      |
| `/api/prompting`                                   | `app/settings/ai/page.tsx:53` (**/settings/ai is KEEP**), `components/chat/prompt-card.tsx` (gated), `hooks/use-prompt-cards.ts`                                                                                                                                   | **YES**     | **KEEP** (downgrade from GATE)                                                                  |
| `/api/procedural`                                  | `stores/procedural-store.ts` → `components/follow/procedural/procedural-patterns-panel.tsx` → rendered by `editor-panels/right-panel.tsx:136` (editor panel, GATED)                                                                                                | **No**      | **GATE** `route-procedural`                                                                     |
| `/api/comments`                                    | `stores/comment-store.ts` → `components/follow/comment-overlay.tsx` → rendered by `editors/rich-text/rich-text-editor.tsx:861` (GATED)                                                                                                                             | **No**      | **GATE** `route-comments`                                                                       |
| `/api/timeline` (events + summaries + annotations) | `components/canvas/canvas-timeline.tsx` (GATED), `components/layout/horizontal-timeline.tsx` → only rendered by canvas pages (GATED)                                                                                                                               | **No**      | **GATE** `route-timeline` (covers both `timelineRouter` and `timelineAnnotationsRouter` mounts) |
| `/api/memory`                                      | `components/follow/memory-view.tsx:42` → rendered by `follow-main.tsx:17` when `sidebarView === 'memory'` — **Follow dashboard Memory view is KEEP**                                                                                                               | **YES**     | **KEEP** (downgrade from GATE)                                                                  |
| `/api/follow-notes`                                | `stores/follow-notes-store.ts` → consumed only from editor-gated surfaces (rich-text-editor, right-panel, clip-context-menu inside rich-text)                                                                                                                      | **No**      | **GATE** `route-follow-notes`                                                                   |
| `/api/recording-sessions`                          | `components/timeline/events-view.tsx` (timeline UI GATED)                                                                                                                                                                                                          | **No**      | **GATE** `route-recording-sessions`                                                             |

**Net:** 13 GATE, 3 KEEP (downgraded: `doc-memory`, `prompting`, `memory-sections`). No MCP tool was found calling any of these routes (expected — MCP tools operate in-process, not via HTTP).

## 3. Archive scaffolding

Created `_archive/2026-04-22-core-strip-3/` with subdirs (`snapshots/`, `diffs/`, `archived-tests/`, `audits/`). Snapshotted:

- `packages/api/src/app.ts`
- `packages/api/src/config/server-vault.ts` (CORE-STRIP-2 exit state — 5 scheduler flags, no route flags yet)

`diff -q` confirmed parity. Authorising audits (`AUDIT-CORE-1-REPORT.md`, `CORE-STRIP-2-REPORT.md`) copied into `audits/`. Committed as `e6d58e8` before any source edit.

## 4. server-vault.ts additions

13 new entries appended to `SERVER_VAULT`, all with `category: 'route'` and `active: false`. Same shape as the 5 scheduler entries from CORE-STRIP-2. JSDoc block introducing the group explains the cut-reach rule and names the three downgraded routes explicitly.

Flag IDs: `route-chat`, `route-capture`, `route-capture-realtime`, `route-threads`, `route-strands`, `route-doc-intelligence`, `route-doc-intelligence-web`, `route-notebooks`, `route-procedural`, `route-comments`, `route-timeline`, `route-follow-notes`, `route-recording-sessions`.

Vault file total: **5 scheduler flags + 13 route flags = 18 flags. 17 inactive, 1 active (`scheduler-sync`).**

**Commit:** `1c69b0e` — `CORE-STRIP-3: add 13 route flags to server-vault`. +110 / −0.

## 5. app.ts modifications

Added 1 import line:

```ts
import { isServerFeatureActive } from './config/server-vault'
```

Wrapped 14 `app.route(...)` calls (13 distinct flags, `route-timeline` used twice). Pattern per mount (abbreviated; full diff in `_archive/.../diffs/app.ts.diff`):

```ts
// BEFORE
app.route('/api/chat', chatRouter)

// AFTER
if (isServerFeatureActive('route-chat')) {
  app.route('/api/chat', chatRouter)
} else {
  console.info('[Startup] route-chat gated off via server-vault (/api/chat not mounted)')
}
```

Each `else` log includes both the flag id and the mount path so startup stdout is legible when grepping. The two `/api/timeline` mounts share `route-timeline` but have distinct log messages (`... /api/timeline not mounted` vs `... /api/timeline annotations not mounted`) so operators can still see which router would have been mounted.

Prettier (run via lint-staged on commit) reformatted some of the longer `console.info` strings onto multi-line argument syntax — cosmetic only.

**Commit:** `b802a03` — `CORE-STRIP-3: gate 13 non-core routes behind server-vault flags`. +155 / −12.

## 6. Orphan check

Post-edit grep results:

| Check                                                        | Expected                | Actual                                                      |
| ------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------- |
| `isServerFeatureActive('route-...')` occurrences in `app.ts` | 14 (13 flags + 1 reuse) | **14** ✓                                                    |
| `isServerFeatureActive('route-timeline')` specifically       | 2                       | **2** ✓                                                     |
| Unguarded `app.route(...)` calls for any gated path          | 0                       | **0** ✓                                                     |
| Route handler imports still present                          | 13 (all handler files)  | **15** (13 gated + 2 KEEP — confirmed all imports intact) ✓ |

The handler-file imports stay in the module graph even when their mount is gated. This keeps the diff small, avoids cascading tsc errors from removed-but-still-used imports, and means re-activating a flag is a pure config change.

## 7. Verification

| Gate                                           | Result                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — tsc parity (`packages/api`)**            | **164 errors** — identical to baseline, zero new in any modified file. ✓                                                                                                                                                                                                                                                                                       |
| **B — test parity**                            | **12 failed / 85 passed** test files, **9 failed / 883 passed / 125 skipped** tests — identical to baseline. All failures are pre-existing pglite WASM env issues. ✓                                                                                                                                                                                           |
| **C — pre-restart `/api/health`**              | 200 OK, postgres/clickhouse/redis/s3 all green, 12 MCP tools enumerated. The running server is pre-cut code; this gate confirms my changes didn't break the build, not that they work at runtime. ✓                                                                                                                                                            |
| **D — MCP tool enumeration on pre-cut server** | All 12 MCP tools still listed in `/api/health`. (Trivial pass — MCP operates in-process; route gating doesn't affect MCP tool dispatch.) ✓                                                                                                                                                                                                                     |
| **E — post-restart startup log**               | **Deferred.** After the next API restart, startup output is expected to contain 14 `[Startup] route-X gated off via server-vault (/api/X not mounted)` lines (route-timeline twice, 12 others once each) alongside the 4 scheduler-gated lines from CORE-STRIP-2. This shared deferral with CORE-STRIP-2 means one restart will validate both sprints at once. |
| **Orphan sweep**                               | No unguarded top-level `app.route(...)` for any gated path; all 14 guarded as expected. ✓                                                                                                                                                                                                                                                                      |

## 8. Rollback notes

No rollbacks required. Each phase's commit landed cleanly. The pre-commit hook's `--max-warnings=0` lint rule didn't flag anything this sprint — the console.info method was established by CORE-STRIP-2, and Prettier's multi-line reformat of long strings on commit was cosmetic only.

## 9. Archive contents

```
_archive/2026-04-22-core-strip-3/
├── README.md                                 (restoration + divergences from spec)
├── archived-tests/                           (empty)
├── audits/
│   ├── AUDIT-CORE-1-REPORT.md
│   └── CORE-STRIP-2-REPORT.md
├── diffs/
│   ├── app.ts.diff                           (142 lines — 14 wrapped mounts + 1 import)
│   └── server-vault.ts.diff                  (119 lines — 13 new route flags + group JSDoc)
└── snapshots/packages/api/src/
    ├── app.ts                                (pre-cut; 219 LOC)
    └── config/server-vault.ts                (CORE-STRIP-2 exit; 5 scheduler flags only)
```

## 10. Followup sprints surfaced

- **`KNOWLEDGE-EDGES-DROP-1`** — now genuinely actionable. Per AUDIT-CORE-1 §3b, `knowledge_edges` had 5 readers: `procedural/reader.ts` (route gated now), `routes/knowledge.ts` (KEEP — but handles empty results), `routes/strands.ts` (route gated now), `project-activity.ts` (feeds `get_activity` SOFT lane — empty edges = empty lane, same as current behavior), `reference-agent/retriever.ts` (optional in fallback chain). Four of five readers are now effectively un-reachable in a core-strip deployment. The fifth (`/api/knowledge`) handles empty reads. Dropping the table + its pgEnum is safe.
- **`CORE-STRIP-RESTART-SMOKE`** — combines CORE-STRIP-2 Gate E and CORE-STRIP-3 Gate E. After the next API restart, grep startup logs for 4 `scheduler-X gated off` + 14 `route-X gated off` lines. Curl each gated path expecting 404. Curl `/api/health` expecting 200 with 12 MCP tools.
- **`SERVER-VAULT-DASHBOARD-1`** (carried from CORE-STRIP-2) — expose `getServerVaultFlags()` via a KEEP endpoint (e.g. `/api/admin/server-vault`) so operators can see active vs inactive at a glance. With 18 flags now, this is more valuable than when there were 5.
- **`V5-PDF-TRIM-1`** — the v5.0 PDF described 5 knowledge-edge types that don't match the code (per EDGE-TYPE-VERIFY-1). With route-gating done, a documentation pass to reconcile the PDF with the shipped vocabulary is a clean next step. Scope: edit the PDF §X (edge types) to list the 2 actual vocabulary values (`references`, `supersedes`) and remove the 3 aspirational ones. Or, if relationship-detection is coming back in a rebuild, hold the PDF edit until that sprint lands.
- **`CORE-STRIP-NAV-2`** (from CORE-STRIP-1) — dashboard item-grid deep-action click handlers still navigate to gated pages. Consider hiding click-through on file types whose editor surface is gated.
- **Core-strip sequence complete.** UI surface (CORE-STRIP-1) + scheduler gates (CORE-STRIP-2) + route gates (CORE-STRIP-3) now in place. The running app (after next restart) will render only core management surfaces and only mount core + MCP + ingest routes.
