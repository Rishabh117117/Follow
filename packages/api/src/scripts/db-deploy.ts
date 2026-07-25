/**
 * Production migration runner (DEPLOY-1 §A3; migrate-switch MIGRATE-1).
 *
 * Run ONCE per deploy as a Railway one-off — NOT baked into `start`, so
 * normal restarts never re-migrate. Wired as `railway.json`
 * `deploy.preDeployCommand`:
 *
 *   railway run pnpm --filter @workspace/api db:deploy
 *
 * Steps:
 *   1. CREATE EXTENSION IF NOT EXISTS vector  (several schema tables use
 *      `vector(...)` columns, so the extension must exist *first*; drizzle-kit
 *      does not emit `CREATE EXTENSION`). Stays before step 2.
 *   2. drizzle-kit migrate                    (applies any pending entries from
 *      the journal at src/db/migrations/, tracked in __drizzle_migrations).
 *   3. Verify the schema: `vector` extension present + the key tables exist
 *      (anchors, anchor_edges, index_records). Exits non-zero on failure so a
 *      bad provision is loud.
 *
 * Why `migrate`, not `push --force` (MIGRATE-1): the migration journal was
 * stale (3 of 8 files journaled, NO migration for `anchors`/`anchor_edges`),
 * so `migrate` would have built an incomplete schema and DEPLOY-1 fell back to
 * `push --force`. MIGRATE-1 squashed the migrations into a single clean
 * baseline regenerated from the schema (the source of truth), so a fresh
 * `migrate` now reproduces the full schema exactly. Unlike `push --force`,
 * `migrate` is **safe on a populated DB** — it never drops/alters to match,
 * it only applies un-applied journal entries. The baseline itself also
 * prepends `CREATE EXTENSION IF NOT EXISTS vector` as belt-and-suspenders.
 *
 * First-time adoption on an already-`push`-provisioned DB needs the baseline
 * recorded as applied without re-running its CREATE TABLEs — use `db:reset`
 * (empty DB; recommended) or `db:baseline-stamp` (DB with data). See
 * docs/audits/MIGRATE-1-REPORT.md.
 *
 * This lives in packages/api (not deploy/) on purpose: it imports `postgres`,
 * which only resolves cleanly from inside the api package. See DEPLOY-1.md.
 */

import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import postgres from 'postgres'

// api package root (…/packages/api) — two levels up from src/scripts/
const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MIGRATIONS_DIR = resolve(API_ROOT, 'src/db/migrations')

// Best-effort local env load (no-op on Railway, where env is injected).
config({ path: resolve(API_ROOT, '.env.local') })
config({ path: resolve(API_ROOT, '.env') })

const REQUIRED_TABLES = ['anchors', 'anchor_edges', 'index_records'] as const

/**
 * First-time MIGRATE-1 adoption, automated. If the DB was `push`-provisioned
 * (tables exist) but has no `__drizzle_migrations` ledger, a naive `migrate`
 * would try to re-run the baseline CREATE TABLEs and fail ("relation already
 * exists"). Detect that exact case and record the journal entries as applied —
 * the same hash drizzle-orm's migrator computes — WITHOUT executing them, so
 * the subsequent `migrate` skips the baseline. Idempotent and safe:
 *   - fresh empty DB (no tables)      → does nothing; migrate creates schema
 *   - push-provisioned DB (our case)  → stamps baseline; migrate is a no-op
 *   - already-adopted DB (has ledger) → does nothing; migrate applies future
 */
async function autoAdoptBaselineIfNeeded(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 })
  try {
    const ledgerExists =
      (await sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS reg`)[0]?.['reg'] != null
    if (ledgerExists) {
      const rows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations
      `
      if ((rows[0]?.n ?? 0) > 0) return // already adopted — nothing to do
    }
    // Ledger missing/empty. Only stamp if the schema was already provisioned
    // (a core table exists); otherwise this is a fresh DB and migrate should run.
    const provisioned =
      (await sql`SELECT to_regclass('public.index_records') AS reg`)[0]?.['reg'] != null
    if (!provisioned) {
      console.info('[db:deploy] Fresh DB (no journal, no tables) — migrate will create the schema.')
      return
    }

    console.info(
      '[db:deploy] Push-provisioned DB with no migration journal — stamping baseline as applied…'
    )
    const journalPath = resolve(MIGRATIONS_DIR, 'meta/_journal.json')
    const journal = JSON.parse(readFileSync(journalPath).toString()) as {
      entries: { when: number; tag: string }[]
    }
    const planned = [...journal.entries]
      .sort((a, b) => a.when - b.when)
      .map((e) => ({
        tag: e.tag,
        hash: createHash('sha256')
          .update(readFileSync(resolve(MIGRATIONS_DIR, `${e.tag}.sql`)).toString())
          .digest('hex'),
        createdAt: e.when,
      }))

    await sql.unsafe('CREATE SCHEMA IF NOT EXISTS "drizzle"')
    await sql.unsafe(
      'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" ' +
        '(id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)'
    )
    const existing = await sql.unsafe<{ hash: string }[]>(
      'SELECT hash FROM "drizzle"."__drizzle_migrations"'
    )
    const have = new Set(existing.map((r) => r.hash))
    for (const p of planned) {
      if (have.has(p.hash)) continue
      await sql.unsafe(
        'INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)',
        [p.hash, p.createdAt]
      )
      console.info(`[db:deploy] stamped ${p.tag} as applied`)
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) {
    console.error('[db:deploy] DATABASE_URL is not set — cannot provision. Aborting.')
    process.exit(1)
  }

  // ── 1. Ensure the pgvector extension exists (before migrate) ──────────────
  console.info('[db:deploy] Ensuring `vector` extension…')
  {
    const sql = postgres(url, { max: 1 })
    try {
      await sql`CREATE EXTENSION IF NOT EXISTS vector`
      console.info('[db:deploy] ✅ vector extension ready')
    } finally {
      await sql.end({ timeout: 5 })
    }
  }

  // ── 1b. Auto-adopt the baseline on a push-provisioned DB (no-op otherwise)
  //        so the migrate below never tries to re-create existing tables.
  await autoAdoptBaselineIfNeeded(url)

  // ── 2. Apply pending migrations via drizzle-kit migrate (reads
  //       drizzle.config.ts). Idempotent + safe on populated DBs: applies only
  //       un-applied journal entries, tracked in __drizzle_migrations.
  console.info('[db:deploy] Running drizzle-kit migrate…')
  execSync('pnpm exec drizzle-kit migrate', { cwd: API_ROOT, stdio: 'inherit' })

  // ── 3. Verify the resulting schema ────────────────────────────────────────
  console.info('[db:deploy] Verifying schema…')
  {
    const sql = postgres(url, { max: 1 })
    try {
      const ext = await sql<{ extname: string }[]>`
        SELECT extname FROM pg_extension WHERE extname = 'vector'
      `
      const tables = await sql<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
      `
      const present = new Set(tables.map((t) => t.table_name))
      const missing = REQUIRED_TABLES.filter((t) => !present.has(t))

      const hasVector = ext.length > 0
      console.info(`[db:deploy] vector extension: ${hasVector ? '✅' : '❌ MISSING'}`)
      for (const t of REQUIRED_TABLES) {
        console.info(`[db:deploy] table ${t}: ${present.has(t) ? '✅' : '❌ MISSING'}`)
      }

      if (!hasVector || missing.length > 0) {
        console.error(
          `[db:deploy] Verification FAILED — vector:${hasVector} missingTables:[${missing.join(', ')}]`
        )
        process.exit(1)
      }
      console.info(`[db:deploy] ✅ Migration complete — ${present.size} tables in public schema`)
    } finally {
      await sql.end({ timeout: 5 })
    }
  }
}

main().catch((err) => {
  console.error('[db:deploy] FAILED:', err)
  process.exit(1)
})
