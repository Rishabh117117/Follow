/* eslint-disable no-console -- CLI diagnostic; console IS the output. */
/** Read-only census of core tables to identify which DB this is. */
import { sql } from 'drizzle-orm'
import { db, waitForDb } from '../../packages/api/src/db/index'

async function main() {
  await waitForDb()
  // list public tables
  const t = (await db.execute(
    sql.raw(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
    )
  )) as { rows?: Array<{ table_name: string }> } | Array<{ table_name: string }>
  const tables = (Array.isArray(t) ? t : (t.rows ?? [])).map((r) => r.table_name)
  console.log(`=== ${tables.length} public tables ===`)
  console.log(tables.join(', '))

  const count = async (tbl: string) => {
    if (!tables.includes(tbl)) return `(no table)`
    try {
      const r = (await db.execute(sql.raw(`SELECT count(*)::int AS c FROM "${tbl}"`))) as
        | { rows?: Array<{ c: number }> }
        | Array<{ c: number }>
      const rows = Array.isArray(r) ? r : (r.rows ?? [])
      return String(rows[0]?.c ?? '?')
    } catch (e) {
      return `(err: ${(e as Error).message})`
    }
  }
  console.log('\n=== core table counts ===')
  for (const tbl of [
    'users',
    'workspaces',
    'workspace_members',
    'mcp_keys',
    'conversations',
    'raw_files',
    'index_records',
    'signals',
    'ai_state',
    'projects',
    'threads',
    'events',
  ]) {
    console.log(`  ${tbl}: ${await count(tbl)}`)
  }

  // any checkpoints table from GRAPH-WIRE-1?
  const cp = tables.filter((x) => x.startsWith('checkpoint'))
  console.log(`\ncheckpoint* tables: ${cp.length ? cp.join(', ') : '(none yet)'}`)
  process.exit(0)
}
main().catch((err) => {
  console.error('[db-state] failed:', err)
  process.exit(1)
})
