# SERVER-VAULT-DASHBOARD-1 — Admin Inspector Endpoint

**Date:** 2026-04-23
**Author:** Claude Code
**Sprint:** SERVER-VAULT-DASHBOARD-1 (source-modifying, additive)
**Status:** **Complete-with-deferred-runtime-check** — tsc + test + collateral gates pass; Gate C (curl smoke) deferred to next launcher restart per sprint spec.
**Repo SHA at sprint start:** `d904dbe`
**Repo SHA at sprint end:** `617805a` (this report + CLAUDE.md adds one more commit)

---

## 0. Purpose

Expose the server-vault state via one authenticated HTTP endpoint so operators can see active-vs-inactive at a glance. With 17 flags (5 scheduler + 12 route after POST-STRIP-CLEANUP-1 removed `route-procedural`, only `scheduler-sync` + `route-chat` active as of 2026-04-23), grepping source to answer "what's gated" is costlier than the endpoint. This sprint adds the surface. No UI; operators curl it.

---

## 1. Pre-flight baseline

| Check                                                                          | Result                                                                                                                              |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Branch                                                                         | `main`                                                                                                                              |
| Starting SHA                                                                   | `d904dbe POST-STRIP-CLEANUP-1: finalize README, diffs, report, CLAUDE.md`                                                           |
| tsc (`packages/api`)                                                           | **164** — parity                                                                                                                    |
| Path conflict (`admin/server-vault`, `adminServerVault`, `admin-server-vault`) | zero hits in `packages/api/src/` or `apps/web/src/`                                                                                 |
| Pre-existing exports in `config/server-vault.ts`                               | `ServerVaultFeature` (interface), `SERVER_VAULT` (record), `isServerFeatureActive`, `getServerVaultFlags`, `getInactiveServerFlags` |

## 2. Inventory — Path A (accessor exists)

`config/server-vault.ts:234` already exports:

```ts
export function getServerVaultFlags(): ServerVaultFeature[] {
  return Object.values(SERVER_VAULT)
}
```

Returns an **array** (not `Record<string, ServerVaultFeature>` as the sprint spec sketch assumed). Each element already carries its `id`, so no key-reconstruction is needed. No changes to `server-vault.ts`. Path A confirmed; no Phase 2-prep commit.

## 3. Route file created — commit `6804d34`

New file: `packages/api/src/routes/admin-server-vault.ts` (56 LOC).

**Auth pattern** mirrors `routes/admin.ts`:

```ts
import { authMiddleware } from '../middleware/auth'

const adminServerVaultRouter = new Hono()
adminServerVaultRouter.use('*', authMiddleware)
```

Any logged-in user can currently read vault state. Admin-role enforcement is explicitly out of scope per sprint spec; `requirePermission` from `middleware/permissions` is available for a future sprint if/when role-gating is wanted.

**Handler shape**:

```ts
adminServerVaultRouter.get('/', (c) => {
  const flags = getServerVaultFlags().map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    category: f.category,
    active: f.active,
  }))
  // ... compute summary: total, active, byCategory
  return c.json({ flags, summary: { total, active, byCategory } })
})
```

Projection maps `ServerVaultFeature` → response shape 1:1 (id / name / description / category / active). No invented fields. `description` exists on the interface so it's included as-is.

**Summary block** computed inline with a single pass: `{ total, active, byCategory: { [category]: { total, active } } }`. For the current vault (17 flags, 2 active: `scheduler-sync` + `route-chat`), the expected response is:

```json
{
  "summary": {
    "total": 17,
    "active": 2,
    "byCategory": {
      "scheduler": { "total": 5, "active": 1 },
      "route": { "total": 12, "active": 1 }
    }
  }
}
```

**Not wrapped in `isServerFeatureActive`** — this is the surface that reports what's gated; self-referential gating would defeat its purpose. Explicit KEEP with a comment at the top of the file and at the mount site.

**Verification after Phase 3**: tsc 164 parity; zero new errors in the file.

## 4. Mount — commit `617805a`

Two-line edit to `packages/api/src/app.ts`:

1. Import near the existing admin router import:
   ```ts
   import { adminServerVaultRouter } from './routes/admin-server-vault'
   ```
2. Mount immediately after the `adminRouter` mount:
   ```ts
   app.route('/api/admin', adminRouter)
   app.route('/api/admin/server-vault', adminServerVaultRouter)
   ```

Hono's trie-style routing handles the nested path correctly regardless of mount order (since `/api/admin/server-vault` is a full-segment prefix distinct from `/api/admin/*`), so the adjacency is purely for readability. Inline comment at the mount site repeats the KEEP rationale.

**Verification after Phase 4**: tsc 164 parity.

## 5. Gate outcomes

| Gate               | Result                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A — tsc**        | **164** ✓                                                        | Parity with Phase 1 baseline                                                                                                                                                                                                                                                                                                                                                                     |
| **B — tests**      | 12 failed / 83 passed files, 9 failed / 869 passed / 125 skipped | **No new failures from this sprint.** The count diverges from the cached POST-STRIP-CLEANUP-1 exit baseline (12/85 + 9/883/125) because POST-STRIP-CLEANUP-1 Phase B archived `services/procedural/` including its `__tests__/` directory (2 files, 14 tests). Current count `85 − 2 = 83` files and `883 − 14 = 869` tests is exactly consistent. Failed count (9) and skipped (125) unchanged. |
| **C — curl smoke** | **Deferred**                                                     | Running dev server on :3001 is pre-cut code; new mount only takes effect on next launcher restart. See curl spec below.                                                                                                                                                                                                                                                                          |
| **D — collateral** | **Clean** ✓                                                      | `git diff d904dbe..HEAD --name-only` returns exactly `packages/api/src/app.ts` + `packages/api/src/routes/admin-server-vault.ts`. Zero unrelated files.                                                                                                                                                                                                                                          |

### Gate C — post-restart curl spec

After the next launcher restart, Rishabh can verify the route is live:

```bash
# 1. Anonymous → expect 401 Unauthorized with JSON body
curl -i http://localhost:3001/api/admin/server-vault
# Expected first line: HTTP/1.1 401 Unauthorized
# Expected body:       {"data":null,"error":{"code":"UNAUTHORIZED","message":"Authentication required"}}

# 2. Authenticated → expect 200 with { flags, summary } payload
#    (Cookie-based — paste your session cookie from a browser dev-tools network tab)
curl -i -H "Cookie: <session-cookie>" http://localhost:3001/api/admin/server-vault
# Expected first line: HTTP/1.1 200 OK
# Expected body shape:
# {
#   "flags": [
#     { "id": "scheduler-realtime", "name": "Realtime Scheduler", "description": "...",
#       "category": "scheduler", "active": false },
#     ...
#     { "id": "route-chat", ..., "active": true },
#     ...
#   ],
#   "summary": {
#     "total": 17,
#     "active": 2,
#     "byCategory": {
#       "scheduler": { "total": 5, "active": 1 },
#       "route":     { "total": 12, "active": 1 }
#     }
#   }
# }

# 3. Formatted view (useful for operator eyeball):
curl -s -H "Cookie: <session>" http://localhost:3001/api/admin/server-vault \
  | jq '.flags | map({id, category, active})'
```

Expected: 2 flags with `active: true` (`scheduler-sync` and `route-chat` — the latter re-enabled 2026-04-23 to fix the Follow dashboard Conversations list).

## 6. Files touched

| File                                            | Status    | LOC change                            |
| ----------------------------------------------- | --------- | ------------------------------------- |
| `packages/api/src/routes/admin-server-vault.ts` | NEW       | +56                                   |
| `packages/api/src/app.ts`                       | MODIFIED  | +6 (import + mount + comment)         |
| `packages/api/src/config/server-vault.ts`       | UNCHANGED | — (Path A — accessor already existed) |

Plus the report + CLAUDE.md block (documentation, not source).

## 7. Anything surprising

Two minor notes, both already in the sprint output:

1. **Existing accessor returns array, not Record.** The sprint spec sketched `getServerVaultFlags(): Record<string, ServerVaultFeature>` but the shipped accessor returns `ServerVaultFeature[]` via `Object.values(SERVER_VAULT)`. Each element already has its `id`, so the handler doesn't need `Object.entries` — it iterates the array directly. Zero-work divergence.
2. **Test baseline shifted.** The running POST-STRIP-CLEANUP-1 exit state was 12/85 + 9/883/125 — but that baseline was cached before POST-STRIP-CLEANUP-1 Phase B archived the procedural test directory. The true post-CLEANUP-1 baseline is 12/83 + 9/869/125. This sprint observed the true baseline, and the count is unchanged from it.

## 8. Followup sprints

Nothing queued by this sprint specifically. The forward-looking queue from POST-STRIP-CLEANUP-1 stands:

- `RELATIONSHIP-SCAN-REBUILD-1` (optional)
- `LAUNCHER-LOG-BUFFER-1`
- `LINT-BASELINE-1`
- V5.1 React component for the trim spec (awaiting user confirmation)

Possible small extension for this feature: `SERVER-VAULT-ADMIN-ROLE-1` — add `requirePermission('admin')` to the route + a minimal UI toggle if the vault needs to become operator-mutable. Neither is required; the current endpoint is fine as a read-only inspection surface.
