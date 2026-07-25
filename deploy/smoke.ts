/**
 * Post-deploy smoke test (DEPLOY-1 §A5).
 *
 * Asserts the live Railway deployment is actually working end-to-end. Uses
 * only the global `fetch` (Node 18+/22) so it has no workspace dependencies
 * and runs from anywhere:
 *
 *   SMOKE_URL=https://<your-api>.up.railway.app tsx deploy/smoke.ts
 *   # or:  tsx deploy/smoke.ts https://<your-api>.up.railway.app
 *
 * Optional env:
 *   SMOKE_USER_ID        a real user id → enables the authed query_index round-trip
 *   SMOKE_AUTH_SECRET    the API's AUTH_API_SECRET → mints the Phase-3 bearer
 *                        for SMOKE_USER_ID (bare x-user-id no longer authenticates)
 *   OPENROUTER_API_KEY   set → exercises one live OpenRouter completion
 *   SMOKE_MODEL          OpenRouter model id (default: free Gemma tier)
 *   SMOKE_MCP_API_KEY    MCP API key → authenticates the /mcp SSE handshake
 *
 * Exit code is non-zero if any required check FAILS. Checks that need a
 * secret/credential that isn't provided are SKIPPED with a clear message.
 */

import { createHmac } from 'node:crypto'

const BASE = (process.argv[2] || process.env['SMOKE_URL'] || 'http://localhost:3001').replace(
  /\/+$/,
  ''
)
const USER_ID = process.env['SMOKE_USER_ID']
const AUTH_SECRET = process.env['SMOKE_AUTH_SECRET']
const MCP_API_KEY = process.env['SMOKE_MCP_API_KEY']
const OPENROUTER_API_KEY = process.env['OPENROUTER_API_KEY']
const OPENROUTER_MODEL = process.env['SMOKE_MODEL'] || 'google/gemma-4-31b-it:free'

type Status = 'PASS' | 'FAIL' | 'SKIP'
const results: { name: string; status: Status; detail: string }[] = []

function record(name: string, status: Status, detail: string): void {
  results.push({ name, status, detail })
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️ '
  console.info(`${icon} ${name} — ${detail}`)
}

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    record(name, 'PASS', await fn())
  } catch (err) {
    record(name, 'FAIL', err instanceof Error ? err.message : String(err))
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

// Phase 3: the API accepts only verified bearer identity (or wsp_ keys). Mint
// the same HS256 JWT the web app signs — node:crypto only, no dependencies.
function mintApiToken(secret: string, sub: string): string {
  const b64 = (s: string): string => Buffer.from(s).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64(
    JSON.stringify({ sub, iss: 'workspace-web', aud: 'workspace-api', iat: now, exp: now + 900 })
  )
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

async function main(): Promise<void> {
  console.info(`\n🔎 Smoke testing ${BASE}\n`)

  // 1. Health ----------------------------------------------------------------
  await check('GET /health', async () => {
    const res = await fetch(`${BASE}/health`)
    assert(res.status === 200, `expected 200, got ${res.status}`)
    const body = (await res.json()) as { status?: string }
    assert(body.status === 'ok', `expected status:"ok", got ${JSON.stringify(body)}`)
    return '200 {status:"ok"}'
  })

  // 2. OpenAPI spec (also proves /api/mcp-rest is mounted) -------------------
  await check('GET /api/mcp-rest/openapi.json', async () => {
    const res = await fetch(`${BASE}/api/mcp-rest/openapi.json`)
    assert(res.status === 200, `expected 200, got ${res.status}`)
    const spec = (await res.json()) as { openapi?: string; paths?: Record<string, unknown> }
    assert(typeof spec.openapi === 'string', 'missing "openapi" version field')
    assert(!!spec.paths && Object.keys(spec.paths).length > 0, 'spec has no paths')
    return `OpenAPI ${spec.openapi}, ${Object.keys(spec.paths!).length} paths`
  })

  // 3. /mcp SSE handshake ----------------------------------------------------
  await check('GET /mcp (SSE handshake)', async () => {
    const ctrl = new AbortController()
    const headers: Record<string, string> = { Accept: 'text/event-stream' }
    if (MCP_API_KEY) headers['X-API-Key'] = MCP_API_KEY
    else if (USER_ID && AUTH_SECRET)
      headers['Authorization'] = `Bearer ${mintApiToken(AUTH_SECRET, USER_ID)}`
    let res: Response
    try {
      res = await fetch(`${BASE}/mcp`, { headers, signal: ctrl.signal })
    } finally {
      // Don't hang reading the stream — we only need the response headers.
      ctrl.abort()
    }
    if (res.status === 200) {
      const ct = res.headers.get('content-type') || ''
      assert(ct.includes('text/event-stream'), `expected SSE content-type, got "${ct}"`)
      return '200 text/event-stream (connected)'
    }
    if (res.status === 401 || res.status === 403) {
      // Endpoint is mounted and correctly enforcing auth (DEV_BYPASS_AUTH=false).
      // Provide SMOKE_MCP_API_KEY or SMOKE_USER_ID to complete the handshake.
      return `${res.status} reachable + auth-gated (set SMOKE_MCP_API_KEY to fully connect)`
    }
    throw new Error(`unexpected status ${res.status}`)
  })

  // 4. Auth enforced with bypass off ----------------------------------------
  await check('Auth enforced (no header → 401)', async () => {
    const res = await fetch(`${BASE}/api/users/me`)
    assert(res.status === 401, `expected 401 with no auth, got ${res.status}`)
    return '401 (DEV_BYPASS_AUTH=false, auth path intact)'
  })

  // 5. query_index round-trip (needs a real user) ---------------------------
  if (USER_ID && AUTH_SECRET) {
    await check('POST /api/mcp-rest/query-index (authed)', async () => {
      const res = await fetch(`${BASE}/api/mcp-rest/query-index`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mintApiToken(AUTH_SECRET, USER_ID)}`,
        },
        body: JSON.stringify({ query: 'smoke test', limit: 1 }),
      })
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = (await res.json()) as { data?: unknown; error?: unknown }
      assert(body.error == null, `tool returned error: ${JSON.stringify(body.error)}`)
      return '200 (query_index round-tripped, minted bearer)'
    })
  } else {
    record(
      'POST /api/mcp-rest/query-index (authed)',
      'SKIP',
      'set SMOKE_USER_ID + SMOKE_AUTH_SECRET to exercise the authed round-trip (Phase 3: x-user-id alone no longer authenticates)'
    )
  }

  // 6. One live OpenRouter completion ---------------------------------------
  if (OPENROUTER_API_KEY) {
    await check('OpenRouter completion', async () => {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://follow.app',
          'X-Title': 'Follow Workspace Smoke',
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
          max_tokens: 8,
        }),
      })
      assert(res.status === 200, `expected 200, got ${res.status}: ${await res.text()}`)
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const content = body.choices?.[0]?.message?.content
      assert(typeof content === 'string', 'no completion content returned')
      return `model "${OPENROUTER_MODEL}" replied (${content!.trim().slice(0, 40)})`
    })
  } else {
    record('OpenRouter completion', 'SKIP', 'set OPENROUTER_API_KEY to exercise a live completion')
  }

  // Summary ------------------------------------------------------------------
  const failed = results.filter((r) => r.status === 'FAIL')
  const passed = results.filter((r) => r.status === 'PASS').length
  const skipped = results.filter((r) => r.status === 'SKIP').length
  console.info(`\n──────────────────────────────────────────`)
  console.info(`Smoke: ${passed} passed, ${failed.length} failed, ${skipped} skipped`)
  if (failed.length > 0) {
    console.error(`Failed: ${failed.map((f) => f.name).join(', ')}`)
    process.exit(1)
  }
  console.info('✅ Smoke test green\n')
}

main().catch((err) => {
  console.error('[smoke] crashed:', err)
  process.exit(1)
})
