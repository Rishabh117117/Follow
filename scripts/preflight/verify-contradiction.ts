/* eslint-disable no-console -- CLI verification; console IS the output. */
/**
 * CONTRADICT-1 — end-to-end contradiction verification against LIVE Postgres.
 *
 *   DATABASE_URL=postgres://...  OPENROUTER_API_KEY=sk-or-...  \
 *     npx tsx scripts/preflight/verify-contradiction.ts
 *
 * Requires `pipeline-analyst-llm` ON (flipped on the branch). Indexes each
 * clustered contradictory pair (note A, then note B as a SEPARATE conversation so
 * they cross-link) through the real chat-fact-extractor → indexer →
 * detectAndInsertLinks → ANALYST classifyEdge path, then reads the `contradicts`
 * edge back through the read-side bridge (getContradictionEdges) and reports cost.
 *
 * Writes disposable test data (titles prefixed [CONTRADICT-1]) into the live DB.
 * No S3 needed (chat-fact-extractor doesn't touch it).
 */
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db, waitForDb } from '../../packages/api/src/db/index'
import { extractAndIndexChatFacts } from '../../packages/api/src/services/semantic-index/chat-fact-extractor'
import {
  getContradictionEdges,
  formatContradictionEdges,
} from '../../packages/api/src/services/contradictions/edges'
import { isServerFeatureActive } from '../../packages/api/src/config/server-vault'
import { CONTRADICTION_PAIRS } from './seed-corpus'

async function one<T = Record<string, unknown>>(q: string): Promise<T[]> {
  const r = (await db.execute(sql.raw(q))) as { rows?: T[] } | T[]
  return Array.isArray(r) ? r : (r.rows ?? [])
}

async function pickUserWorkspace(): Promise<{ userId: string; workspaceId: string }> {
  const rows = await one<{ user_id: string; workspace_id: string }>(
    `SELECT user_id, workspace_id FROM index_records WHERE deleted_at IS NULL
     GROUP BY user_id, workspace_id ORDER BY count(*) DESC LIMIT 1`
  )
  if (rows[0]) return { userId: rows[0].user_id, workspaceId: rows[0].workspace_id }
  const u = await one<{ id: string }>(`SELECT id FROM users LIMIT 1`)
  const w = await one<{ id: string }>(`SELECT id FROM workspaces LIMIT 1`)
  return { userId: u[0]!.id, workspaceId: w[0]!.id }
}

async function indexNote(
  workspaceId: string,
  userId: string,
  title: string,
  q: string,
  a: string,
  topic: string
): Promise<void> {
  const convId = randomUUID()
  await db.execute(sql`
    INSERT INTO chat_conversations (id, workspace_id, user_id, title, chat_source_type)
    VALUES (${convId}::uuid, ${workspaceId}::uuid, ${userId}::uuid, ${title}, 'claude')
  `)
  await extractAndIndexChatFacts({
    conversationId: convId,
    workspaceId,
    userId,
    chunks: [
      {
        chunkIndex: 0,
        text: `[user] ${q}\n\n[assistant] ${a}`,
        importance: 0.7,
        topics: [topic],
        summary: a.slice(0, 80),
      },
    ],
  })
}

async function main() {
  if (!process.env['DATABASE_URL']) {
    console.error('DATABASE_URL must be a real shell env var.')
    process.exit(2)
  }
  await waitForDb()
  console.log('=== CONTRADICT-1 end-to-end verification ===\n')
  console.log(`pipeline-analyst-llm active: ${isServerFeatureActive('pipeline-analyst-llm')}`)
  if (!isServerFeatureActive('pipeline-analyst-llm')) {
    console.error('ANALYST flag is OFF — flip pipeline-analyst-llm in server-vault.ts first.')
    process.exit(1)
  }
  if (!process.env['OPENROUTER_API_KEY']) {
    console.error('OPENROUTER_API_KEY required (embeddings + ANALYST classify).')
    process.exit(1)
  }

  const { userId, workspaceId } = await pickUserWorkspace()
  console.log(`Target: workspace=${workspaceId} user=${userId}\n`)

  const startIso = (await one<{ now: string }>(`SELECT now()::text AS now`))[0]!.now
  const edgesBefore = (
    await one<{ c: number }>(
      `SELECT count(*)::int c FROM semantic_links WHERE link_type='contradicts'`
    )
  )[0]!.c

  for (const pair of CONTRADICTION_PAIRS) {
    const tag = `[CONTRADICT-1] ${pair.topic}`
    console.log(`Indexing pair "${pair.topic}" (A then B)…`)
    await indexNote(workspaceId, userId, `${tag} (A)`, pair.a.q, pair.a.a, pair.topic)
    await new Promise((r) => setTimeout(r, 1500))
    await indexNote(workspaceId, userId, `${tag} (B)`, pair.b.q, pair.b.a, pair.topic)
    await new Promise((r) => setTimeout(r, 1500))
  }

  // Let any async link insertion settle.
  await new Promise((r) => setTimeout(r, 2500))

  const edgesAfter = (
    await one<{ c: number }>(
      `SELECT count(*)::int c FROM semantic_links WHERE link_type='contradicts'`
    )
  )[0]!.c
  console.log(`\ncontradicts edges: ${edgesBefore} → ${edgesAfter} (+${edgesAfter - edgesBefore})`)

  // Read back through the BRIDGE.
  const edges = await getContradictionEdges({ workspaceId })
  const fresh = edges.filter((e) => e.createdAt >= startIso)
  console.log(
    `\n=== Bridge (getContradictionEdges) returned ${fresh.length} fresh contradiction(s) ===\n`
  )
  console.log(formatContradictionEdges(fresh) || '(none)')

  // Cost: llm_usage since start.
  const cost = await one<{ tier: string; n: number; usd: number; intok: number; outtok: number }>(
    `SELECT model_tier AS tier, count(*)::int n, COALESCE(sum(cost_usd),0)::float usd,
            COALESCE(sum(input_tokens),0)::int intok, COALESCE(sum(output_tokens),0)::int outtok
     FROM llm_usage WHERE created_at >= '${startIso}' GROUP BY model_tier ORDER BY usd DESC`
  )
  console.log('\n=== Cost (llm_usage since run start) ===')
  let totalUsd = 0
  let analystCalls = 0
  for (const c of cost) {
    console.log(
      `  ${c.tier}: ${c.n} calls, $${c.usd.toFixed(6)} (in ${c.intok} / out ${c.outtok} tok)`
    )
    totalUsd += c.usd
    if (c.tier === 'ANALYST') analystCalls = c.n
  }
  console.log(`  TOTAL: $${totalUsd.toFixed(6)} across this run`)
  console.log(
    `  ANALYST: ${analystCalls} classify call(s); ~$${(analystCalls ? totalUsd / 1 : 0).toFixed(6)} run total. ` +
      `Per-pair ANALYST cost scales with qualifying pairs (≤ inserted × candidates).`
  )

  console.log('\n=== VERDICT ===')
  const ok = fresh.length >= 1 && edgesAfter > edgesBefore
  console.log(
    ok
      ? '✅ A planted contradiction produced a `contradicts` edge AND surfaced through the bridge with both sides + reason.'
      : '❌ No contradiction surfaced — see counts above (HALT: check cosines/threshold or ANALYST verdicts).'
  )
  process.exit(ok ? 0 : 1)
}
main().catch((e) => {
  console.error('[verify-contradiction] crashed:', e)
  process.exit(1)
})
