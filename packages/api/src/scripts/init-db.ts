/**
 * Database initialization script for Docker infrastructure.
 *
 * 1. Connects to PostgreSQL and pushes Drizzle schema (drizzle-kit push)
 * 2. Connects to ClickHouse and creates all 4 analytics tables
 * 3. Connects to MinIO and creates the S3 bucket if it doesn't exist
 *
 * Usage: pnpm db:init  (or:  tsx packages/api/src/scripts/init-db.ts)
 */

import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
config({ path: resolve(__dir, '.env.local') })
config({ path: resolve(__dir, '.env') })
config({ path: resolve(__dir, '..', '..', '.env.docker') })

async function initPostgres(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) {
    console.warn('[init-db] DATABASE_URL not set — skipping PostgreSQL init')
    return
  }

  console.info('[init-db] Pushing Drizzle schema to PostgreSQL...')
  try {
    execSync('npx drizzle-kit push', {
      cwd: __dir,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: url },
    })
    console.info('[init-db] PostgreSQL schema pushed successfully')
  } catch (err) {
    console.error('[init-db] PostgreSQL schema push failed:', err)
    throw err
  }
}

async function initClickHouse(): Promise<void> {
  const url = process.env['CLICKHOUSE_URL']
  if (!url) {
    console.warn('[init-db] CLICKHOUSE_URL not set — skipping ClickHouse init')
    return
  }

  console.info('[init-db] Creating ClickHouse tables...')
  const { createClient } = await import('@clickhouse/client')
  const client = createClient({
    url,
    database: 'workspace_platform',
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 0,
    },
  })

  try {
    await client.command({ query: `CREATE DATABASE IF NOT EXISTS workspace_platform` })

    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS workspace_platform.timeline_events_raw (
          id UUID DEFAULT generateUUIDv4(),
          workspace_id UUID,
          user_id UUID,
          timestamp DateTime64(3),
          action_type LowCardinality(String),
          object_type LowCardinality(String),
          object_id UUID,
          object_name String DEFAULT '',
          parent_object_id Nullable(UUID),
          payload String DEFAULT '{}',
          session_id UUID DEFAULT generateUUIDv4(),
          agent_run_id Nullable(UUID),
          ip_address Nullable(String),
          user_agent Nullable(String),
          duration_ms Nullable(UInt32),
          metadata String DEFAULT '{}'
        ) ENGINE = MergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (workspace_id, timestamp, user_id)
        TTL timestamp + INTERVAL 2 YEAR
      `,
    })

    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS workspace_platform.processed_intents (
          workspace_id UUID,
          user_id UUID,
          timestamp DateTime64(3),
          user_action String,
          user_intent String,
          doc_object_action String,
          doc_object_intent String,
          summary_text String DEFAULT '',
          confidence Float32,
          tags Array(String),
          session_id UUID,
          processing_model String DEFAULT 'gemini-2.5-flash',
          processing_latency_ms UInt32
        ) ENGINE = MergeTree()
        ORDER BY (workspace_id, user_id, timestamp)
        TTL timestamp + INTERVAL 90 DAY
      `,
    })

    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS workspace_platform.timeline_heartbeats (
          workspace_id UUID,
          user_id UUID,
          session_id String,
          timestamp DateTime64(3),
          is_idle UInt8 DEFAULT 0,
          active_document_id Nullable(String),
          active_document_type Nullable(String),
          active_document_name Nullable(String),
          active_page String DEFAULT '',
          cursor_context String DEFAULT '',
          metadata String DEFAULT '{}'
        ) ENGINE = MergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (workspace_id, session_id, timestamp)
        TTL timestamp + INTERVAL 90 DAY
      `,
    })

    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS workspace_platform.thread_signals (
          id UUID DEFAULT generateUUIDv4(),
          session_id String,
          thread_id Nullable(String),
          workspace_id String,
          user_id String,
          signal_type LowCardinality(String),
          timestamp DateTime64(3),
          url Nullable(String),
          domain Nullable(String),
          title Nullable(String),
          metadata String DEFAULT '{}',
          processed UInt8 DEFAULT 0
        )
        ENGINE = MergeTree()
        ORDER BY (workspace_id, session_id, timestamp)
        TTL toDateTime(timestamp) + INTERVAL 7 DAY
        SETTINGS index_granularity = 8192
      `,
    })

    console.info('[init-db] ClickHouse tables created successfully')
  } catch (err) {
    console.error('[init-db] ClickHouse init failed:', err)
    throw err
  } finally {
    await client.close()
  }
}

async function initMinIO(): Promise<void> {
  const endpoint = process.env['S3_ENDPOINT']
  const accessKey = process.env['S3_ACCESS_KEY_ID']
  const secretKey = process.env['S3_SECRET_ACCESS_KEY']
  const bucket = process.env['S3_BUCKET'] ?? 'workspace-platform-files'

  if (!endpoint || !accessKey || !secretKey) {
    console.warn('[init-db] S3/MinIO credentials not set — skipping bucket init')
    return
  }

  console.info(`[init-db] Ensuring S3 bucket "${bucket}" exists...`)
  const { S3Client, HeadBucketCommand, CreateBucketCommand } = await import('@aws-sdk/client-s3')
  const s3 = new S3Client({
    region: process.env['S3_REGION'] ?? 'us-east-1',
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    endpoint,
    forcePathStyle: true,
  })

  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }))
    console.info(`[init-db] S3 bucket "${bucket}" already exists`)
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }))
      console.info(`[init-db] S3 bucket "${bucket}" created`)
    } catch (err) {
      console.error(`[init-db] Failed to create S3 bucket "${bucket}":`, err)
      throw err
    }
  }
}

async function main() {
  console.info('[init-db] Starting infrastructure initialization...\n')

  const results: { name: string; ok: boolean; error?: unknown }[] = []

  for (const [name, fn] of [
    ['PostgreSQL', initPostgres],
    ['ClickHouse', initClickHouse],
    ['MinIO (S3)', initMinIO],
  ] as const) {
    try {
      await fn()
      results.push({ name, ok: true })
    } catch (err) {
      results.push({ name, ok: false, error: err })
    }
    console.info()
  }

  console.info('─── Summary ───')
  for (const r of results) {
    console.info(`  ${r.ok ? '\u2705' : '\u274c'} ${r.name}`)
  }

  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    console.error(`\n${failed.length} service(s) failed to initialize`)
    process.exit(1)
  }

  console.info('\nAll services initialized successfully!')
}

main()
