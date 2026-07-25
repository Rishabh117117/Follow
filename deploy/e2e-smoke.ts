/**
 * E2E-1 — live end-to-end loop harness. (LOCK-IN-1: hardened.)
 *
 * Drives the real product loop against a LIVE deployment, the same path Claude
 * uses over MCP-REST: save a conversation → let the pipeline index it on live
 * Postgres → query it back → exercise the directory + contradiction tools.
 *
 *   E2E_URL=https://<api>.up.railway.app \
 *   E2E_MCP_KEY=wsp_... \
 *   DATABASE_URL=postgres://...   (REQUIRED to verify indexing — see below) \
 *   tsx deploy/e2e-smoke.ts
 *
 * Auth (one required to run the loop; otherwise those steps SKIP):
 *   E2E_MCP_KEY   an MCP key (wsp_...) → sent as ?key= (the Claude/SSE path)
 *   E2E_USER_ID   a real user id        → sent as x-user-id (header path)
 *
 * LOCK-IN-1 — the retrieval check is no longer a soft WARN. After the sentinel
 * save we assert, AT THE DB LEVEL, that `index_records`, `document_chunks`,
 * `llm_usage`, and `raw_files` each grew by ≥1 AND that an `index_records` row
 * matching the sentinel has a non-null embedding (a *real index hit* through the
 * embedded path, not the `ilike` keyword fallback that masked the dead pipeline
 * before — see PIPELINE-FIX-1-REPORT.md). Any of these failing = the test FAILS.
 * This requires DATABASE_URL pointing at the SAME Postgres the deploy writes to;
 * set it as a REAL shell env var (a dotenv-in-script load is too late — the db
 * module reads DATABASE_URL at import, so it would fall back to PGlite).
 *
 * Self-test: `E2E_SELFTEST=1 tsx deploy/e2e-smoke.ts` runs no network/DB; it
 * feeds synthetic before/after counts through the verdict function and asserts a
 * dead pipeline (llm_usage/index_records delta = 0) FAILS — proving the gate is
 * load-bearing (acceptance #1).
 *
 * Optional:
 *   E2E_POLL      DB/query poll attempts before giving up (default 10)
 *   E2E_SOURCE    save_conversation source_type (default 'claude')
 *
 * Exit code is non-zero if any REQUIRED check fails.
 */

// `sql` is a pure helper (reads no env) so a static import is safe. The db
// module is imported DYNAMICALLY (see getDb) so it reads DATABASE_URL at call
// time. Static-importing the bare `drizzle-orm` specifier resolves cleanly here
// (matching scripts/preflight/verify-pipeline.ts); a dynamic import of it does
// not (ESM exports-map quirk).
import { sql } from 'drizzle-orm'

const BASE = (process.argv[2] || process.env['E2E_URL'] || 'http://localhost:3001').replace(
  /\/+$/,
  ''
)
const MCP_KEY = process.env['E2E_MCP_KEY']
const USER_ID = process.env['E2E_USER_ID']
const POLL = Number(process.env['E2E_POLL'] || '10')
const SOURCE = process.env['E2E_SOURCE'] || 'claude'

// A unique sentinel so we can find exactly this conversation on the way back.
const SENTINEL = `e2e-sentinel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

type Status = 'PASS' | 'FAIL' | 'SKIP' | 'WARN'
const results: { name: string; status: Status; detail: string }[] = []

function record(name: string, status: Status, detail: string): void {
  results.push({ name, status, detail })
  const icon =
    status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : status === 'WARN' ? '⚠️ ' : '⏭️ '
  console.info(`${icon} ${name} — ${detail}`)
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

interface ToolEnvelope {
  data: { content?: { type: string; text?: string }[]; isError?: boolean } | null
  error: { code: string; message: string } | null
}

/**
 * POST an MCP tool over the REST bridge, carrying whichever auth we have.
 * Asserts the transport succeeded (HTTP 200, no envelope error). Tool-level
 * `isError` is NOT asserted here — some tools legitimately return a validation
 * or scope-gate message; the caller decides whether that counts as a failure.
 */
async function callTool(toolNameHyphen: string, body: unknown): Promise<ToolEnvelope> {
  const url = new URL(`${BASE}/api/mcp-rest/${toolNameHyphen}`)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (MCP_KEY) url.searchParams.set('key', MCP_KEY)
  else if (USER_ID) headers['x-user-id'] = USER_ID
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({ data: null, error: null }))) as ToolEnvelope
  if (res.status !== 200) {
    throw new Error(
      `HTTP ${res.status}: ${json.error?.message ?? JSON.stringify(json).slice(0, 200)}`
    )
  }
  assert(json.error == null, `tool error: ${JSON.stringify(json.error)}`)
  return json
}

function toolText(env: ToolEnvelope): string {
  return (env.data?.content ?? [])
    .map((c) => c.text ?? '')
    .join('\n')
    .trim()
}

// ─── LOCK-IN-1: DB-level indexing verification ──────────────────────────────

interface IndexCounts {
  index_records: number
  document_chunks: number
  llm_usage: number
  raw_files: number
}

const TRACKED_TABLES: (keyof IndexCounts)[] = [
  'index_records',
  'document_chunks',
  'llm_usage',
  'raw_files',
]

/**
 * The verdict function — pure, so it can be self-tested without a DB. A save is
 * only "indexed for real" if EVERY tracked table grew AND a real (embedded)
 * index hit exists. This is the structural guarantee that a dead pipeline
 * (llm_usage delta = 0, no embedded rows) can no longer pass — the false-green
 * that PIPELINE-FIX-1 uncovered.
 */
export function evaluateIndexing(
  before: IndexCounts,
  after: IndexCounts,
  realIndexHit: boolean
): { ok: boolean; deltas: IndexCounts; failures: string[] } {
  const deltas = {
    index_records: after.index_records - before.index_records,
    document_chunks: after.document_chunks - before.document_chunks,
    llm_usage: after.llm_usage - before.llm_usage,
    raw_files: after.raw_files - before.raw_files,
  }
  const failures: string[] = []
  for (const t of TRACKED_TABLES) {
    if (deltas[t] < 1) failures.push(`${t} did not grow (delta=${deltas[t]})`)
  }
  if (!realIndexHit) {
    failures.push(
      'no real index hit (no index_records row with a non-null embedding matched the sentinel — ' +
        'a keyword/ilike fallback over raw conversations does NOT count)'
    )
  }
  return { ok: failures.length === 0, deltas, failures }
}

/** Lazy DB handle. Dynamic import so DATABASE_URL is read at call time, not at
 *  module load (the db module decides Postgres-vs-PGlite at import). */
async function getDb() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbmod: any = await import('../packages/api/src/db/index')
  if (dbmod.waitForDb) await dbmod.waitForDb()
  return { db: dbmod.db }
}

async function countRows(): Promise<IndexCounts> {
  const { db } = await getDb()
  const one = async (table: string): Promise<number> => {
    const r = (await db.execute(sql.raw(`SELECT count(*)::int AS c FROM "${table}"`))) as
      | { rows?: Array<{ c: number }> }
      | Array<{ c: number }>
    const rows = Array.isArray(r) ? r : (r.rows ?? [])
    return Number(rows[0]?.c ?? 0)
  }
  return {
    index_records: await one('index_records'),
    document_chunks: await one('document_chunks'),
    llm_usage: await one('llm_usage'),
    raw_files: await one('raw_files'),
  }
}

/** A real index hit = an index_records row whose embedding_text contains the
 *  sentinel AND has a non-null embedding (it went through the embedded path). */
async function realIndexHit(sentinel: string): Promise<boolean> {
  const { db } = await getDb()
  const r = (await db.execute(
    sql.raw(
      `SELECT count(*)::int AS c FROM index_records
       WHERE embedding_text ILIKE '%${sentinel.replace(/'/g, "''")}%'
         AND embedding IS NOT NULL`
    )
  )) as { rows?: Array<{ c: number }> } | Array<{ c: number }>
  const rows = Array.isArray(r) ? r : (r.rows ?? [])
  return Number(rows[0]?.c ?? 0) >= 1
}

const haveAuth = !!(MCP_KEY || USER_ID)

// ─── Self-test: prove the gate is load-bearing (no network, no DB) ──────────

function runSelfTest(): void {
  console.info('\n🧪 E2E self-test — proving the indexing gate is load-bearing\n')
  const base: IndexCounts = { index_records: 5, document_chunks: 5, llm_usage: 5, raw_files: 5 }

  const healthy = evaluateIndexing(
    base,
    { index_records: 6, document_chunks: 6, llm_usage: 6, raw_files: 6 },
    true
  )
  // Dead pipeline: conversation persists (raw_files may even grow) but NOTHING
  // is embedded — exactly the PIPELINE-FIX-1 pre-fix state (llm_usage delta 0).
  const deadPipeline = evaluateIndexing(
    base,
    { index_records: 5, document_chunks: 5, llm_usage: 5, raw_files: 6 },
    false
  )

  console.info(`  healthy case      → ok=${healthy.ok} (expected true)`)
  console.info(
    `  dead-pipeline case → ok=${deadPipeline.ok} (expected false); failures: ${deadPipeline.failures.join('; ')}`
  )

  const passed = healthy.ok === true && deadPipeline.ok === false
  if (!passed) {
    console.error('\n❌ SELF-TEST FAILED — the verdict function is NOT load-bearing.')
    process.exit(1)
  }
  console.info(
    '\n✅ SELF-TEST PASSED — a dead pipeline (llm_usage/index_records delta=0, no embedded hit) ' +
      'FAILS the gate. False-green is structurally impossible.\n'
  )
  process.exit(0)
}

async function main(): Promise<void> {
  if (process.env['E2E_SELFTEST']) {
    runSelfTest()
    return
  }

  console.info(`\n🔁 E2E loop against ${BASE}`)
  console.info(
    `   auth: ${MCP_KEY ? '?key=wsp_… (MCP key)' : USER_ID ? 'x-user-id header' : 'NONE'}`
  )
  console.info(`   sentinel: ${SENTINEL}\n`)

  // 0. Reachability ----------------------------------------------------------
  try {
    const res = await fetch(`${BASE}/health`)
    assert(res.status === 200, `health ${res.status}`)
    record('GET /health', 'PASS', '200')
  } catch (err) {
    record('GET /health', 'FAIL', err instanceof Error ? err.message : String(err))
    return finish() // no point continuing if the API is down
  }

  if (!haveAuth) {
    record('E2E loop', 'SKIP', 'set E2E_MCP_KEY (preferred) or E2E_USER_ID to drive the loop')
    return finish()
  }

  // LOCK-IN-1: indexing verification needs DB access. Without it we cannot prove
  // the pipeline worked — and proving it is the whole point — so this is a hard
  // FAIL, not a skip. A "green" run MUST have verified indexing at the DB level.
  if (!process.env['DATABASE_URL']) {
    record(
      'indexing verification',
      'FAIL',
      'DATABASE_URL not set — cannot verify indexing at the DB level. Set it (real shell env var) ' +
        'to the Postgres the deploy writes to. Refusing to report green without DB proof.'
    )
    return finish()
  }

  // Snapshot DB counts BEFORE the save so we can assert real growth.
  let before: IndexCounts
  try {
    before = await countRows()
    record(
      'DB snapshot (before)',
      'PASS',
      `idx=${before.index_records} chunks=${before.document_chunks} llm=${before.llm_usage} raw=${before.raw_files}`
    )
  } catch (err) {
    record('DB snapshot (before)', 'FAIL', err instanceof Error ? err.message : String(err))
    return finish()
  }

  // 1. save_conversation -----------------------------------------------------
  try {
    const env = await callTool('save-conversation', {
      source_type: SOURCE,
      title: `E2E ${SENTINEL}`,
      messages: [
        { role: 'user', content: `Remember this exact marker for the E2E test: ${SENTINEL}.` },
        {
          role: 'assistant',
          content: `Acknowledged. The marker ${SENTINEL} is stored for retrieval.`,
        },
      ],
    })
    assert(!env.data?.isError, `save returned tool error: ${toolText(env)}`)
    record('save_conversation', 'PASS', `saved (${toolText(env).slice(0, 60) || 'ok'})`)
  } catch (err) {
    record('save_conversation', 'FAIL', err instanceof Error ? err.message : String(err))
    return finish()
  }

  // 2. HARD indexing assertion — poll the DB until every tracked table grows
  //    and a real (embedded) index hit appears, or the budget is exhausted.
  let verdict = evaluateIndexing(before, before, false)
  let hit = false
  let lastQueryText = ''
  for (let attempt = 1; attempt <= POLL; attempt++) {
    await sleep(attempt === 1 ? 3000 : Math.min(3000 * attempt, 9000))
    let after: IndexCounts
    try {
      after = await countRows()
      hit = await realIndexHit(SENTINEL)
    } catch (err) {
      lastQueryText = err instanceof Error ? err.message : String(err)
      continue
    }
    verdict = evaluateIndexing(before, after, hit)
    // Belt-and-suspenders: query_index should also surface it (any path).
    try {
      const q = await callTool('query-index', { query: SENTINEL, limit: 5 })
      lastQueryText = toolText(q).slice(0, 80)
    } catch (err) {
      lastQueryText = err instanceof Error ? err.message : String(err)
    }
    console.info(
      `   [attempt ${attempt}] deltas idx=+${verdict.deltas.index_records} chunks=+${verdict.deltas.document_chunks} ` +
        `llm=+${verdict.deltas.llm_usage} raw=+${verdict.deltas.raw_files} realHit=${hit}`
    )
    if (verdict.ok) break
  }

  if (verdict.ok) {
    record(
      'indexing (DB-verified)',
      'PASS',
      `all tracked tables grew + real index hit — idx=+${verdict.deltas.index_records} ` +
        `chunks=+${verdict.deltas.document_chunks} llm=+${verdict.deltas.llm_usage} raw=+${verdict.deltas.raw_files}`
    )
  } else {
    record(
      'indexing (DB-verified)',
      'FAIL',
      `pipeline did not fully index in ${POLL} polls: ${verdict.failures.join('; ')} ` +
        `(last query_index: ${lastQueryText || 'n/a'})`
    )
  }

  // 3. query_index returns a real index hit (assert the DB-level hit, not the
  //    mere presence of the sentinel string — that can come from the fallback).
  record(
    'query_index real index hit',
    hit ? 'PASS' : 'FAIL',
    hit
      ? 'index_records row with non-null embedding matched the sentinel'
      : 'no embedded index_records row matched — only the keyword fallback (or nothing) returned it'
  )

  // 4. directory_query — reachable + input-validated (topic-based) -----------
  try {
    const env = await callTool('directory-query', { topic: SENTINEL })
    const gated = !!env.data?.isError
    record(
      'directory_query',
      'PASS',
      (gated ? 'reachable (gated): ' : '') + (toolText(env).slice(0, 70) || '200 ok')
    )
  } catch (err) {
    record('directory_query', 'FAIL', err instanceof Error ? err.message : String(err))
  }

  // 5. detect_contradictions — reachable; correctly scope-gated without a
  //    shared project scope (contradictions only exist in project indexes).
  try {
    const env = await callTool('detect-contradictions', {})
    const gated = !!env.data?.isError
    record(
      'detect_contradictions',
      'PASS',
      (gated ? 'reachable (scope-gated): ' : '') + (toolText(env).slice(0, 70) || '200 ok')
    )
  } catch (err) {
    record('detect_contradictions', 'FAIL', err instanceof Error ? err.message : String(err))
  }

  finish()
}

function finish(): void {
  const failed = results.filter((r) => r.status === 'FAIL')
  const passed = results.filter((r) => r.status === 'PASS').length
  const warned = results.filter((r) => r.status === 'WARN').length
  const skipped = results.filter((r) => r.status === 'SKIP').length
  console.info(`\n──────────────────────────────────────────`)
  console.info(`E2E: ${passed} passed, ${failed.length} failed, ${warned} warn, ${skipped} skipped`)
  if (failed.length > 0) {
    console.error(`Failed: ${failed.map((f) => f.name).join(', ')}`)
    process.exit(1)
  }
  console.info('✅ E2E loop green' + (warned ? ' (with warnings — see above)' : '') + '\n')
}

main().catch((err) => {
  console.error('[e2e] crashed:', err)
  process.exit(1)
})
