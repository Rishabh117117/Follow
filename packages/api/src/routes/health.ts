import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from '../db/index'
import { clickhouse, isClickHouseFallback } from '../db/clickhouse'
import { redis } from '../redis/index'
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3'
import { mcpTools } from '../mcp/tools/index'
import { getSessionCount, getActiveClients, getToolAggregates } from '../mcp/transport'
import {
  sumCostsSince,
  groupCostsByModel,
  startOfToday,
  startOfMonth,
} from '../lib/llm-logger'

interface HealthCheck {
  status: 'ok' | 'error' | 'fallback'
  latency: number
  error?: string
}

export const healthRouter = new Hono()

healthRouter.get('/', async (c) => {
  const checks: Record<string, HealthCheck> = {}

  // PostgreSQL
  try {
    const start = Date.now()
    await db.execute(sql`SELECT 1`)
    checks['postgres'] = { status: 'ok', latency: Date.now() - start }
  } catch (e: unknown) {
    checks['postgres'] = {
      status: 'error',
      latency: 0,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  // ClickHouse
  try {
    const start = Date.now()
    if (isClickHouseFallback()) {
      checks['clickhouse'] = { status: 'fallback', latency: 0 }
    } else {
      await clickhouse.query({ query: 'SELECT 1', format: 'JSONEachRow' })
      checks['clickhouse'] = { status: 'ok', latency: Date.now() - start }
    }
  } catch (e: unknown) {
    checks['clickhouse'] = {
      status: 'error',
      latency: 0,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  // Redis
  try {
    const start = Date.now()
    const result = await redis.get('__health_check_noop__')
    void result
    checks['redis'] = { status: 'ok', latency: Date.now() - start }
  } catch (e: unknown) {
    checks['redis'] = {
      status: 'error',
      latency: 0,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  // S3 / MinIO
  const s3Endpoint = process.env['S3_ENDPOINT']
  const s3Key = process.env['S3_ACCESS_KEY_ID']
  if (s3Key) {
    try {
      const start = Date.now()
      const s3 = new S3Client({
        region: process.env['S3_REGION'] ?? 'us-east-1',
        credentials: {
          accessKeyId: s3Key,
          secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] ?? '',
        },
        ...(s3Endpoint ? { endpoint: s3Endpoint, forcePathStyle: true } : {}),
      })
      await s3.send(
        new HeadBucketCommand({
          Bucket: process.env['S3_BUCKET'] ?? 'workspace-platform-files',
        })
      )
      checks['s3'] = { status: 'ok', latency: Date.now() - start }
    } catch (e: unknown) {
      checks['s3'] = {
        status: 'error',
        latency: 0,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  } else {
    checks['s3'] = { status: 'error', latency: 0, error: 'S3 credentials not configured' }
  }

  // Index stats (non-blocking)
  let indexStats = {
    totalRecords: 0,
    rawFileCount: 0,
    chunks: 0, // STABILIZE-3: searchable document_chunks (what the MCP pipeline actually produces)
    /**
     * Files that have at least one chunk stored in document_chunks. This is
     * the persistent, monotonic counter the UI needs for "X done of Y total"
     * progress — survives API restarts and queue clears.
     */
    filesIndexed: 0,
    edges: 0,
    sourceBreakdown: [] as Array<{ source: string; count: number }>,
  }
  try {
    const [recCount] = await db.execute(sql`SELECT COUNT(*) as cnt FROM index_records`)
    const [fileCount] = await db.execute(sql`SELECT COUNT(*) as cnt FROM raw_files WHERE deleted_at IS NULL`)
    const [chunkCount] = await db.execute(sql`SELECT COUNT(*) as cnt FROM document_chunks`)
    const [distinctFileCount] = await db.execute(
      sql`SELECT COUNT(DISTINCT source_id) as cnt FROM document_chunks WHERE source_type = 'file'`
    )
    indexStats.totalRecords = Number((recCount as Record<string, unknown>)?.cnt ?? 0)
    indexStats.rawFileCount = Number((fileCount as Record<string, unknown>)?.cnt ?? 0)
    indexStats.chunks = Number((chunkCount as Record<string, unknown>)?.cnt ?? 0)
    indexStats.filesIndexed = Number((distinctFileCount as Record<string, unknown>)?.cnt ?? 0)
  } catch {
    // Non-fatal — stats may not be available if tables don't exist yet
  }

  // Source breakdown (non-blocking): count raw_files grouped by source_type
  try {
    const rows = await db.execute(sql`
      SELECT source_type, COUNT(*) as cnt
      FROM raw_files
      WHERE deleted_at IS NULL
      GROUP BY source_type
      ORDER BY cnt DESC
    `)
    indexStats.sourceBreakdown = (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
      source: String(r['source_type'] ?? 'unknown'),
      count: Number(r['cnt'] ?? 0),
    }))
  } catch {
    // Non-fatal
  }

  // Edge count: post KNOWLEDGE-EDGES-DROP-1 the canonical edge table is
  // semantic_links (weighted record-to-record connections). The legacy
  // knowledge_edges table was dropped 2026-04-22.
  try {
    const [edgeCount] = await db.execute(sql`SELECT COUNT(*) as cnt FROM semantic_links`)
    indexStats.edges = Number((edgeCount as Record<string, unknown>)?.cnt ?? 0)
  } catch {
    // Non-fatal — table may not exist yet
  }

  // MCP clients + tool metrics (WIRE-1) — real data from session map
  const mcpClients = getActiveClients()
  const mcpToolMetrics = getToolAggregates()

  // LLM costs (WIRE-1) — sums from llm_usage table
  const todayStart = startOfToday()
  const monthStart = startOfMonth()
  let costs = {
    today: 0,
    thisMonth: 0,
    byModel: [] as Array<{ model: string; cost: number; calls: number; tokens: number }>,
  }
  try {
    const [today, thisMonth, byModel] = await Promise.all([
      sumCostsSince(todayStart),
      sumCostsSince(monthStart),
      groupCostsByModel(monthStart),
    ])
    costs = { today, thisMonth, byModel }
  } catch {
    // Non-fatal
  }

  const allOk = Object.values(checks).every((ch) => ch.status === 'ok')
  const hasFallback = Object.values(checks).some((ch) => ch.status === 'fallback')

  return c.json(
    {
      status: allOk ? 'healthy' : hasFallback ? 'degraded' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      checks,
      mcp: {
        enabled: true,
        tools: mcpTools.length,
        toolNames: mcpTools.map((t) => t.name),
        toolMetrics: mcpToolMetrics,
        activeSessions: getSessionCount(),
        clients: mcpClients,
      },
      index: {
        records: indexStats.totalRecords,
        rawFiles: indexStats.rawFileCount,
        filesIndexed: indexStats.filesIndexed,
        chunks: indexStats.chunks,
        edges: indexStats.edges,
        sourceBreakdown: indexStats.sourceBreakdown,
      },
      config: {
        publicUrl: process.env['MCP_PUBLIC_URL'] || null,
      },
      costs,
    },
    allOk ? 200 : 503
  )
})
