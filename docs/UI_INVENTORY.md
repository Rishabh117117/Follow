> **⚠ Predates CLEANUP-1 (2026-07-24).** The parked-surface strip removed every vault-gated feature (capture, canvas, rich-text/spreadsheet/presentation editors, notebooks, threads, timeline, comments, doc-intelligence, browser-nav, the off schedulers) and the dev-mode workspace chrome. Sections referencing those no longer apply — the code wins. A fresh architecture doc is planned.

# UI Inventory

What's in `apps/web` — pages, stores, hooks, components, feature gates. State as of **2026-05-13**.

The web app is **heavily gated** by `apps/web/src/config/feature-vault.ts`. Roughly 22 surface flags exist; nearly all are currently `active: false`. The live UI is the management surface (items, index, settings, dashboard) plus chat. Editor surfaces (rich-text, canvas, spreadsheet, presentation, PDF, notebook) are on disk but inactive — flip the flag in `feature-vault.ts` to bring them back.

For overall architecture see `docs/ARCHITECTURE.md`. For AI features see `docs/AI_SYSTEM.md`.

---

## 1. Pages

32 routes under `apps/web/src/app/`. The interesting ones:

### Public / auth

```
/                       Marketing / redirect to workspace
/auth/login             NextAuth login (wraps useSearchParams in Suspense — AUTH-LOGIN-SUSPENSE-1)
/invite/[token]         Workspace invite redemption
/onboarding             First-run wizard
/s/[token]              Public share preview
/pdf-viewer             Standalone PDF viewer
```

### Settings (7 pages, all live)

```
/settings/profile       /settings/general       /settings/ai
/settings/agents        /settings/connected     /settings/billing
/settings/notifications /settings/shortcuts
```

Each is now `page.tsx` → `_body.tsx` after `PAGE-SHAPE-CLEANUP-1` (Next.js page contract).

### Workspace shell

```
/workspace                                 List / picker
/workspace/[id]                            Home dashboard
/workspace/[id]/config                     Workspace settings
/workspace/[id]/settings                   (overlap with config — used by different flows)
/workspace/[id]/space/[spaceId]            Folder view
```

### Workspace content

```
/workspace/[id]/files                      File browser (grid/list, live)
/workspace/[id]/captures                   Capture browser (gated `web-captures`)
/workspace/[id]/discover                   Discover recommendations
/workspace/[id]/docs                       Documents list
/workspace/[id]/knowledge                  Knowledge doc browser
/workspace/[id]/timeline                   Timeline view (gated `timeline-view`)
/workspace/[id]/threads                    Thread list (gated `thread-archive`)
/workspace/[id]/chat                       Chat (gated `in-app-chat`)
```

### Editors

```
/workspace/[id]/editor/[fileId]            Rich-text editor (TipTap + Yjs collab). Gate: `rich-text-editor`.
/workspace/[id]/canvas/[fileId]            Canvas editor (PixiJS). Gate: `canvas-editor`.
/workspace/[id]/canvas                     Canvas index / new
/workspace/[id]/notebook/[fileId]          Notebook editor (cells, pages). Gate: `notebook-editor`.
```

All three editor pages are wrapped in vault checks — they render `<FeatureInactivePlaceholder/>` when their flag is off.

Editor page layout is three-column (LeftPanel ~200px / Center / RightPanel ~260px) with a Canvas/Focus mode toggle (D2/D3 sprints). Auto-hide panels on narrow viewports.

### Dev / test

```
/test-doc-intel                            Manual doc-intel testing
```

## 2. Component directories (`src/components/`)

21 top-level folders:

```
canvas/              PixiJS editor wrapper + tools (14 canvas tools)
capture/             Screenshot + browser-history UI
capture-ask/         Capture-with-follow-up (gate `capture-ask`)
chat/                Messages, input, thread list, reasoning panel
collaboration/       Presence, cursors, awareness
command-palette/     Global cmd-K search
config/              Workspace config panels
dashboard/           Workspace home / overview
editors/             Editor type router (doc / notebook / canvas)
error-boundary/      Error fallback
file-browser/        Files grid + list + search
follow/              Follow-specific surfaces (DocTopBar, FloatingUnit, CanvasPanels, EditorPanels, ItemsView, AddToIndexModal)
invite-modal/        Workspace-invite acceptance
knowledge/           Knowledge doc browser
layout/              Shared layout: navbar, sidebar, panels
notebook/            Notebook editor + 10 block types (markdown, image, divider, table, code, …)
settings/            Settings pages
space/               Folder/space view
threads/             Thread UI (conversation view, list)
timeline/            Timeline view + resolution selector
top-navbar/          Global navigation
```

**Two `AddToIndex` implementations coexist** (still — flagged for cleanup):

- `components/follow/add-to-index.tsx` — legacy panel (CTX-1)
- `components/follow/add-to-index-modal.tsx` — modal used by ItemsView v3 (STABILIZE-3)

Pick one before adding the next entry point.

## 3. Zustand stores (`src/stores/`, 33 stores)

```
ai-annotation-store        AI annotation overlays
chat-context-store         Chat filters & active context
comment-store              Comments list + selection
dev-mode-store             Dev-only toggles
discover-store             Discover recommendations
doc-memory-store           Document memory state
doc-suggestion-store       Doc suggestions
doc-threads-store          Document-level threads
document-context-store     Document relationships
editor-layout-store        Editor panel visibility (left / right / top nav)
editor-ref-store           TipTap editor refs
editor-tabs-store          Open file tabs
floating-unit-store        Floating chat unit state
follow-dashboard-store     Follow-specific dashboard state
follow-notes-store         Clip / note list
ghost-draft-store          Unsaved-draft recovery (max 3 ghost nodes)
group-thread-store         Thread grouping
highlight-revision-store   Highlight + revision tracking (M-series)
index-store                Semantic-index state
item-manage-store          Bulk item operations
keyboard-shortcuts-store   Custom shortcuts
layout-store               Global layout (navbar, panels, overlays)
live-context-store         Realtime workspace context
local-provenance-store     Local edit history / word-level diffs / undo
notebook-store             Notebook state (pages, blocks)
procedural-store           Procedural generation state (archived path — see POST-STRIP-CLEANUP-1)
provenance-store           Workspace provenance / history
query-store                Query execution + results
scope-store                Scope configuration
sharing-store              Sharing + permission state (FE-5)
starred-files-store        Starred files
threads-store              Threads + strands
```

State convention: server data via TanStack Query, client UI state via these Zustand stores, real-time collaborative state via Yjs (`y-websocket` over port 3003).

## 4. Hooks (`src/hooks/`)

~15 active hooks — auth, api-client wrappers, presence trackers, responsive helpers, keyboard shortcuts. Two were removed in FV-1 (use-capture-ask, use-document-context — both unmounted).

## 5. Feature vault flags (`src/config/feature-vault.ts`)

22 flags. All currently `active: false` in the stripped baseline. Categories: `editor`, `capture`, `intelligence`, `collaboration`, `surface`.

```
editor:        rich-text-editor, canvas-editor, spreadsheet-editor, presentation-editor,
               pdf-viewer, notebook-editor
intelligence:  ghost-drafts, ai-annotations, doc-suggestions, contribution-markers,
               doc-phase, proactive-cards, doc-intelligence
capture:       capture-ask, web-captures
collaboration: comments, in-app-chat, thread-archive, timeline-view
surface:       file-browser, dev-config-hub
```

Pattern for gating:

```tsx
import { isFeatureActive } from '@/config/feature-vault'

if (!isFeatureActive('canvas-editor')) {
  return <FeatureInactivePlaceholder />
}
```

Inspect runtime state from the dashboard Settings tab or via `GET /api/admin/server-vault`.

## 6. Editor pages — detailed layout

### `/workspace/[id]/editor/[fileId]/page.tsx` — TipTap rich-text

- Layout: three-column with LeftPanel (outline) / Center (editor) / RightPanel (props / provenance / notes).
- TipTap 3 + `@tiptap/extension-collaboration` + Yjs.
- Inline AI Materialization (M1-M5): Ghost Draft nodes (max 3) and Highlight Revision cards with strikethrough.
- Document Edit History: word-level diffs from `local-provenance-store.ts` get passed to the AI system prompt via `buildRecentEditsSection()`.
- File rename via mutation; vault-gated.

### `/workspace/[id]/canvas/[fileId]/page.tsx` — PixiJS canvas

- Layout: three-column with LayersPanel (tree view) / Canvas / right panel. Top bar hidden in Canvas mode.
- 14 canvas tools (sticky-note, shapes, connectors, rich-text, …).
- Collaboration: Yjs awareness + Y.Map sync.
- File mutation surface present; vault-gated.

### `/workspace/[id]/notebook/[fileId]/page.tsx` — notebook

- `NotebookLayout` component fetches file + notebook data separately (split queries).
- 10 block types; page templates; per-page background option.
- AI annotation (handwriting interpretation) on touch devices.
- Rename + toolbar; vault-gated.

## 7. Items view (current entry surface)

`apps/web/src/components/follow/items-view.tsx` (~122 KB, WIRE-2). Unified list + tree + detail across conversations, files, and facts. Per-file `IndexStatusBadge` (BADGE-1). Conversations group by normalized title; raw-files filter out `chat_artifact` wrappers by default. Sidebar counts poll `/api/indexes` every 10 s and listen to the `follow:items-changed` custom event.

## 8. Dashboard (separate from the web app)

`scripts/dashboard.html` is a single-page React SPA served by `scripts/dashboard-server.ts` on `:4000`. 7 tabs:

```
Overview     Service status (Docker, API, Web, ngrok, agent)
Logs         Tailed API logs (logs/api.log)
Network      Live HTTP traffic via WebSocket
MCP          Active MCP endpoints + tool list + ngrok public URL
Timeline     Recent thread events
Index        Index queue jobs + per-job controls
Models       Active vs unused tier list (uses ACTIVE_TIERS from models.ts)
Settings     Server-vault flag state
```

It reads `launcher?.ngrok?.url` from the launcher state for MCP endpoints — previously read the wrong field in the `/api/health` payload, fixed in LAUNCH-2.

## 9. What's currently live for a user

In the stripped baseline (no flags flipped):

- Sign in, pick a workspace, see the home dashboard.
- Items view: browse conversations, files, facts; add to index; check status; cancel queue jobs.
- Files surface (basic file browser, no advanced viewer).
- Settings (all 8 sub-pages).
- Chat (the only gated route that's on).
- Sharing / permissions UI (FE-4/5 surfaces).
- Dashboard at `:4000` (always on, separate server).

Everything else needs a vault flag flipped. The roster is in `feature-vault.ts` (web) and `server-vault.ts` (api).

---

## CLEAN-1 (2026-06-02) — orphan removal

23 orphan components (+8 dead colocated tests) were removed from `apps/web/src/components` after a verified zero-importer derivation. Snapshots: `_archive/2026-06-02-clean-1/`; full list: `_reports/clean-1-orphans.md` and `docs/audits/CLEAN-1-REPORT.md`. Component `.tsx` count under `components/`: **271 → 248**. Notable: `follow/doc-top-bar.tsx` (legacy of the doc-top-bar/-v2 fork) removed — only `doc-top-bar-v2.tsx` remains. `follow/context-bar.tsx` left in place (deferred; entangled with `unit-chat-panel.test.tsx`).

## CLEAN-4 (2026-06-02) — follow/ reorganized

`apps/web/src/components/follow/` had 57 loose top-level files; all moved into responsibility subfolders (now zero loose). New: `chat/`, `comments/`, `modals/`, `notifications/`, `memory/`, `shell/`, `common/`; existing `items/`, `provenance/`, `sharing/`, `editor-panels/` extended. Imports use `@/components/follow/<subfolder>/<name>`. Map: `_reports/clean-4-map.md`; audit: `docs/audits/CLEAN-4-REPORT.md`.
