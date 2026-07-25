/* eslint-disable no-console -- CLI verification; console IS the output. */
/**
 * Verify the LIVE deploy actually indexes + embeds (not just MCP transport).
 *
 *   E2E_URL=https://<api> E2E_MCP_KEY=wsp_... DATABASE_URL=postgres://... \
 *     npx tsx scripts/preflight/verify-pipeline.ts
 *
 * Snapshots DB counts → save_conversation via MCP-REST → polls query_index AND
 * the DB for growth in index_records / document_chunks / llm_usage. Read-only on
 * the DB; the only mutation is the one sentinel conversation pushed via MCP.
 */
import { sql } from 'drizzle-orm'
import { db, waitForDb } from '../../packages/api/src/db/index'

const BASE = (process.env['E2E_URL'] || '').replace(/\/+$/, '')
const KEY = process.env['E2E_MCP_KEY'] || ''
const SENTINEL = `verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function counts() {
  const c = async (t: string) => {
    try {
      const r = (await db.execute(sql.raw(`SELECT count(*)::int AS c FROM "${t}"`))) as
        | { rows?: Array<{ c: number }> }
        | Array<{ c: number }>
      const rows = Array.isArray(r) ? r : (r.rows ?? [])
      return rows[0]?.c ?? -1
    } catch {
      return -1
    }
  }
  return {
    index_records: await c('index_records'),
    document_chunks: await c('document_chunks'),
    llm_usage: await c('llm_usage'),
    raw_files: await c('raw_files'),
    chat_conversations: await c('chat_conversations'),
  }
}

async function callTool(tool: string, body: unknown) {
  const url = new URL(`${BASE}/api/mcp-rest/${tool}`)
  if (KEY) url.searchParams.set('key', KEY)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as {
    data?: { content?: Array<{ text?: string }>; isError?: boolean }
    error?: { message?: string } | null
  }
  return { status: res.status, json }
}
const text = (j: { data?: { content?: Array<{ text?: string }> } }) =>
  (j.data?.content ?? [])
    .map((c) => c.text ?? '')
    .join('\n')
    .trim()

async function main() {
  if (!BASE || !KEY) {
    console.error('Need E2E_URL and E2E_MCP_KEY')
    process.exit(2)
  }
  await waitForDb()
  console.log(`\n=== verify-pipeline against ${BASE} ===`)
  console.log(`sentinel: ${SENTINEL}\n`)

  const health = await fetch(`${BASE}/health`)
    .then((r) => r.status)
    .catch((e) => String(e))
  console.log(`GET /health -> ${health}`)

  const before = await counts()
  console.log('DB before:', JSON.stringify(before))

  // save_conversation
  const saved = await callTool('save-conversation', {
    source_type: 'claude',
    title: `VERIFY ${SENTINEL}`,
    messages: [
      {
        role: 'user',
        content: `Pipeline verification marker: ${SENTINEL}. Why does indexing matter? Because retrieval depends on it.`,
      },
      {
        role: 'assistant',
        content: `Stored marker ${SENTINEL}. Indexing turns this into a retrievable record.`,
      },
    ],
  })
  console.log(
    `\nsave_conversation -> HTTP ${saved.status} isError=${saved.json.data?.isError ?? '?'}`
  )
  console.log(
    '  resp:',
    (text(saved.json) || JSON.stringify(saved.json.error) || '(empty)').slice(0, 200)
  )
  if (saved.status !== 200) {
    console.log('\n❌ save_conversation transport failed — cannot verify further.')
    process.exit(1)
  }

  // poll query_index + DB for ~60s
  let retrieved = false
  for (let attempt = 1; attempt <= 8; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 1 ? 3000 : 6000))
    const q = await callTool('query-index', { query: SENTINEL, limit: 5 })
    const qt = text(q.json)
    const hit = qt.includes(SENTINEL)
    const now = await counts()
    console.log(
      `\n[attempt ${attempt}] query_index hit=${hit} | DB: idx=${now.index_records}(+${now.index_records - before.index_records}) ` +
        `chunks=${now.document_chunks}(+${now.document_chunks - before.document_chunks}) ` +
        `llm=${now.llm_usage}(+${now.llm_usage - before.llm_usage}) ` +
        `raw=${now.raw_files}(+${now.raw_files - before.raw_files}) ` +
        `conv=${now.chat_conversations}(+${now.chat_conversations - before.chat_conversations})`
    )
    if (hit) retrieved = true
    const indexed =
      now.index_records > before.index_records || now.document_chunks > before.document_chunks
    if (retrieved && indexed) break
  }

  const after = await counts()
  console.log('\n=== VERDICT ===')
  console.log('DB after:', JSON.stringify(after))
  const grewIndex = after.index_records > before.index_records
  const grewChunks = after.document_chunks > before.document_chunks
  const grewLlm = after.llm_usage > before.llm_usage
  const grewConv = after.chat_conversations > before.chat_conversations
  console.log(`  conversation persisted:   ${grewConv ? 'YES' : 'NO'}`)
  console.log(`  index_records grew:       ${grewIndex ? 'YES' : 'NO'}`)
  console.log(`  document_chunks grew:     ${grewChunks ? 'YES' : 'NO'}`)
  console.log(`  llm_usage (embeddings):   ${grewLlm ? 'YES' : 'NO'}`)
  console.log(`  query_index retrieved it: ${retrieved ? 'YES' : 'NO'}`)
  if (grewIndex && retrieved) console.log('\n✅ Pipeline indexes + retrieves on the live deploy.')
  else if (grewConv && !grewIndex)
    console.log(
      '\n⚠️  Conversation saved but NOT indexed — passive pipeline is not running/embedding on the deploy.'
    )
  else console.log('\n❌ Indexing did not occur. See counts above.')
  process.exit(0)
}
main().catch((e) => {
  console.error('[verify] crashed:', e)
  process.exit(1)
})
