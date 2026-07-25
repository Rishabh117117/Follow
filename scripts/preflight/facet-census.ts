/* eslint-disable no-console -- CLI diagnostic; console IS the output. */
/**
 * Ad-hoc census of index_records facet population on the live DB.
 * Read-only. Run: DATABASE_URL=... npx tsx scripts/preflight/facet-census.ts
 */
import { sql } from 'drizzle-orm'
import { db, waitForDb } from '../../packages/api/src/db/index'

async function main() {
  await waitForDb()
  const q = async (label: string, clause: string) => {
    const r = (await db.execute(
      sql.raw(`SELECT count(*)::int AS c FROM index_records ${clause}`)
    )) as { rows?: Array<{ c: number }> } | Array<{ c: number }>
    const rows = Array.isArray(r) ? r : (r.rows ?? [])
    console.log(`  ${label}: ${rows[0]?.c ?? '?'}`)
  }
  console.log('=== index_records facet census (live) ===')
  await q('total rows', '')
  await q('not-deleted', 'WHERE deleted_at IS NULL')
  await q('has embedding (composite)', 'WHERE embedding IS NOT NULL AND deleted_at IS NULL')
  await q('has content facet', 'WHERE embedding_content IS NOT NULL AND deleted_at IS NULL')
  await q('has causal facet', 'WHERE embedding_causal IS NOT NULL AND deleted_at IS NULL')
  await q('has context facet', 'WHERE embedding_context IS NOT NULL AND deleted_at IS NULL')
  await q(
    'full triple',
    'WHERE embedding_content IS NOT NULL AND embedding_causal IS NOT NULL AND embedding_context IS NOT NULL AND deleted_at IS NULL'
  )
  await q(
    'content+context (no causal)',
    'WHERE embedding_content IS NOT NULL AND embedding_context IS NOT NULL AND embedding_causal IS NULL AND deleted_at IS NULL'
  )
  // breakdown by source type if the column exists
  try {
    const r = (await db.execute(
      sql.raw(
        `SELECT source_type AS t, count(*)::int AS c FROM index_records WHERE deleted_at IS NULL GROUP BY source_type ORDER BY c DESC`
      )
    )) as { rows?: Array<{ t: string; c: number }> } | Array<{ t: string; c: number }>
    const rows = Array.isArray(r) ? r : (r.rows ?? [])
    console.log('\nBy source_type (not-deleted):')
    for (const row of rows) console.log(`  ${row.t ?? '(null)'}: ${row.c}`)
  } catch (e) {
    console.log('  (source_type breakdown skipped:', (e as Error).message, ')')
  }
  process.exit(0)
}
main().catch((err) => {
  console.error('[census] failed:', err)
  process.exit(1)
})
