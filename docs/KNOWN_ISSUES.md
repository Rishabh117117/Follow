> **⚠ Predates CLEANUP-1 (2026-07-24).** The parked-surface strip removed every vault-gated feature (capture, canvas, rich-text/spreadsheet/presentation editors, notebooks, threads, timeline, comments, doc-intelligence, browser-nav, the off schedulers) and the dev-mode workspace chrome. Sections referencing those no longer apply — the code wins. A fresh architecture doc is planned.

# Known Issues

Live gotchas as of **2026-05-13**. Update when you fix one; delete when it goes away.

For historical issue lists see `_archive/docs-2026-05-13/docs/ERRORS_AND_MISSING_ITEMS.md` (most rows in there are resolved by FV-1 / the CORE-STRIP wave).

---

## Runtime

- **`ensureProjectStrand` arity mismatch.** `routes/indexes.ts:320` calls it with 3 args; signature requires 4 (`workspaceId, ownerId, spaceId, projectName`). TS flags it; runtime is swallowed by the surrounding try/catch so `POST /api/indexes` still succeeds. Fix when you next touch project creation.

- **`workspaceId="default"` fails Zod UUID validation** on `/api/capture/realtime`. Need a real UUID workspace for a full E2E test. Workaround: seed a workspace via `pnpm seed` first.

- ~~Two `AddToIndex` implementations coexist.~~ **Resolved (CLEAN-3, 2026-06-02).** The panel `add-to-index.tsx` no longer exists; only `components/follow/add-to-index-modal.tsx` (`AddToIndexModal`, mounted via `items/add-to-index-button.tsx`) remains. Single surface.

- **`follow/context-bar.tsx` is dead but not yet removed.** CLEAN-1 (2026-06-02) removed 23 orphan components; `context-bar.tsx` was deferred because its only reference is `__tests__/unit-chat-panel.test.tsx`, which `readFileSync`s its source. Remove both together in a follow-up. The `doc-top-bar` vs `doc-top-bar-v2` fork was resolved here (legacy `doc-top-bar.tsx` deleted). See `docs/audits/CLEAN-1-REPORT.md`.

## Build & types

- **API TS errors baseline ~160** (mostly inside route handlers gated off by `server-vault.ts`). Web baseline is 0 after `WEB-TSC-CUT-DEBT-COMBINED-1`. Don't merge new TS errors into web; the api number can drift while gated code is dormant.

## Infra / Windows

- **`existsSync` for AppData paths intermittently lies on Windows.** In some Windows Terminal contexts launching `start-and-open.cmd`, Node's `existsSync` returns `false` for files under `%LOCALAPPDATA%\ngrok\` that cmd.exe `dir` can see. Workaround in place: launcher passes `--authtoken` directly and caches the token in project-local `.ngrok-authtoken` instead of reading AppData at launch.

- **`nul` file at project root.** ~300 MB sentinel created by an earlier broken redirect (`> NUL` on a Unix shell). Safe to delete; will not regenerate. Not yet purged because git tracks it.

- **OneDrive copy at `C:\Users\risha\OneDrive\Desktop\Workspace App`.** Empty directory stubs locked by the OneDrive driver. The real working tree is `C:\Dev\Workspace App` — work there. Stubs may clear after a reboot.

## ngrok / MCP

- **`MCP_PUBLIC_URL` rotates on free-tier ngrok restarts.** Launcher refreshes it automatically; a standalone API needs it set manually before agents connect. The dashboard MCP tab reads `launcher?.ngrok?.url` (LAUNCH-2 fix — previously read the wrong field from `/api/health`).

## Schedulers

- **All four "smart" schedulers default to off** in `server-vault.ts`: `scheduler-realtime`, `scheduler-condensation`, `scheduler-knowledge-extraction`, `scheduler-pattern-detection`. Only `scheduler-sync` runs in the stripped baseline. Flip and restart the API to re-enable.

- **`chat-fact-extractor` runs regardless** of `scheduler-realtime` — it's the synthetic path that produces facts from chats even with realtime off. Verified: turning realtime back on does **not** double-index; the extractor hooks on `source_type='chat_artifact'`, the realtime path doesn't.

## Stubs / partial implementations

- **Desktop-agent `balanced` preset** logs detected files but the "manual approval" UI is not wired — currently behaves as log-only. The intent is approve-before-upload.
- **PDF / DOCX text extraction in the desktop-agent** is intentionally a placeholder. Heavy extraction happens server-side after upload.
- **GWS extension `PresenceCursors`** is a stub.
- **Mobile app** is an Expo scaffold only; no maintained surfaces.

## Tests

- `~1250` Vitest tests; most green post-`WEB-TSC-SWEEP-*` arc. A handful in `apps/web/src/components/...` were rewritten to bypass mocking gaps (e.g. `notebooks-grid.tsx`, `notebook-picker.tsx` now fetch from API directly).

## Dead / unmounted code

- `routes/capture-ask.ts`, `routes/document-context.ts` — files present, never mounted (FV-1).
- Procedural chain — archived in `_archive/2026-04-22-post-strip-cleanup/` (`POST-STRIP-CLEANUP-1`).
- `knowledge_edges` table + enum — dropped (`KNOWLEDGE-EDGES-DROP-1`).

If you grep for these and find a reference, the reference itself is dead — clean it up.
