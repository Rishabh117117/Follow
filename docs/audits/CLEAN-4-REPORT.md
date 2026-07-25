# CLEAN-4 — organize follow/ (2026-06-02)

Part of `master-run/2026-06-02`. Goal: zero loose files at the top of `apps/web/src/components/follow/`. Move-map: `_reports/clean-4-map.md`.

## Result

- **57 loose files → 0.** Moved into responsibility subfolders. New subfolders: `chat/`, `comments/`, `modals/`, `notifications/`, `memory/`, `shell/`, `common/`; existing `items/`, `provenance/`, `sharing/`, `editor-panels/` extended.
- **57 git renames**; 81 files touched total (the rest are importers whose paths updated). All rewritten imports use `@/components/follow/<subfolder>/<name>` absolute form (stable across batch ordering).
- Moved in **6 atomic batches**, web typecheck driven to **0** after each before committing (`CLEAN-4: batch N …`).
- **5 `readFileSync` source-inspection tests** had their paths repointed (`context-bar`→shell, `items-view`→items, `notebooks-grid`→items, `memory-view`→memory, `profile-view`→memory).
- The deferred-dead `context-bar.tsx` moved to `shell/` (still dead; its entangled test path was updated).

## Incidental (forced by the `eslint --max-warnings=0` commit hook)

Touching files with pre-existing `@typescript-eslint/no-explicit-any` warnings made the hook block, so a few **type-only** fixes were applied in passing — all runtime-identical:

- `items/item-action-menu.tsx`: `(chatCtx as any)` → `(chatCtx as unknown as Record<string, unknown>)` + a typed call cast.
- test files (`follow-main-manage`, `item-action-menu`): `as any` → typed casts.
- `dashboard/project-overview.tsx`: an `eslint-disable` for an unused `interface` + prettier/tailwind-plugin reflow.

These change no behavior (verified: test pass/fail set unchanged).

## Gates (verified)

| Gate                     | Baseline     | After             | Verdict          |
| ------------------------ | ------------ | ----------------- | ---------------- |
| loose files in `follow/` | 57           | **0**             | ✅               |
| web TS errors            | 0            | 0                 | ✅               |
| web tests passing        | 956          | 956               | ✅               |
| web tests failing        | 13 (6 files) | 13 (same 6 files) | ✅ no regression |

No `_archive` snapshot taken — pure `git mv` reorg, fully preserved by rename tracking.
