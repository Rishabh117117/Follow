# E2E-1 — prove the live loop (harness + runbook)

**Date:** 2026-06-16 · **Branch:** `claude/e2e-1` (off `main`) → PR
**Repo:** `Rishabh117117/workspace-platform`

> E2E-1 is the finish line: the whole loop on the live DB. The actual proof is a
> **live run** (Rishabh) — real Postgres surfaces what the PGlite/mocked suite
> never hits. This sprint delivers the **one-command harness** that drives the
> loop and reports each step, plus the runbook. No app/runtime code changed.

---

## Deliverable — `deploy/e2e-smoke.ts` (`pnpm --filter @workspace/api e2e`)

Drives the real loop over the **same MCP-REST path Claude uses**, carrying a
`wsp_…` key as `?key=` (the SSE/headerless path) or a `x-user-id` header:

| Step | Tool                            | Assertion                                                                                             |
| ---- | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 0    | `GET /health`                   | 200 (else stop)                                                                                       |
| 1    | `save_conversation`             | 200, no `isError`; saves a unique **sentinel** marker as a `claude` conversation                      |
| 2    | `query_index` (polled, backoff) | retrieves the sentinel → **PASS**; tool responds but ranking lag hides it → **WARN** (soft, not fail) |
| 3    | `directory_query`               | 200, no `isError`                                                                                     |
| 4    | `detect_contradictions`         | 200, no `isError`                                                                                     |

Design notes:

- **Sentinel round-trip:** save embeds `e2e-sentinel-<ts>-<rand>`; query polls for
  exactly that string, so a PASS means the write reached live Postgres, the
  pipeline indexed it, and retrieval surfaced it — the full loop, not a mock.
- **Eventually-consistent retrieval:** indexing is async, so step 2 polls with
  backoff (2s→8s, `E2E_POLL` attempts) and degrades to **WARN** rather than a
  false failure if the sentinel hasn't surfaced yet. Save-success + every tool
  responding cleanly are the hard requirements (non-zero exit on any FAIL).
- **Auth mirrors production:** `?key=wsp_…` is exactly what Claude's connector
  uses, so a green run also re-proves MCP-LIVE-1's key path end-to-end.
- Self-contained (`fetch`/`URL` only, no workspace imports); type-clean under
  strict `tsc`; runs from anywhere.

**Static checks:** strict `tsc --noEmit` on the file = clean; lint-staged eslint
clean; executes correctly against an unreachable URL (health FAIL → exit 1) and
with no auth (loop SKIP). `deploy/` is outside the package typecheck scope, so
no TS-baseline impact.

---

## Rishabh — live runbook (the finish line)

Prereqs: WEB-DEPLOY-1 live · AUTH-LIVE-1 live (Google) · MIGRATE-1 adopted (DB
migrated) · `DEV_BYPASS_AUTH=false`.

1. **Log in** to the deployed web via Google → land as a real user with a
   workspace. (Optionally create a project.)
2. **Mint an MCP key** at `/settings/connectors` → copy the `wsp_…`.
3. **Run the harness** against the live API:
   ```bash
   E2E_URL=https://workspace-platform-production.up.railway.app \
   E2E_MCP_KEY=wsp_... \
   pnpm --filter @workspace/api e2e
   ```
   Expect: `save_conversation` ✅, `query_index` ✅ (or ⚠️ if indexing lags —
   re-run, or raise `E2E_POLL`), `directory_query` ✅, `detect_contradictions` ✅
   → **"E2E loop green."**
4. **Confirm via Claude** (the human half): connect the same key, `save_conversation`
   a real chat, `query_index` it back, and check the item appears in the web app's
   indexed files + per-project graph.

### What real Postgres may surface (fix-as-found, per the plan)

OpenRouter wiring under prod env · `vector`/embedding writes on real pgvector ·
session/scope resolution with `DEV_BYPASS_AUTH=false`. Each fix = its own commit;
halt-and-report on anything structural. Capture the transcript here once run.

**E2E-1 live result — ✅ GREEN (2026-06-16).** Ran against the live Railway
deployment over the `?key=wsp_…` MCP path: `health` ✅ · `save_conversation` ✅
(written to live Postgres) · `query_index` ✅ (**sentinel retrieved on attempt 1**
— full write→pipeline→index→retrieve loop) · `directory_query` ✅ ·
`detect_contradictions` ✅ (reachable, correctly scope-gated). **5 passed, 0 failed.**

Prod blockers found & fixed live during bring-up (each its own commit on `main`):

- **AUTH-LIVE-1:** Auth.js v5 needed `trustHost: true` (UntrustedHost → 500 on all
  `/api/auth/*`); middleware read the session via v4 `getToken` which can't decrypt
  the v5 cookie (login loop) → switched to the `auth()` wrapper.
- **MCP-LIVE-1:** `POST /api/mcp/keys` inserted a null `workspace_id` → fall back to
  the user's workspace membership; prod CORS only allowed `NEXT_PUBLIC_URL` → allow
  the web app's `*.up.railway.app` origin.
- **MIGRATE-1:** the push-provisioned prod DB had no migration journal, so the
  pre-deploy `drizzle-kit migrate` hit "relation already exists" and rolled back every
  API deploy → `db:deploy` now auto-stamps the baseline when tables exist but the
  ledger is empty (self-healing, idempotent).
- **WEB-DEPLOY-1:** web service inherited the API's migration pre-deploy command →
  gave the web config its own no-op `preDeployCommand`.

## Depends on

WEB-DEPLOY-1 (#7) · AUTH-LIVE-1 (#8) · MCP-LIVE-1 (#9) · MIGRATE-1 live (#6).
