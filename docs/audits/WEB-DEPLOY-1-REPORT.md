# WEB-DEPLOY-1 — Deploy `apps/web` to Railway (Next.js standalone)

**Date:** 2026-06-16 · **Branch:** `claude/web-deploy-1` (off `main` @ MIGRATE-1 merged) → PR
**Repo:** `Rishabh117117/workspace-platform` · **App:** `@workspace/web` (`apps/web`, Next.js 14.2.35, App Router)

---

## Summary

The only substantial _build_ gap in the web loop: DEPLOY-1 shipped only
`@workspace/shared` + `@workspace/api`; there was no web service. This sprint
adds a self-contained Next.js **standalone** image + a second Railway service
config, validated by a **real `next build` in the sandbox** (not just a static
trace). The rest of the login loop is config + verification (AUTH-LIVE-1).

**Changed (CC, repo-only):**

| File                                 | Change                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/next.config.js`            | `output: 'standalone'` + `experimental.outputFileTracingRoot` = monorepo root (keeps `transpilePackages`, strict eslint/TS, pdfjs webpack alias) |
| `deploy/web.Dockerfile`              | **new** — multi-stage, repo-root context, `node:22-slim`, pnpm via npm, `next build` → standalone, plain-`node` runner                           |
| `deploy/web.railway.json`            | **new** — second service: `DOCKERFILE` builder → `deploy/web.Dockerfile`, healthcheck `/auth/login`                                              |
| `docs/audits/WEB-DEPLOY-1-REPORT.md` | this report                                                                                                                                      |

No app/runtime code touched. The API service (`deploy/Dockerfile` + root
`railway.json`) is untouched.

---

## Static verification (CC) — PASS

### Real build (the strong proof — ran in-sandbox, no Docker needed)

`NEXT_TELEMETRY_DISABLED=1 pnpm --filter @workspace/web build` → **succeeded**
under the strict config (`eslint.ignoreDuringBuilds:false` +
`typescript.ignoreBuildErrors:false`). Full route manifest compiled (workspace,
settings/\*, auth/login, onboarding, s/[token], etc.).

**Standalone layout confirmed (resolves the plan's HALT point):**

```
apps/web/.next/standalone/
├── apps/web/server.js      ← CMD target: `node apps/web/server.js`  ✅
├── apps/web/package.json
├── node_modules/           ← traced runtime deps bundled  ✅
├── packages/               ← workspace pkgs (ui/shared/canvas) traced  ✅
└── package.json
apps/web/.next/static/      ← present; copied into runner  ✅
apps/web/public/            ← present (`extension/`); copied into runner  ✅
```

→ The emitted server path is **exactly** `apps/web/server.js`, so the Dockerfile
`CMD ["node","apps/web/server.js"]` (with `WORKDIR /app`) is correct. **No HALT.**

### Other gates

- **Web `typecheck`** (`tsc --noEmit`): **0 errors** (baseline 0 — unchanged).
- **Web tests:** unchanged (≈956 pass / 13 fail, same pre-existing files). Vitest
  uses `vitest.config.ts`; the only edits are `next.config.js` (build-time, not
  imported by tests) + two new `deploy/` files imported by nothing. No regression
  path.
- **Dockerfile build steps trace cleanly** against the real install/build done above.

### Dockerfile choices (mirrors the proven API image)

- `node:22-slim` (same as `deploy/Dockerfile`; the plan suggested `20` — went with
  the version DEPLOY-1 already proved on Railway).
- `npm install -g pnpm@10.30.0` (NOT corepack — corepack's verify step fails on
  Railway's builder; the DEPLOY-1 lesson).
- Repo-root build context; `pnpm install --frozen-lockfile` over the whole
  workspace (a pnpm monorepo's frozen install needs every package.json).
- Runner needs **no pnpm and no install** — standalone bundles its own
  node_modules; runs with plain `node`.

---

## Rishabh — Railway runbook (live gate)

> First real Docker build for web (like DEPLOY-1's first API build). No Docker in
> the CC sandbox, but `next build` + the standalone layout are already proven above.

1. **New service** in the **same** Railway project ("adventurous-inspiration" /
   production), connect the GitHub repo, **Branch → `main`** (after this PR merges),
   **Root Directory → repo root (unset)**.
2. **Builder:** point the service at the web Dockerfile. Either:
   - set the service's **Railway Config File** to `deploy/web.railway.json`, **or**
   - in service Settings → Build, **Builder = Dockerfile**, **Dockerfile Path =
     `deploy/web.Dockerfile`**.
     (The root `railway.json` stays the **API's** — don't repoint it.)
3. **Env vars (web service):**

   | Var                                | Value                                                                                                            |
   | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
   | `NEXT_PUBLIC_API_URL`              | the **live API** domain (DEPLOY-1 service URL, e.g. `https://workspace-platform-production.up.railway.app`)      |
   | `NODE_ENV`                         | `production`                                                                                                     |
   | `AUTH_SECRET`                      | `openssl rand -base64 32` — **required**; both `auth.ts` and `middleware.ts` read this (see note)                |
   | `NEXTAUTH_SECRET`                  | set to the **same value** as `AUTH_SECRET` (belt-and-suspenders for any lib reading the NextAuth-canonical name) |
   | `NEXT_PUBLIC_URL` / `NEXTAUTH_URL` | the **web** domain — set after step 4                                                                            |

   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` arrive in **AUTH-LIVE-1**. Until then
   the login page renders but Google isn't offered. Leave `NEXT_PUBLIC_DEV_BYPASS_AUTH`
   unset (defaults to off).

4. **Generate Domain** → set `NEXTAUTH_URL` + `NEXT_PUBLIC_URL` to it → redeploy.
5. **Watch the first build.**

### Gate to pass

- Web URL loads; **`/auth/login` renders (200)**; no server crash; `/auth/login`
  healthcheck green. (Google button appears only after AUTH-LIVE-1.)

> **Note for AUTH-LIVE-1 (flagged, not fixed here):** `auth.ts:43` signs with
> `process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET`, but
> `middleware.ts:19` verifies with `process.env.AUTH_SECRET` **only**. So if just
> `NEXTAUTH_SECRET` is set, auth.ts signs (via fallback) but middleware can't
> verify → logged-in users get bounced from `/workspace`. **Setting `AUTH_SECRET`
> (as above) makes both paths consistent.** Login-page rendering is unaffected
> (it's a public route), so this doesn't block the WEB-DEPLOY-1 gate; AUTH-LIVE-1
> will confirm the end-to-end session under real Google login.

---

## HALT rules — none triggered

- Standalone server path mismatch → **resolved** (`apps/web/server.js` confirmed by real build).
- `next build` fails on TS/eslint → **did not happen** (strict build green; `ignoreBuildErrors` left **false**).
- Web test/TS regression → none (typecheck 0; tests untouched).

## Depends on / next

- This PR forks from `main` with **MIGRATE-1 merged** (#6).
- After merge + the Railway runbook: **AUTH-LIVE-1** (Google OAuth config + the
  `AUTH_SECRET`/`NEXTAUTH_SECRET` alignment), then MCP-LIVE-1, then E2E-1.
