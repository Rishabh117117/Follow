# CLEAN-2 — web→API wiring unification (2026-06-02)

Part of `master-run/2026-06-02`. Goal: every web data call goes through `api-client`; no raw `fetch` to the API via `NEXT_PUBLIC_API_URL`.

## What changed

- **22 files migrated** (full map: `_reports/clean-2-leaks.md`). Net **−207 lines** (removed duplicated auth-header builders).
- Raw API `fetch(\`${NEXT_PUBLIC_API_URL}…\`)` → **`authFetch(path, opts)`** (injects `x-user-id`/`x-workspace-id`+`credentials:'include'`+ base URL). Local`getAuthHeaders`/`authedHeaders` duplicates deleted.
- Non-fetch base-URL reads (EventTracker transport, `window.open` exports, bookmarklet embed, `navigator.sendBeacon`) → new export **`API_BASE`** from `api-client.ts`.
- **`NEXT_PUBLIC_API_URL` now appears only in `apps/web/src/lib/api-client.ts`** (the single source of truth) — verified by re-scan.
- Custom-identity calls preserved their explicit headers (signal-capture's `effectiveUserId`; pdf-viewer's hardcoded dev id) by passing them in `options.headers` (which override authFetch's).
- Dead `getApiBase()` in `items/_shared.ts` deleted (zero consumers).

## Left untouched (correctly)

- **Launcher (`:4000`)** calls: `_shared.ts` `useWatchedFolders`, `items/file-tree/breadcrumb-bar.tsx`, `settings/agents/_body.tsx` `launcherFetch` — different service (`NEXT_PUBLIC_LAUNCHER_URL`), not the API.
- `lib/auth.ts` — excluded by the sprint contract.

## One incidental fix

`hooks/use-session-tracking.ts` carried a pre-existing `// eslint-disable-next-line react-hooks/exhaustive-deps`. The root eslint config (which the lint-staged commit hook runs) lacks the `react-hooks` plugin — only web's `next lint` provides it — so that directive errored under the hook. Changed it to a bare `// eslint-disable-next-line` (accepted by both linters; same effect, since exhaustive-deps is the only rule firing on that line). It is the only web file repo-wide using such a directive.

## Gates (verified)

| Gate                                         | Baseline (post-CLEAN-1) | After             | Verdict          |
| -------------------------------------------- | ----------------------- | ----------------- | ---------------- |
| web TS errors                                | 0                       | 0                 | ✅               |
| eslint (`--max-warnings=0`) on changed files | —                       | clean             | ✅               |
| web tests passing                            | 956                     | 956               | ✅               |
| web tests failing                            | 13 (same 6 files)       | 13 (same 6 files) | ✅ no regression |

Behaviour note: `authFetch` uses api-client's `NEXT_PUBLIC_API_URL || ''` (same-origin) fallback vs the old `|| 'http://localhost:3001'`; identical when the env var is set (always, in this project). `API_BASE` keeps the localhost fallback for the absolute-URL consumers. Per-file commits prefixed `CLEAN-2:`.
