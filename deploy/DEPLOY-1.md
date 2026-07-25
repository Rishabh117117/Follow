# DEPLOY-1 — Railway deployment for the Workspace Platform API

Sprint to make the API deployable on Railway end-to-end once live keys are in
the dashboard. All deploy artifacts live in `deploy/` (plus two files that must
sit at the repo root — see below). Provider is OpenRouter, already wired
(`services/pipeline/llm-call.ts` + `lib/ai-client.ts` + `config/models.ts`);
the only secret that turns the LLM on is `OPENROUTER_API_KEY`.

> Branch note: this work and the `master-run/2026-06-02` merge were done on
> `claude/railway-deployment-setup-dixbhy` and reach `main` via a **draft PR**
> (the review step), per the session's branch rules — nothing was pushed to
> `main` directly.

---

## What shipped

| File                                    | Purpose                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `deploy/Dockerfile`                     | Multi-stage, monorepo-safe API image (A1)                                                        |
| `railway.json` _(repo root)_            | Points the service at the Dockerfile, healthcheck, restart policy (A2)                           |
| `.dockerignore` _(repo root)_           | Trims the build context                                                                          |
| `packages/api/src/scripts/db-deploy.ts` | One-off schema provisioner: `CREATE EXTENSION vector` → `drizzle-kit push --force` → verify (A3) |
| `deploy/smoke.ts`                       | Post-deploy end-to-end smoke test (A5)                                                           |
| `packages/api/package.json`             | Adds `db:deploy` and `smoke` scripts                                                             |
| `packages/api/src/index.ts`             | Single-port WS warning (A4) + production auth-bypass guard (A6)                                  |

### Why two files are at the repo root, not in `deploy/`

- **`railway.json`** — Railway auto-detects config-as-code at the **repo root**,
  and the Docker build context is the repo root (so the monorepo install works).
  It points `build.dockerfilePath` at `deploy/Dockerfile`.
- **`.dockerignore`** — Docker reads it from the **build context root**.

### Why `db-deploy.ts` is in `packages/api`, not `deploy/`

It imports `postgres`, which only resolves cleanly from inside the api package
(pnpm does not hoist it to the repo root). It's also invoked as a _package
script_ per the runbook (`pnpm --filter @workspace/api db:deploy`). The smoke
test, by contrast, uses only global `fetch`, so it lives in `deploy/`.

---

## A1 — Dockerfile (and the one real deviation)

**Runtime is `tsx src/index.ts`, not `node dist/index.js`.** This is a
deliberate, justified deviation from the brief's literal wording:

- `@workspace/shared` is consumed as **TypeScript source** — its
  `package.json` `exports` point at `./src/*.ts` and it builds with `noEmit`,
  so there is no JS artifact to resolve at runtime.
- `packages/api` compiles with `moduleResolution: bundler` + ESM modules, but
  its `package.json` has **no `"type": "module"`** (CommonJS manifest). A plain
  `tsc` emit can't be launched with `node` (workspace specifiers resolve to
  `.ts`, and the ESM/CJS mode disagrees).
- `tsx` is already the project's **dev** runtime (`tsx watch src/index.ts`), so
  running source through it in production gives high parity, handles the many
  dynamic `await import(...)` paths, and binds to `$PORT` exactly as `node`
  would (`index.ts` reads `process.env.PORT`, default 3001).

The image still **builds/validates** `@workspace/shared` then `@workspace/api`
via their `typecheck` scripts. The API has a known type-error baseline inside
gated-off handlers (see `CLAUDE.md`), so the typecheck is **advisory** (it does
not fail the build); runtime correctness is asserted by the smoke test.

Stages: `node:22-slim` → `corepack enable` (pins pnpm from
`packageManager`) → `COPY . .` → `pnpm install --frozen-lockfile` → advisory
typechecks → `NODE_ENV=production`, `DEV_BYPASS_AUTH=false` → `CMD pnpm exec tsx
src/index.ts` (cwd `packages/api`).

## A2 — railway.json

`builder: DOCKERFILE`, `dockerfilePath: deploy/Dockerfile`,
`healthcheckPath: /health` (exists at `app.ts`), `restartPolicyType:
ON_FAILURE`. The **watched branch (`main`) is set in the Railway service
settings** (Part B1) — it isn't a railway.json field. The start command is the
Dockerfile `CMD` (not duplicated in railway.json).

## A3 — schema provisioning as a one-off

`db:deploy` does, in order: open a single connection and
`CREATE EXTENSION IF NOT EXISTS vector` (several tables use `vector(...)`
columns, so the extension must exist first) → `drizzle-kit push --force`
(driven by `drizzle.config.ts`, which reads `DATABASE_URL`) → verify the
`vector` extension and the `anchors`, `anchor_edges`, `index_records` tables
exist, exiting non-zero on failure. It is **not** part of `start`, so restarts
never re-provision.

It runs automatically before each deploy via Railway's
`deploy.preDeployCommand` in `railway.json` (`pnpm --filter @workspace/api
db:deploy`) — runs in the built image with the service's env, halts the deploy
if the schema can't be provisioned, and needs no local Railway CLI. It can also
be run manually with `railway run pnpm --filter @workspace/api db:deploy`.

**Deviation — `push`, not `migrate`. → SUPERSEDED by MIGRATE-1 (2026-06-15).**
At DEPLOY-1 time, the brief specified `drizzle-kit migrate`, but this repo's SQL
migration journal was **stale**: it listed only 3 of the 8 migration files and
contained **no migration for `anchors` / `anchor_edges`** (commit `adfdd5b`
added those as raw DDL in `db/index.ts` for the PGlite fallback only). `migrate`
would have produced an incomplete schema, so DEPLOY-1 fell back to
`drizzle-kit push --force` (schema-driven, non-interactive, additive on a fresh
DB).

**MIGRATE-1 closed this:** the migrations were squashed into a single clean
baseline regenerated from the schema, and `db:deploy` now runs `drizzle-kit
migrate` (safe on populated DBs). The description below reflects the original
DEPLOY-1 behaviour; for the current behaviour see
`docs/audits/MIGRATE-1-REPORT.md`.

## A4 — single-port binding + WS note

HTTP, `/mcp`, and `/api/mcp-rest` all serve on `$PORT` (one Hono app). The
signal WS (`WS_PORT`, 3002) and Yjs WS (`YJS_WS_PORT`, 3003) bind to their own
ports inside the container but are **not publicly reachable** on Railway's
one-port model. `index.ts` now:

- logs a clear warning in production that real-time collab is **DEGRADED**, and
- binds each WS server best-effort (try/catch) so a bind failure warns instead
  of crashing the API.

**Deferred (not this sprint):** multiplex the WS + Yjs servers onto the main
HTTP server so collaboration works on a single port.

## A5 — smoke test

`deploy/smoke.ts` (run via `pnpm --filter @workspace/api smoke` or
`SMOKE_URL=… tsx deploy/smoke.ts`) asserts: `GET /health` → 200 `{status:"ok"}`;
`GET /api/mcp-rest/openapi.json` serves a valid spec; the `/mcp` SSE handshake
connects (or is reachable + auth-gated when no creds are supplied);
`DEV_BYPASS_AUTH=false` auth is enforced (no header → 401); an authed
`query_index` round-trip (when `SMOKE_USER_ID` is set); and one live OpenRouter
completion (skips with a clear message when `OPENROUTER_API_KEY` isn't set).

## A6 — production env defaults

`NODE_ENV=production` and `DEV_BYPASS_AUTH=false` are set in the Dockerfile and
in Railway vars (Part B3). `DEV_BYPASS_AUTH` already defaults to false in code
(only the literal string `'true'` enables it — `middleware/auth.ts`); a startup
guard now logs a loud SECURITY warning if it's left on in production, so the
unified auth-header path (CLEAN-2) is actually enforced.

---

## Part B — Railway provisioning runbook (dashboard)

1. **Project + API service.** New project → Deploy from GitHub repo →
   `workspace-platform`, branch **`main`**. It builds from `deploy/Dockerfile`
   (via root `railway.json`). Set the service healthcheck to `/health`.
2. **Backing services:**
   - **Postgres (pgvector):** deploy the **`pgvector/pgvector:pg16`** image
     (guarantees the `vector` extension; matches docker-compose).
   - **Redis:** Railway's native Redis.
   - **ClickHouse:** **`clickhouse/clickhouse-server:24-alpine`** image.
   - **MinIO:** **`minio/minio`** image, command `server /data`. Set its
     `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` (reused in Part C).
3. **Env vars on the API service** (use Railway variable references for the
   internal URLs):
   ```
   DATABASE_URL    → pgvector service connection string
   REDIS_URL       → Redis service URL
   CLICKHOUSE_URL  → http://<clickhouse-service>:8123
   S3_ENDPOINT     → http://<minio-service>:9000
   PORT            → (Railway sets this; the app reads it)
   NODE_ENV=production
   DEV_BYPASS_AUTH=false
   CLICKHOUSE_DB=follow
   CLICKHOUSE_USER=default
   S3_REGION=us-east-1
   S3_BUCKET=follow
   CROSS_REF_CONFIDENCE_THRESHOLD=0.7
   ```
   (Leave `THREAD_SPEAKER_MODEL` / `THREAD_DISTILLATION_MODEL` to the
   `config/models.ts` defaults unless overriding.)
4. **Domain + URL wiring.** Generate a public domain, then set:
   ```
   NEXT_PUBLIC_API_URL = https://<api>.up.railway.app
   NEXT_PUBLIC_URL     = https://<api>.up.railway.app
   NEXTAUTH_URL        = https://<api>.up.railway.app
   MCP_PUBLIC_URL      = https://<api>.up.railway.app/mcp
   NEXT_PUBLIC_WS_URL  = wss://<api>.up.railway.app   (degraded — see A4)
   ```
5. **Provision the schema once, then verify:**
   ```
   railway run pnpm --filter @workspace/api db:deploy
   SMOKE_URL=https://<api>.up.railway.app \
     OPENROUTER_API_KEY=<key> tsx deploy/smoke.ts
   ```

## Part C — live keys (the only secrets, on the API service)

```
OPENROUTER_API_KEY    = <OpenRouter key>            ← turns the LLM on
NEXTAUTH_SECRET       = <openssl rand -base64 32>
S3_ACCESS_KEY_ID      = <MinIO root user>
S3_SECRET_ACCESS_KEY  = <MinIO root password>
CLICKHOUSE_PASSWORD   = <ClickHouse password>
```

(The MinIO service must have the same root user/password as its own
`MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`.)

## Part D — definition of "working"

- [ ] `GET /health` → `{status:"ok"}` (200)
- [ ] DB migrated: `anchors`, `anchor_edges`, existing tables exist; `vector`
      extension present (asserted by `db:deploy`)
- [ ] One OpenRouter completion succeeds
- [ ] `/mcp` SSE handshake connects; `/api/mcp-rest` + the OpenAPI spec respond
- [ ] A `query_index` call round-trips
- [ ] `DEV_BYPASS_AUTH=false` and an authed request still works
- [ ] Smoke test green end-to-end

**Known-deferred (not blockers):** real-time collab WS multiplexing (A4);
ClickHouse/MinIO are only exercised once analytics/file features are hit.
