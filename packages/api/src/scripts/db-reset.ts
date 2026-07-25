/**
 * Destructive DB reset — RECOMMENDED production-adoption path for MIGRATE-1
 * when the target DB is EMPTY (production is empty today).
 *
 *   CONFIRM_RESET=1 railway run pnpm --filter @workspace/api db:reset
 *
 * Why this exists: production was provisioned with `drizzle-kit push --force`,
 * which syncs the schema but writes NO `__drizzle_migrations` ledger row. After
 * MIGRATE-1 switches deploys to `migrate`, a naive `migrate` would try to run
 * the baseline `CREATE TABLE`s on tables that already exist and fail. Dropping
 * and recreating the `public` schema clears that state so the very next
 * `db:deploy` applies the clean baseline from scratch and records it normally.
 *
 * SAFETY:
 *   - Refuses to drop unless `CONFIRM_RESET=1` is set.
 *   - Prints row counts of key tables FIRST, so an accidental run against a
 *     populated DB is loud (you will see non-zero counts before anything drops).
 *   - `--dry-run` prints the counts and exits without dropping anything.
 *
 * If the DB turns out to hold real data, do NOT reset — use `db:baseline-stamp`
 * instead (records the baseline as applied without dropping). See
 * docs/audits/MIGRATE-1-REPORT.md.
 */

import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import postgres from 'postgres'

// api package root (…/packages/api) — two levels up from src/scripts/
const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// Best-effort local env load (no-op on Railway, where env is injected).
config({ path: resolve(API_ROOT, '.env.local') })
config({ path: resolve(API_ROOT, '.env') })

// Representative tables whose counts reveal whether the DB holds real data.
const KEY_TABLES = [
  'users',
  'workspaces',
  'files',
  'index_records',
  'anchors',
  'raw_files',
] as const

const DRY_RUN = process.argv.includes('--dry-run')

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) {
    console.error('[db:reset] DATABASE_URL is not set — refusing. Aborting.')
    process.exit(1)
  }

  const sql = postgres(url, { max: 1 })
  try {
    // ── 1. Print key-table row counts FIRST (loud if DB has data) ───────────
    console.info('[db:reset] Row counts BEFORE reset (key tables):')
    let totalRows = 0
    for (const t of KEY_TABLES) {
      try {
        const rows = await sql<{ n: string }[]>`
          SELECT count(*)::text AS n FROM ${sql(t)}
        `
        const n = Number(rows[0]?.n ?? '0')
        totalRows += n
        console.info(`[db:reset]   ${t}: ${n}`)
      } catch {
        // Table may not exist yet (fresh DB) — report and continue.
        console.info(`[db:reset]   ${t}: (absent)`)
      }
    }
    console.info(`[db:reset] Total across key tables: ${totalRows}`)

    if (totalRows > 0) {
      console.warn(
        '[db:reset] ⚠️  Key tables are NOT empty. If this is production data, ' +
          'STOP and use `db:baseline-stamp` instead of resetting.'
      )
    }

    // ── 2. Dry-run stops here ───────────────────────────────────────────────
    if (DRY_RUN) {
      console.info('[db:reset] --dry-run: no changes made.')
      return
    }

    // ── 3. Require explicit confirmation before dropping ────────────────────
    if (process.env['CONFIRM_RESET'] !== '1') {
      console.error(
        '[db:reset] Refusing to drop: set CONFIRM_RESET=1 to proceed ' +
          '(or pass --dry-run to preview). Aborting.'
      )
      process.exit(1)
    }

    // ── 4. Drop & recreate the public schema ────────────────────────────────
    console.info('[db:reset] Dropping and recreating schema "public"…')
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE')
    await sql.unsafe('CREATE SCHEMA public')
    console.info(
      '[db:reset] ✅ public schema reset. Run `db:deploy` next to apply the ' +
        'clean baseline from scratch.'
    )
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error('[db:reset] FAILED:', err)
  process.exit(1)
})
