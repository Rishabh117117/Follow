# CORE-STRIP-2 — Server Vault + Scheduler Gating Report

**Date:** 2026-04-22
**Author:** Claude Code
**Sprint:** CORE-STRIP-2 (source-modifying, archive-backed)
**Status:** Complete-with-deferred-runtime-check — tsc + tests + code audit all pass; live smoke tests (Gate C/D) deferred to next user-triggered API restart. The pre-existing running server is still executing pre-cut code.
**Repo commit SHA at sprint start:** `b53e65a`
**Repo commit SHA at sprint end:** `b7020b4` (final will be this report's commit)

---

## 0. Executive summary

- **New convention landed.** `packages/api/src/config/server-vault.ts` created — the API equivalent of `apps/web/src/config/feature-vault.ts`. Shape mirrors the web vault (id/name/description/active/category). Category enum includes `'scheduler' | 'route' | 'service'` so CORE-STRIP-3 can reuse it for route flags.
- **5 schedulers gated.** 4 off by default (realtime, condensation, knowledge-extraction, pattern-detection), 1 on by default (sync — feeds `shared_slices` read by MCP `get_activity` / `contribute`). Each `setTimeout(...)` block wrapped in `if (isServerFeatureActive(...))` with a matching `else` startup log so "off by config" is visibly distinct from "silently broken."
- **Verification: tsc parity (164), test parity (12 failed / 85 passed files, 9 failed / 883 passed / 125 skipped tests), code audit shows all 5 setTimeouts guarded.** Runtime smoke (gated API health probe + MCP tools after restart) deferred — current dev server is pre-cut code and I didn't restart the user's full launcher without permission.

---

## 1. Pre-flight baseline

| Check                               | Result                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branch                              | `main`                                                                                                                                                                                                                                                                   |
| Starting SHA                        | `b53e65a CORE-STRIP-1: finalize report, README, diffs, and CLAUDE.md`                                                                                                                                                                                                    |
| tsc (`packages/api`)                | **164 errors** across the same known-baseline files as RELATIONSHIP-SCAN-CUT-1 (yjs-text-extractor, import-thread, export-page, recording-session-finalizer, query-executor, thread-distillation, test files). No errors in `index.ts` or any file about to be modified. |
| API test suite                      | **12 failed / 85 passed** test files; **9 failed / 883 passed / 125 skipped** tests. All failures are PGLite WASM env issues pre-dating this sprint.                                                                                                                     |
| `/api/health` on running dev server | 200 OK, 12 MCP tools, 4 infra checks green. The running API was started before this sprint and is still executing pre-cut code.                                                                                                                                          |
| `git status` line count             | 464 (pre-existing in-flight scaffolding from earlier sprints; unrelated).                                                                                                                                                                                                |

Baseline matches RELATIONSHIP-SCAN-CUT-1 and CORE-STRIP-1 exactly. Proceeding.

## 2. Scheduler role verification

Grep + source inspection per scheduler. The decision rule was: if writes feed a table read directly by an MCP tool → `active: true`; if only SOFT-read or gated-UI read → `active: false`.

| Scheduler            | File                                                        | Writes to                                                                                   | Read by MCP?                                                                                                               | Flag default | Rationale                                                                                                                       |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| realtime             | `services/realtime-scheduler.ts` + `thread-distillation.ts` | `thread_events`, `thread_sessions`, `threads`                                               | `query_index` (SOFT — one of 7 reference-agent lanes; table also populated synthetically by chat-fact-extractor)           | **false**    | Cut's primary consumer (relationship-scan) removed in RELATIONSHIP-SCAN-CUT-1; remaining loop is near-dead cost.                |
| condensation         | `services/ai-state/condenser.ts`                            | `aiState.session.summary` (via state-manager)                                               | `query_index` (SOFT — `memory_layers` session lane in reference-agent/retriever.ts:604)                                    | **false**    | SOFT per AUDIT-CORE-1 §9a. Other retriever lanes cover the gap.                                                                 |
| knowledge-extraction | `services/ai-state/knowledge-extractor.ts`                  | `aiState.event.activeKnowledge`, `aiState.persistent.longTermKnowledge` (via state-manager) | `query_index` (SOFT — `memory_layers` event+persistent lanes)                                                              | **false**    | Same SOFT lane; no structured-query consumer.                                                                                   |
| pattern-detection    | `services/ai-state/pattern-detector.ts`                     | `aiState.persistent.patterns.*` (via state-manager)                                         | `query_index` (SOFT memory_layers.persistent); primary consumer is procedural-pattern UI (GATED in CORE-STRIP-1 territory) | **false**    | Consumer surface is GATE; retriever lane is SOFT.                                                                               |
| sync                 | `services/sharing/sync-scheduler.ts` → `sync-service.ts`    | `shared_slices`, `slice_sync_events`                                                        | `get_activity` (direct read of `shared_slices`), `contribute` (writes `shared_slices`)                                     | **true**     | Safety net for event-driven `sync-trigger`; keep on so live slices don't go stale on cross-workspace races or process restarts. |

Grep evidence is reproduced in the commit message for `9007104` (introduces the vault) and in the archive README.

## 3. Archive scaffolding

Created `_archive/2026-04-22-core-strip-2/` with subdirs (`snapshots/`, `diffs/`, `archived-tests/`, `audits/`) + seed `README.md` (final in §9 post-edit). Snapshotted:

- `packages/api/src/index.ts` — the only file modified by this sprint that had a pre-state

The new `server-vault.ts` had no pre-state (being created). Verified pre-cut parity via `diff -q`, then committed the archive as `b802e8f` before any source edits.

Also copied three authorising audits into `audits/`: AUDIT-CORE-1, EDGE-TYPE-VERIFY-1, RELATIONSHIP-SCAN-CUT-1.

## 4. server-vault.ts created

Shape:

```ts
export interface ServerVaultFeature {
  id: string
  name: string
  description: string
  active: boolean
  category: 'scheduler' | 'route' | 'service'
}

export const SERVER_VAULT: Record<string, ServerVaultFeature> = { ... }

export function isServerFeatureActive(flagId: string): boolean {
  return SERVER_VAULT[flagId]?.active ?? false
}

export function getServerVaultFlags(): ServerVaultFeature[] { ... }
export function getInactiveServerFlags(): ServerVaultFeature[] { ... }
```

Initial population: 5 scheduler flags with verdicts from §2. Each flag entry has a JSDoc block above it quoting the one-paragraph rationale (verified 2026-04-22, what it writes, why SOFT/HARD, default decision).

Divergence from `apps/web/src/config/feature-vault.ts`: the web vault exports the flag collection as an **array** (`featureVault: VaultFeature[]`), this vault exports it as a **record** (`SERVER_VAULT: Record<string, ServerVaultFeature>`) keyed by id. The record form is faster for `isServerFeatureActive(id)` lookups (O(1) vs O(n)) and the web-side `Array.find` was only that shape because the web vault also enumerates `getInactiveFeatures()` which expects array. Both patterns are exported here (`getInactiveServerFlags()` filters `Object.values(SERVER_VAULT)`), so API callers can choose either.

**Commit:** `a42ea27` — "CORE-STRIP-2: introduce server-side feature-vault convention (5 scheduler flags)". +125 LOC, one new file.

## 5. index.ts modifications

Added import near the bottom of the import block:

```ts
import { isServerFeatureActive } from './config/server-vault'
```

Then wrapped 5 `setTimeout` scheduler blocks. Pattern (abbreviated for brevity; full diff in `_archive/.../diffs/index.ts.diff`):

```ts
// BEFORE:
setTimeout(() => {
  startRealtimeScheduler()
  console.log('[Startup] Realtime scheduler started')
}, 10_000)

// AFTER:
if (isServerFeatureActive('scheduler-realtime')) {
  setTimeout(() => {
    startRealtimeScheduler()
    console.info('[Startup] Realtime scheduler started')
  }, 10_000)
} else {
  console.info('[Startup] scheduler-realtime gated off via server-vault')
}
```

Same pattern applied to the other 4 schedulers (condensation, knowledge-extraction, pattern-detection, sync). Each gated branch has its dedicated flag ID and its own `else` log.

`startIndexWorker(runIndexAgent)` and `startSemanticIndexBackground()` at lines 103-104 (post-edit numbering) remain unguarded — they are core ingest infrastructure, not setTimeout-delayed, and every MCP tool except `set_scope` / `scope_configure` depends on their output tables (`document_chunks`, `index_records`).

**Incidental lint cleanup:** while editing this file, I had to convert all `console.log(...)` → `console.info(...)` (12 occurrences: 7 pre-existing + 5 new) so lint-staged's `--max-warnings=0` could accept the commit. The repo's `.eslintrc.json` has `"no-console": ["warn", { "allow": ["warn", "error", "info"] }]` — `console.log` is a warning; `console.info` is allowed. Output is identical; only the method name differs. Documented in the commit message.

**Commit:** `b7020b4` — "CORE-STRIP-2: gate 5 schedulers behind server-vault flags". +179 LOC / −25 LOC (diff is larger than the semantic change due to indentation shift from the `if/else` wrapping).

## 6. Verification

| Gate                                | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — tsc parity (`packages/api`)** | **164 errors** — identical to baseline. Zero new errors in `index.ts` or `server-vault.ts`. ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **B — test parity**                 | **12 failed / 85 passed** test files; **9 failed / 883 passed / 125 skipped** tests — identical to baseline. All failures are the same pre-existing PGLite WASM environment issues. ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **C — API startup probe**           | **Deferred.** The running dev server on `:3001` was started before this sprint and is still executing pre-cut code. It reports `/api/health` 200 OK with 12 MCP tools — that confirms pre-cut state is still functional, not that my changes work. Restarting the user's full-stack launcher without permission would disrupt ngrok + dashboard + agent, so I did not trigger a restart. This gate will pass on the next user-initiated restart — at which point startup output should show `[Startup] scheduler-realtime gated off via server-vault` and the three other "gated off" lines (plus `[Startup] Live slice sync scheduler started` because `scheduler-sync` defaults to on). |
| **D — MCP smoke (post-restart)**    | **Deferred for the same reason.** `get_activity`, `query_index`, and `directory_query` are expected to continue working because all 4 off-by-default schedulers have SOFT consumers only (per AUDIT-CORE-1 §9a); and the one on-by-default scheduler (`scheduler-sync`) is the one feeding `get_activity`'s `shared_slices` lane.                                                                                                                                                                                                                                                                                                                                                         |
| **Code audit**                      | All 5 `setTimeout(...)` scheduler calls are preceded on the immediately-prior line by their matching `isServerFeatureActive(...)` guard (lines 90/91, 107/108, 121/122, 135/136, 152/153). All 5 have matching `else { console.info('[Startup] scheduler-X gated off ...') }` branches. ✓                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Lint (eslint)**                   | `eslint src/index.ts` clean post-cleanup; lint-staged passes on commit. ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 7. Rollback notes

No rollbacks needed. Each phase's commit landed cleanly once the lint-staged `no-console` constraint was resolved by the console.log→info conversion (documented in §5). No tsc errors introduced at any point. No test regressions.

## 8. Archive contents

```
_archive/2026-04-22-core-strip-2/
├── README.md                                   (restoration + rationale)
├── archived-tests/                             (empty)
├── audits/
│   ├── AUDIT-CORE-1-REPORT.md
│   ├── EDGE-TYPE-VERIFY-1-REPORT.md
│   └── RELATIONSHIP-SCAN-CUT-1-REPORT.md
├── diffs/
│   ├── index.ts.diff                           (178 lines — guard wrapping + log→info)
│   └── server-vault.ts.new                     (125 lines — as-shipped reference)
└── snapshots/packages/api/src/
    └── index.ts                                (pre-edit snapshot, 205 LOC)
```

## 9. Followup sprints surfaced

- **`CORE-STRIP-3`** (already queued by AUDIT-CORE-1) — Gate non-core API routes via this same `server-vault.ts`. The sprint uses the `'route'` category slot the vault already reserves. Concrete targets per AUDIT-CORE-1 §7: chat, capture, capture-realtime, threads, strands, doc-memory, doc-intelligence, doc-intelligence-web, notebooks, prompting, procedural, comments, timeline, memory-sections, follow-notes. Expected pattern: wrap route-mount calls in `packages/api/src/app.ts` with `isServerFeatureActive('route-<name>')`.
- **`CORE-STRIP-2-RESTART-SMOKE`** — After the next API restart, run the deferred Gate C + D checks. Expected outcome: 4 "gated off" startup lines, 1 "sync scheduler started" line, `/api/health` green with all 12 MCP tools, manual smoke test of `get_activity` / `query_index` / `directory_query` via the MCP REST shim returns structurally valid responses. If any SOFT assumption turns out to be HARD in practice, flip the flag via `server-vault.ts` and file a report.
- **`CLEANUP-CONSOLE-LOG-1`** — The `console.log` → `console.info` cleanup I did in `index.ts` is needed elsewhere. Running `rg "console\.log" packages/api/src | wc -l` would surface the pre-existing total; a one-sprint sweep would eliminate the lint-staged friction for future sprints.
- **`SERVER-VAULT-DASHBOARD-1`** — The web app's `/api/models` endpoint exposes which model tiers are active. A similar `/api/server-vault` endpoint exposing `getServerVaultFlags()` would let the dashboard show operators which schedulers/routes are on vs off. Low-cost, high-debug-value.
