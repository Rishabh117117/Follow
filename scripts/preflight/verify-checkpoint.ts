/* eslint-disable no-console -- CLI verification; console IS the output. */
/**
 * GRAPH-WIRE-1 live check — run a real archivist consolidation tick through the
 * LangGraph harness with the Postgres checkpointer and confirm a checkpoint row
 * is written to the LangGraph checkpoint tables.
 *
 *   DATABASE_URL=postgres://...  [OPENROUTER_API_KEY=...]  \
 *     npx tsx scripts/preflight/verify-checkpoint.ts
 *
 * DATABASE_URL must be a REAL shell env var (the checkpointer reads
 * process.env.DATABASE_URL directly; runRoleGraph attaches it only when set).
 */
import { sql } from 'drizzle-orm'
import { db, waitForDb } from '../../packages/api/src/db/index'
import { runRoleGraph } from '../../packages/api/src/services/pipeline/graph/index'

async function listCheckpointTables(): Promise<string[]> {
  const r = (await db.execute(
    sql.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name LIKE 'checkpoint%'
       ORDER BY table_name`
    )
  )) as { rows?: Array<{ table_name: string }> } | Array<{ table_name: string }>
  return (Array.isArray(r) ? r : (r.rows ?? [])).map((x) => x.table_name)
}

async function countCheckpoints(): Promise<number> {
  try {
    const r = (await db.execute(sql.raw(`SELECT count(*)::int AS c FROM checkpoints`))) as
      | { rows?: Array<{ c: number }> }
      | Array<{ c: number }>
    const rows = Array.isArray(r) ? r : (r.rows ?? [])
    return Number(rows[0]?.c ?? 0)
  } catch {
    return 0 // table doesn't exist yet
  }
}

async function main() {
  if (!process.env['DATABASE_URL']) {
    console.error('DATABASE_URL must be set as a real shell env var.')
    process.exit(2)
  }
  await waitForDb()
  console.log('=== GRAPH-WIRE-1 checkpoint verification ===\n')

  // Pick a (workspace, user) that actually has indexed data so the archivist has
  // something to consolidate (the tick writes a checkpoint either way).
  const pick = (await db.execute(
    sql.raw(
      `SELECT workspace_id, user_id, count(*)::int AS c
       FROM index_records WHERE deleted_at IS NULL
       GROUP BY workspace_id, user_id ORDER BY c DESC LIMIT 1`
    )
  )) as
    | { rows?: Array<{ workspace_id: string; user_id: string; c: number }> }
    | Array<{ workspace_id: string; user_id: string; c: number }>
  const row = (Array.isArray(pick) ? pick : (pick.rows ?? []))[0]
  if (!row) {
    console.error('No index_records to consolidate — seed a corpus first.')
    process.exit(1)
  }
  const { workspace_id: workspaceId, user_id: userId } = row
  console.log(`Target: workspace=${workspaceId} user=${userId} (records=${row.c})`)

  const tablesBefore = await listCheckpointTables()
  const before = await countCheckpoints()
  console.log(`checkpoint tables before: [${tablesBefore.join(', ') || 'none'}]  rows: ${before}\n`)

  console.log('Running archivist consolidation tick through runRoleGraph (persist + checkpointer)…')
  // The checkpointer writes the input checkpoint at invoke start (before the
  // node body), so a checkpoint row lands even if the node later throws. We
  // therefore catch the tick error and STILL verify the checkpoint — but we
  // surface the crash loudly (it is NOT swallowed; see report).
  let tickError: string | null = null
  try {
    const state = await runRoleGraph({ role: 'archivist', userId, workspaceId, mode: 'scheduled' })
    const archivistLog = (state.nodeLog ?? []).find((n: { node: string }) => n.node === 'archivist')
    console.log(`  archivist nodeLog: ${JSON.stringify(archivistLog ?? null)}`)
  } catch (e) {
    tickError = e instanceof Error ? e.message : String(e)
    console.log(`  ⚠️  consolidation tick THREW: ${tickError}`)
  }
  console.log('')

  const tablesAfter = await listCheckpointTables()
  const after = await countCheckpoints()
  const threadId = `archivist:${userId}:${workspaceId}:scheduled`
  let forThread = 0
  try {
    const r = (await db.execute(
      sql.raw(
        `SELECT count(*)::int AS c FROM checkpoints WHERE thread_id = '${threadId.replace(/'/g, "''")}'`
      )
    )) as { rows?: Array<{ c: number }> } | Array<{ c: number }>
    const rows = Array.isArray(r) ? r : (r.rows ?? [])
    forThread = Number(rows[0]?.c ?? 0)
  } catch {
    /* ignore */
  }

  console.log(`checkpoint tables after: [${tablesAfter.join(', ')}]  rows: ${after}`)
  console.log(`checkpoint rows for thread_id="${threadId}": ${forThread}`)

  const ok = forThread >= 1
  console.log('\n=== VERDICT ===')
  console.log(`  checkpoint tables created:  ${tablesAfter.length > 0 ? 'YES' : 'NO'}`)
  console.log(`  checkpoint rows total:      ${after}`)
  console.log(
    `  row for this tick's thread: ${forThread >= 1 ? 'YES' : 'NO'} (thread_id=${threadId})`
  )
  console.log(`  consolidation completed:    ${tickError ? 'NO — see crash below' : 'YES'}`)
  if (tickError) {
    console.log(`\n⚠️  SEPARATE BUG (not the checkpoint claim): the archivist consolidation node`)
    console.log(`    threw: ${tickError}`)
    console.log(`    Root cause: a JS Date bound into a raw drizzle sql\`\` template fails on`)
    console.log(`    postgres.js (works via .toISOString()). Pre-existing in archivist.ts;`)
    console.log(`    masked by PGlite in tests. Must be fixed before consolidation is enabled.`)
  }
  if (ok) {
    console.log(
      '\n✅ GRAPH-WIRE-1 CHECKPOINT CONFIRMED: the consolidation tick writes a durable checkpoint row' +
        (tickError
          ? ' (even though the node then crashed — that is a separate, reported bug).'
          : '.')
    )
    process.exit(0)
  }
  console.log('\n❌ No checkpoint row written — see counts above.')
  process.exit(1)
}
main().catch((e) => {
  console.error('[verify-checkpoint] crashed:', e)
  process.exit(1)
})
