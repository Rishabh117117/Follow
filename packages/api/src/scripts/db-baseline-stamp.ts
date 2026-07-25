/**
 * Zero-reset production-adoption path for MIGRATE-1 — use ONLY if the target DB
 * already holds real data (so `db:reset` is unacceptable).
 *
 *   railway run pnpm --filter @workspace/api db:baseline-stamp            # apply
 *   railway run pnpm --filter @workspace/api db:baseline-stamp --dry-run  # preview
 *
 * Why this exists: production was provisioned with `drizzle-kit push --force`,
 * which synced the schema but wrote NO `__drizzle_migrations` ledger row. After
 * MIGRATE-1 switches deploys to `migrate`, a naive `migrate` would try to run
 * the baseline `CREATE TABLE`s on tables that already exist and fail. This
 * script records the baseline as already-applied — computing its hash exactly
 * the way drizzle-orm's migrator does — WITHOUT executing the baseline SQL, so
 * `migrate` treats the baseline as done and only applies FUTURE migrations.
 *
 * It mirrors drizzle-orm's migrator precisely:
 *   - hash       = sha256(hex) of the FULL raw .sql file content
 *   - created_at = the journal entry's `when` (folderMillis)
 *   - ledger     = schema "drizzle", table "__drizzle_migrations"
 * (These are drizzle-kit's defaults; drizzle.config.ts overrides none of them.)
 *
 * Idempotent: skips any entry whose hash is already recorded. `--dry-run`
 * prints exactly what it would insert and changes nothing.
 */

import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import postgres from 'postgres'

// api package root (…/packages/api) — two levels up from src/scripts/
const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MIGRATIONS_DIR = resolve(API_ROOT, 'src/db/migrations')

// Best-effort local env load (no-op on Railway, where env is injected).
config({ path: resolve(API_ROOT, '.env.local') })
config({ path: resolve(API_ROOT, '.env') })

const MIGRATIONS_SCHEMA = 'drizzle'
const MIGRATIONS_TABLE = '__drizzle_migrations'
const DRY_RUN = process.argv.includes('--dry-run')

interface JournalEntry {
  idx: number
  when: number
  tag: string
  breakpoints: boolean
}

interface Journal {
  entries: JournalEntry[]
}

// Hash the way drizzle-orm's `readMigrationFiles` does: sha256 hex of the
// entire raw SQL file content (NOT per-statement).
function migrationHash(tag: string): string {
  const sqlPath = resolve(MIGRATIONS_DIR, `${tag}.sql`)
  const raw = readFileSync(sqlPath).toString()
  return createHash('sha256').update(raw).digest('hex')
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) {
    console.error('[db:baseline-stamp] DATABASE_URL is not set — aborting.')
    process.exit(1)
  }

  const journalPath = resolve(MIGRATIONS_DIR, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath).toString()) as Journal
  const entries = [...journal.entries].sort((a, b) => a.when - b.when)
  if (entries.length === 0) {
    console.error('[db:baseline-stamp] Journal has no entries — nothing to stamp.')
    process.exit(1)
  }

  const planned = entries.map((e) => ({
    tag: e.tag,
    hash: migrationHash(e.tag),
    createdAt: e.when,
  }))

  console.info('[db:baseline-stamp] Journal entries to record as applied:')
  for (const p of planned) {
    console.info(`[db:baseline-stamp]   ${p.tag}  hash=${p.hash}  created_at=${p.createdAt}`)
  }

  if (DRY_RUN) {
    console.info('[db:baseline-stamp] --dry-run: no changes made.')
    return
  }

  const sql = postgres(url, { max: 1 })
  try {
    // Create the ledger exactly as drizzle-orm's migrator does.
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`)
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (` +
        `id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`
    )

    const existing = await sql.unsafe<{ hash: string }[]>(
      `SELECT hash FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`
    )
    const have = new Set(existing.map((r) => r.hash))

    let inserted = 0
    for (const p of planned) {
      if (have.has(p.hash)) {
        console.info(`[db:baseline-stamp] ${p.tag}: already recorded — skipping.`)
        continue
      }
      await sql.unsafe(
        `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (hash, created_at) VALUES ($1, $2)`,
        [p.hash, p.createdAt]
      )
      console.info(`[db:baseline-stamp] ${p.tag}: ✅ recorded as applied.`)
      inserted++
    }

    console.info(
      `[db:baseline-stamp] ✅ Done — ${inserted} entr${inserted === 1 ? 'y' : 'ies'} stamped. ` +
        '`migrate` will now skip the baseline and apply only future migrations.'
    )
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error('[db:baseline-stamp] FAILED:', err)
  process.exit(1)
})
