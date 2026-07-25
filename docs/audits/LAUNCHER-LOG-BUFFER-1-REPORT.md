# LAUNCHER-LOG-BUFFER-1 — Persist API stdout to logs/api.log

**Date:** 2026-04-23
**Author:** Claude Code
**Sprint:** LAUNCHER-LOG-BUFFER-1 (source-modifying, additive)
**Status:** **Complete-with-deferred-runtime-check** — tsc + lint + collateral gates pass; Gate C (disk file materializes on next restart) deferred and bundled with SERVER-VAULT-DASHBOARD-1's Gate C.
**Repo SHA at sprint start:** `32a79e1`
**Repo SHA at sprint end:** `dea1a8f` (this report + CLAUDE.md adds one more commit)

---

## 0. Purpose

Fix the PARTIAL outcome of CORE-STRIP-RESTART-SMOKE Phase 1: the 100-line in-memory ring buffer at `scripts/launch.ts` was rolling over before the dashboard could be queried, losing startup lines (`[Startup] X scheduler started / gated off`). Add a tee to `logs/api.log` so those lines survive. The ring buffer itself stays untouched — dashboard still reads from it.

---

## 1. Phase 1 — Launcher inventory

| Item                         | Finding                                                                                                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ring buffer push function    | `pushLog` at `scripts/launch.ts:67-69` (pre-edit); shifted to `:103-106` post-edit after my insertion of the tee block at `:86-101`                                                                                          |
| Buffer variable              | `state.api.logs: string[]` (state is `LaunchState` type defined `:54-69`)                                                                                                                                                    |
| Data shape                   | Raw line string via `data.toString().trim()` — no pre-existing timestamp, no object wrapper                                                                                                                                  |
| stderr handling              | Merged into `state.api.logs` via the same `pushLog` call; handled symmetrically with stdout                                                                                                                                  |
| API stdout hook location     | `scripts/launch.ts:259-262` (pre-edit); shifted to `:275-281` post-edit                                                                                                                                                      |
| API stderr hook location     | `:263-266` (pre-edit); shifted to `:282-288` post-edit                                                                                                                                                                       |
| ngrok stdout hook            | `:482` (pre-edit); shifted to `:503-509` post-edit. ngrok output is pushed into `state.api.logs` with a `[ngrok]` prefix — existing launcher convention                                                                      |
| Existing fs imports          | `existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync` from `'fs'` — `createWriteStream` added to the destructure                                                                                                 |
| tsc graph inclusion          | `scripts/launch.ts` is NOT in `packages/api/tsconfig.json`'s include path. Runs via `npx tsx scripts/launch.ts`. Standalone tsc surfaces 15 pre-existing ambient-type errors (`Buffer`, `process`) unrelated to this sprint. |
| Imports that needed updating | `fs`: add `createWriteStream` (already had `mkdirSync`, so no extra import needed for that)                                                                                                                                  |

## 2. Phase 2 — Init location: Option A (module top-level)

Chose Option A: stream opens at module load, before any `spawnApiServer()` call. This matches the launcher's existing pattern — `children`, `pushLog`, and `DASHBOARD_TOKEN_PATH` are all module-top-level declarations.

Placed the tee block immediately after the `children` array declaration and before `pushLog`, so future readers see the whole log-plumbing section as one unit:

```
const children: ChildProcess[] = []           # line 84 — existing
// ─── LAUNCHER-LOG-BUFFER-1 block ──         # lines 86-101 — new
const LOG_DIR = resolve('logs')
const API_LOG_PATH = join(LOG_DIR, 'api.log')
mkdirSync(LOG_DIR, { recursive: true })
const apiLogStream = createWriteStream(API_LOG_PATH, { flags: 'a' })
function teeApiLine(line: string) { ... }
// ─── existing pushLog ──                    # lines 103-106 — unchanged
function pushLog(target: string[], line: string) { ... }
```

## 3. Phase 3 — Implementation (commit `8e4556e`)

Diff summary:

- **`scripts/launch.ts:17`** — added `createWriteStream` to the existing `fs` destructure import (multi-line formatted by prettier).
- **`scripts/launch.ts:86-101`** — new 16-line block: `LOG_DIR`, `API_LOG_PATH`, `mkdirSync`, `apiLogStream` (createWriteStream with flags: 'a'), and `teeApiLine(line)` helper that ISO-timestamps each line.
- **`scripts/launch.ts:275-281`** — added `teeApiLine(line)` next to the existing `pushLog(state.api.logs, line)` in `spawnApiServer`'s stdout handler.
- **`scripts/launch.ts:282-288`** — same, in the stderr handler (same pattern, merged into same buffer).
- **`scripts/launch.ts:503-509`** — added `teeApiLine(\`[ngrok] ${line}\`)`next to the existing`pushLog(state.api.logs, \`[ngrok] ${line}\`)`in`startNgrok`'s stdout handler. Mirrors the ngrok prefix so the disk file matches what the dashboard shows.

Both writes happen sequentially in each data callback: `pushLog` first, then `teeApiLine`. No `await` — `createWriteStream`'s internal buffering handles backpressure. Timestamps are per-line, ISO format: `[2026-04-23T00:45:12.123Z] <line>`.

### Incidental lint fixes required by pre-commit hook

The first commit attempt failed — `scripts/launch.ts` had 36 pre-existing lint problems (8 errors + 28 warnings) that lint-staged catches on any commit that touches the file. My edit introduced zero new issues (checked by line number — my added lines 86-101 and the 3 hook additions were clean), but lint-staged runs on the whole file.

Fixes applied in the same commit:

- **28 `console.log` → `console.info`**: the launcher has banners, startup prints, and shutdown output that all used `console.log`. Repo `.eslintrc.json` has `"no-console": ["warn", { "allow": ["warn", "error", "info"] }]`, so `.log` is a warning; `.info` is allowed. Semantic output is byte-identical (both write to stderr in Node).
- **5 bare `} catch {}`** annotated with `/* swallowed: <intent> */` — token cache mkdir race, dashboard token read, ngrok bin probe, authtoken cache write, authtoken candidate read. Each intent inferred from 5 lines of surrounding context.
- **1 unused `isPortOpen` function** marked with `// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for future port-conflict checks`. Left in place because it's a useful helper a follow-up might want.
- **1 runtime `require('net')` inside `waitForRedis`** marked with two-rule `eslint-disable-next-line` (`no-var-requires, consistent-type-imports`). Comment: "runtime-only require; top-level import would bundle unnecessarily."

Documented verbatim in the commit message. These are the same genre of pre-existing lint issues that LINT-BASELINE-1 is queued to address; this sprint absorbs the ones in `scripts/launch.ts` because the hook blocks the sprint otherwise.

## 4. Phase 4 — `.gitignore` (commit `dea1a8f`)

Appended to `.gitignore`:

```
# LAUNCHER-LOG-BUFFER-1 (2026-04-23): API child-process stdout is tee'd to
# logs/api.log by the launcher for diagnostic purposes. Per-launch, grows
# append-only. Future log rotation not in scope.
logs/
```

`git status --ignored logs/` confirms `logs/` is ignored and no log content is tracked.

## 5. Gate outcomes

| Gate                                              | Result                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A — tsc (`packages/api`)**                      | **164** ✓ — parity. `scripts/launch.ts` isn't in the api tsc graph; api tsc is unaffected by this sprint's changes.                                                                                                                                                                                    |
| **B — eslint on `scripts/launch.ts`**             | **0 errors, 0 warnings** ✓ — after the 28 console fix + 5 catch annotations + 2 `eslint-disable-next-line` guards.                                                                                                                                                                                     |
| **B-alt — standalone tsc on launch.ts**           | 15 pre-existing ambient-type errors (`Buffer`, `process` — resolved at runtime via `@types/node` but not when tsc is invoked standalone without a tsconfig). My edits added zero new errors. Runtime parseability confirmed via `tsx --eval 'import(./scripts/launch.ts)'` — launcher banner rendered. |
| **C — Runtime smoke (logs/api.log materializes)** | **Deferred.** Bundled with SERVER-VAULT-DASHBOARD-1's deferred Gate C. See bundled curl spec in §6 below.                                                                                                                                                                                              |
| **D — Collateral**                                | Clean ✓. `git diff 32a79e1..HEAD --name-only` returns exactly `.gitignore` + `scripts/launch.ts`.                                                                                                                                                                                                      |

## 6. Bundled deferred Gate C (two sprints, one restart)

This sprint and SERVER-VAULT-DASHBOARD-1 both have deferred curl-based runtime checks that clear in a single launcher restart. Running this bundle after the next restart validates both:

```bash
# ─── 1. SERVER-VAULT-DASHBOARD-1 Gate C — vault inspection endpoint ───
#
# Anonymous → expect 401 Unauthorized with JSON body
curl -i http://localhost:3001/api/admin/server-vault
#   Expected: HTTP/1.1 401; {"data":null,"error":{"code":"UNAUTHORIZED",...}}

# Authenticated → expect 200 with { flags, summary } payload
curl -i -H "Cookie: <session-cookie>" http://localhost:3001/api/admin/server-vault
#   Expected: HTTP/1.1 200; JSON body with 17 flags, summary.total=17, summary.active=2
#   (active flags: scheduler-sync + route-chat)

# Formatted view:
curl -s -H "Cookie: <session>" http://localhost:3001/api/admin/server-vault \
  | jq '.flags | map({id, category, active})'

# ─── 2. LAUNCHER-LOG-BUFFER-1 Gate C — startup lines persist to disk ───
#
# File exists, non-empty, recent mtime
ls -la logs/api.log
#   Expected: a file with size > 0, mtime within seconds of the restart

# Last 50 lines (ISO-timestamped)
tail -50 logs/api.log
#   Expected: lines prefixed with [2026-04-XXTHH:MM:SS.sssZ]

# Startup lines survive past the 100-line ring-buffer rollover
grep "\[Startup\]" logs/api.log | tail -20
#   Expected: 5 scheduler lines:
#     [Startup] scheduler-realtime gated off via server-vault
#     [Startup] scheduler-condensation gated off via server-vault
#     [Startup] scheduler-knowledge-extraction gated off via server-vault
#     [Startup] scheduler-pattern-detection gated off via server-vault
#     [Startup] Live slice sync scheduler started
#   + 11 route gated-off lines (route-capture, route-capture-realtime,
#     route-threads, route-strands, route-doc-intelligence,
#     route-doc-intelligence-web, route-notebooks, route-comments,
#     route-timeline [×2 mount blocks], route-follow-notes,
#     route-recording-sessions)
```

If all three checks return as expected, both sprints' Gate C clears simultaneously.

## 7. Files touched

| File                | Status   | Change                                                                                                                                                                                   |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/launch.ts` | MODIFIED | +15 LOC (tee block) + 3 `teeApiLine` call sites + the incidental lint cleanup (28 `console.log` → `console.info`, 5 empty-catch annotations, 2 eslint-disable guards). Commit `8e4556e`. |
| `.gitignore`        | MODIFIED | +5 LOC (comment + `logs/`). Commit `dea1a8f`.                                                                                                                                            |

Plus the report + CLAUDE.md (documentation).

## 8. Anything surprising

- **Ring buffer is at `:67-69` per the handoff — and it still is** (post-prior-sprints, line numbers hadn't shifted). The spec's "verify line numbers" prudence turned out unnecessary; the reference was accurate.
- **ngrok's stdout shares the API buffer.** The spec's "API stdout in scope, other processes out" is technically true, but the launcher convention conflates ngrok lines (with `[ngrok]` prefix) into the same `state.api.logs` ring buffer. Mirrored that convention in the tee — ngrok lines land in `logs/api.log` with the same prefix. Without that, `logs/api.log` would drift from the dashboard's displayed log, which would be confusing.
- **The pre-commit hook forced incidental lint cleanup.** 28 console warnings + 8 errors were all pre-existing — my edits were clean — but lint-staged blocks on any commit touching the file. Absorbed those 36 fixes into the Phase 3 commit. Semantic output unchanged throughout.
- **`logs/` already existed** before Phase 4 because `tsx --eval 'import(./scripts/launch.ts)'` during Gate B Phase 3 validation caused the module-top `mkdirSync` to fire. Properly ignored, no content tracked.

## 9. Followup sprints

Nothing new surfaced by this sprint. The forward-looking queue stands:

- `RELATIONSHIP-SCAN-REBUILD-1` (optional)
- `LINT-BASELINE-1` — still has ~30+ pre-existing lint issues in other files
- V5.1 React component — awaiting user confirmation

Possible tiny extension: `LAUNCHER-LOG-PER-PROCESS-1` — extend the tee to `logs/web.log`, `logs/ngrok.log`, `logs/agent.log` if the per-process diagnostic need materializes. Not queuing unless/until someone asks.
