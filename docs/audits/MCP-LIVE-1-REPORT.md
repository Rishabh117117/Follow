# MCP-LIVE-1 — key-gen UX + connect Claude (CC portion)

**Date:** 2026-06-16 · **Branch:** `claude/mcp-live-1` (off `main`) → PR
**Repo:** `Rishabh117117/workspace-platform` · **App:** `@workspace/web` + `@workspace/api`

> Goal: a logged-in user mints an MCP key, gets a copy-paste connector URL, adds
> Follow to Claude, and the tools work live. This report covers the **CC portion**:
> the connectors UI + a static audit of the key-in-URL auth path. The live Claude
> connect is Rishabh's gate.

---

## New UI — `/settings/connectors`

A minimal, function-over-form settings page (`apps/web/src/app/settings/connectors/page.tsx`,

- nav entry in `settings-sidebar.tsx`):

* **Generate key** (optional name) → `POST /api/mcp/keys` → shows the raw
  `wsp_…` **once** plus the ready **connector URL** `${API_BASE}/mcp?key=wsp_…`,
  each with a copy button and the Claude "Add custom connector" instruction.
* **Active keys** list → `GET /api/mcp/keys` (prefix + created/last-used), each
  with **Revoke** → `DELETE /api/mcp/keys/:id`.

All three endpoints already existed (`routes/mcp-keys.ts`); the page is pure
client wiring over the typed `api` client. `API_BASE` (from `lib/api-client`)
is the live API origin, so the URL is reachable by Claude.

**Gates:** web `typecheck` = **0**; eslint `--max-warnings=0` clean; a real
`next build` compiled the route (`/settings/connectors`, 2.62 kB). Web tests
unchanged.

---

## Backend auth audit — the key-in-URL path is already correct (no fix needed)

The plan's make-or-break: SSE GETs can't send headers, so `?key=wsp_…` **must**
work on `/mcp`. Verified statically:

| Check                                               | Result | Evidence                                                                                   |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `?key=` / `?api_key=` query key accepted            | ✅     | `middleware/api-key-auth.ts:20,25-26`                                                      |
| `Authorization: Bearer wsp_…` accepted              | ✅     | `api-key-auth.ts:23`                                                                       |
| `/mcp` (SSE transport) runs flexAuth                | ✅     | `mcp/transport.ts:199-200` `mcpRoutes.use('*', flexAuth)`                                  |
| `/api/mcp-rest` runs flexAuth; openapi stays public | ✅     | `app.ts:230-231` (openapi router mounted first)                                            |
| HMAC secret parity (mint vs verify)                 | ✅     | both `createHmac('sha256','workspace-api-keys')` — `mcp-keys.ts:30` & `api-key-auth.ts:39` |

→ A minted `wsp_…` will validate over both transports, including the SSE query
path Claude uses. **No HALT, no backend change.**

---

## Rishabh — live gate

### curl checks (against the live API)

```bash
API=https://workspace-platform-production.up.railway.app
# 1) spec is public
curl -s -o /dev/null -w '%{http_code}\n' $API/api/mcp-rest/openapi.json      # 200

# 2) mint a key in the web app (/settings/connectors), then:
KEY=wsp_...    # the minted raw key
# REST tool with query key → 200, NOT 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/mcp-rest/query_index?key=$KEY" \
  -H 'Content-Type: application/json' -d '{"query":"hello"}'                  # 200
# SSE with query key → stream opens
curl -N "$API/mcp?key=$KEY"                                                   # event stream
```

If a tool POST 401s with a valid key, recheck `flexAuth` ordering on that route
(it's mounted at `app.ts:231`); the audit above shows the wiring is correct, so a
401 most likely means a bad/expired key.

### Connect Claude

Claude.ai → **Settings → Connectors → Add custom connector** → paste
`https://<API>/mcp?key=wsp_…` from `/settings/connectors`.

### Gate to pass

Claude lists Follow's tools · `save_conversation` from Claude returns success ·
`query_index` returns the saved content · the saved item also appears in the web
app.

### HALT rules

`?key=wsp_` 401 on `/mcp` SSE specifically (would contradict the audit — capture
the response) · key minted but not found on validation (HMAC mismatch — ruled
out above).

## Depends on / next

A logged-in user (AUTH-LIVE-1) on the deployed web (WEB-DEPLOY-1), live API +
migrated DB. Then **E2E-1** (drive the whole loop on live Postgres).
