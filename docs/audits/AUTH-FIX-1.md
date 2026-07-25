# AUTH-FIX-1 — Real bearer-token identity (close the impersonation hole)

**Type:** EXECUTION sprint, security-critical, public-facing auth path. Branch `claude/auth-fix-1` off `origin/main` `c86f794`.
**Status: PR opened — NOT merged, NOT deployed.** The cutover is the owner's coordinated 3-step deploy (below). No Railway/env touched; no prod probes.

## What this sprint did (and did not)

- **Did (Phases 1–2):** the human/web path now authenticates with a **verified bearer JWT** the API checks cryptographically. The web mints a short-lived token from its server-side NextAuth session and sends it as `Authorization: Bearer …`; the API verifies it (`AUTH_API_SECRET`, HS256) and derives identity from the signed `sub` claim. Machine path (`wsp_` keys) unchanged.
- **Deferred (Phase 3, per owner decision):** removing the `x-user-id` trust. So **impersonation is NOT yet closed** — the API still accepts `x-user-id` when no valid bearer is present (dual-accept). This is intentional: many clients (extension, GWS add-on, gws-extension, mobile) still send `x-user-id`, and removing it now would lock them out. Phase 3 (remove the header path) + migrating those clients is a follow-up.
- **Out of scope (unchanged):** the cross-tenant read (`assertWorkspaceAccess` membership guard — next sprint) and `workspaceId` handling (`x-workspace-id` stays a request input).

## Design decisions (confirmed with owner at Phase 0)

1. **Dedicated `AUTH_API_SECRET`** (not reusing `NEXTAUTH_SECRET`) — decouples the API token from NextAuth internals; extends to future custom-login issuers. NextAuth v5 session JWTs are _encrypted_ (JWE) and can't be verified by the API directly, so a separately-signed mint token is the right design regardless.
2. **30-minute TTL** with silent re-mint in the web client (re-mint when <5 min remain).
3. **Phases 1+2 now, defer Phase 3 removal** — close nothing yet, lock out nothing; the actual impersonation close lands once the other clients are migrated.

## What changed (file:line)

Snapshots: `_archive/2026-06-23-auth-fix-1/{auth,env,app,api-client}.ts.orig`.

### Phase 1 — API accepts a verified bearer JWT (dual-accept)

- **NEW `packages/api/src/lib/api-token.ts`** — `verifyApiToken(token)`: `jose.jwtVerify` HS256 with `AUTH_API_SECRET`, issuer `workspace-web` / audience `workspace-api` pinned; returns `{ userId (sub), email }` or `null`; **never throws** (no secret / malformed / expired / tampered / wrong iss-aud → `null`).
- **`config/env.ts`** — `AUTH_API_SECRET` added to `EnvConfig` + `loadEnv` + a warn-if-missing in `validateEnv` (soft, matches the file's existing posture). **`.env.example`** — documented under `## Auth` (must match across web + API services).
- **`middleware/auth.ts:28-…`** — dual-accept: a **valid** bearer JWT authenticates by its `sub` (single `users` existence lookup for the `user` object) and **takes precedence over any `x-user-id` header**; an **absent/invalid/expired** bearer **falls through** to the legacy `x-user-id` path (so existing header clients keep working). `DEV_BYPASS_AUTH` path intact. A `// PHASE 3:` marker flags exactly where the fallthrough becomes a `401`. `wsp_` bearers are skipped here (handled by api-key-auth/flexAuth).
- **Tests `middleware/__tests__/auth.test.ts` (7):** valid JWT → `sub`; JWT precedence over a forged `x-user-id`; expired → 401; wrong-secret/tampered → 401; no-token + valid header → 200 (dual-accept); nothing → 401; invalid-bearer + valid header → falls through (extension case).

> **DEVIATION from the literal Phase-1 spec, documented:** the plan said "invalid/expired bearer → 401, do NOT fall through." Implemented as a **lenient fallthrough during dual-accept**, because the **extension already sends its own non-API `Authorization: Bearer <token>` alongside `x-user-id`** (`apps/extension/src/core/auth.ts:14-15`) — a strict 401 would lock the extension out _now_, contradicting the owner's "defer Phase 3 / don't lock anyone out" decision. The strict "invalid → 401, no fallthrough" behavior is part of Phase 3, alongside `x-user-id` removal.

### Phase 2 — Web mints + sends the token

- **NEW `apps/web/src/app/api/auth/api-token/route.ts`** — same-origin `GET` (cookie sent); reads the session server-side via `auth()`; only for a valid session signs an HS256 JWT (`sub = user.id`, `email`, iss/aud, 30 min) with `AUTH_API_SECRET`; returns `{ token, expiresAt, activeWorkspaceId }`. No session → 401; no secret → 500. `runtime = 'nodejs'`. The signing secret never leaves the server.
- **`apps/web/src/lib/api-client.ts`** — `getAuthHeaders()` (non-dev path) now mints + **caches** the token (module-level; re-mints when <5 min to expiry) and sends `Authorization: Bearer …` + `x-workspace-id` (from the mint route's server-derived `activeWorkspaceId`, URL fallback). **Removed `x-user-id` and the `DEV_USER` fallback from the real path** (no token ⇒ no auth headers ⇒ API 401). `DEV_BYPASS_AUTH` path unchanged.
- **Tests:** `route.test.ts` (3, `@vitest-environment node`): valid session → verifiable token; no session → 401; no secret → 500. `lib/__tests__/api-client.test.ts` (2): sends `Authorization: Bearer` and **no** `x-user-id`; sends **no** auth headers when the mint route 401s (no dev-user fallback).
- **CORS — NOT changed (intentional).** hono@4.11.9 `cors` reflects the browser's requested headers when `allowHeaders` is empty (`cors/index.js:60-68`), which is why `x-user-id` works cross-origin today — so `Authorization` is already permitted by the same mechanism. An explicit allow-list would risk regressing the many custom headers in use (`x-space-id`, `x-dashboard-token`, `x-workspace-signature`, …). Documented as optional future hardening.

### Phase 3 — DEFERRED (not implemented)

The follow-up must: (a) migrate `apps/extension`, `apps/gws-addon`, `apps/gws-extension`, `apps/mobile` (and `apps/web/public/extension/*.js`) to mint+send the API JWT; (b) in `middleware/auth.ts`, replace the fallthrough (marked) with a `401`; (c) in `api-key-auth.ts:70-84`, remove the `flexAuth` fallback to the header path. Only then is impersonation closed.

## Before / after (auth behavior)

| Request                                        | Before (`c86f794`)                                                  | After (this PR — dual-accept)                                           |
| ---------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Web data call                                  | `x-user-id: <session.user.id>` (forgeable header), trusted verbatim | `Authorization: Bearer <verified JWT>`; identity from signed `sub`      |
| Forged `x-user-id`, no token                   | authenticated as the named user (impersonation)                     | **falls through to header → still authenticated** (Phase 3 closes this) |
| Valid JWT + forged `x-user-id`                 | n/a                                                                 | JWT wins; header ignored                                                |
| Expired/tampered JWT, no header                | n/a                                                                 | 401                                                                     |
| `wsp_` MCP key                                 | verified secret                                                     | unchanged (verified secret)                                             |
| Extension (`Bearer <own token>` + `x-user-id`) | header trusted                                                      | non-API bearer ignored → falls through to header (unchanged)            |

## Env prerequisite (owner sets — NOT by CC)

`AUTH_API_SECRET` (strong random, e.g. `openssl rand -base64 32`) must be set to the **same value in BOTH the web and API Railway services** before deploy. Without it: the mint route 500s and the API can't verify tokens (falls back to the header path).

## Deployment (owner-controlled, 3 steps — see RUN-STATUS / sprint plan)

1. Deploy **API (Phase 1)** — dual-accept (tokens + header). No behavior change vs today.
2. Deploy **web (Phase 2)** — now sends Bearer. Verify login + app still work.
3. _(Follow-up sprint)_ migrate other clients, then **API Phase 3** (drop header) — this closes impersonation. Rollback = revert to dual-accept.
   Do all before onboarding a second user; then ship the membership guard to close cross-tenant read.

## Parity (vs Phase 0 baseline at `c86f794`)

- **API tsc: 164 → 164.** **Web tsc: 0 → 0.** (deterministic; 0 new errors in the edit area.)
- **Web tests: 13 failed / 956 passed → 13 failed / 961 passed** — identical 13 pre-existing failures, **+5** new passing (this sprint's web tests).
- **API tests:** baseline 34 failed / 942 passed (14 files); post-change 64 failed / 973 passed (14 files) + my 7 new auth tests. The failed-**file** count is unchanged (14); the failed-**test** count swings because the pre-existing PGlite/WASM whole-file-abort flake (catalogued in PG-FIDELITY-1 divergence #3 — "multiple workers on the same `data/pglite` dir") fails a _variable_ number of tests per aborted file each run.

**Verdict: parity held — no regression.** The failing files are entirely the known flaky DB-integration / infra-dependent family — `__tests__/integration/{browser-nav,capture,doc-intelligence,workspace}-flow`, `routes/__tests__/{threads-strands,signal-capture,memory-sections,index-manage,dashboard,import-share-refs}`, `lib/__tests__/llm-logger`, `services/browser/__tests__/{nav-intent-classifier,playwright-navigation}`, `scripts/__tests__/migrate-timeline` (need a real DB/LLM key/browser, or hit the PGlite worker flake). **None are in this sprint's edit area.** The edit-area + auth files pass **19/19 in isolation**: `auth.test.ts` (7, this sprint), `api-key-auth.test.ts` (6), `permissions.test.ts` (6). Combined with deterministic tsc parity (164 / 0) and clean web parity (+5 new passing, identical 13 pre-existing failures), the change introduces no regression.

## Open / needs decision

1. **Impersonation remains open until Phase 3** (the header path is still trusted in dual-accept). The membership guard (next sprint) is also still open. Both must ship before a second real user.
2. **Other clients (extension/GWS/mobile) must migrate to the JWT** before Phase 3's header removal, or they 401. (They currently send `x-user-id`; the extension also sends a non-API bearer the API doesn't verify.)
3. **CORS** left as header-reflection; consider an explicit `allowHeaders` allow-list (incl. `Authorization`) as hardening, after enumerating every custom header in use.
4. **401-retry re-mint:** the client re-mints near expiry (skew-based); it does not yet clear+retry on an unexpected 401 (e.g., secret rotation). Minor enhancement.
5. **Shared issuer/audience constants** are duplicated as string literals in the web route and `packages/api/src/lib/api-token.ts`; consider hoisting to `@workspace/shared`.
