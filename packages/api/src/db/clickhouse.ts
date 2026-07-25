/**
 * ClickHouse client with in-memory fallback for development.
 *
 * When ClickHouse is not running (e.g., no Docker), all inserts and queries
 * are handled by an in-memory store. This lets the full pipeline work end-to-end
 * without external dependencies — identical to how Redis has an in-memory fallback.
 */

import { createClient } from '@clickhouse/client'

const clickhouseUrl = process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123'

// ─── In-Memory ClickHouse Fallback ──────────────────────────────────

/**
 * Simple in-memory store that mimics the ClickHouse client interface.
 * Supports insert, query (with basic WHERE clause parsing), and command (no-op).
 */
class InMemoryClickHouse {
  private tables = new Map<string, Record<string, unknown>[]>()

  async insert(params: {
    table: string
    values: Record<string, unknown>[]
    format?: string
  }): Promise<void> {
    const tableName = params.table.replace('workspace_platform.', '')
    if (!this.tables.has(tableName)) {
      this.tables.set(tableName, [])
    }
    const rows = this.tables.get(tableName)!
    for (const value of params.values) {
      rows.push({ ...value })
    }
    // eslint-disable-next-line no-console
    console.debug(
      `[InMemoryClickHouse] Inserted ${params.values.length} row(s) into ${tableName} (total: ${rows.length})`
    )
  }

  async query(params: {
    query: string
    query_params?: Record<string, unknown>
    format?: string
  }): Promise<{ json<T = unknown>(): Promise<T[]> }> {
    const queryStr = params.query.trim()
    const queryParams = params.query_params ?? {}

    // Extract table name from query
    const fromMatch = queryStr.match(/FROM\s+(?:workspace_platform\.)?(\w+)/i)
    const tableName = fromMatch?.[1] ?? ''
    const rows = this.tables.get(tableName) ?? []

    // Apply basic WHERE filters
    let filtered = [...rows]

    // Parse WHERE conditions — support {paramName:Type} placeholder syntax
    const whereMatch = queryStr.match(
      /WHERE\s+(.+?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|\s*$)/is
    )
    if (whereMatch) {
      const conditions = whereMatch[1]!
      // Split by AND
      const andClauses = conditions.split(/\s+AND\s+/i)

      for (const clause of andClauses) {
        const trimmed = clause.trim()

        // Match: column = {paramName:Type}
        const eqMatch = trimmed.match(/^(\w+)\s*=\s*\{(\w+):\w+\}$/i)
        if (eqMatch) {
          const col = eqMatch[1]!
          const paramName = eqMatch[2]!
          const paramValue = String(queryParams[paramName] ?? '')
          filtered = filtered.filter((row) => String(row[col] ?? '') === paramValue)
          continue
        }

        // Match: column != '' (not-equals empty string literal)
        const neqEmptyMatch = trimmed.match(/^(\w+)\s*!=\s*''$/i)
        if (neqEmptyMatch) {
          const col = neqEmptyMatch[1]!
          filtered = filtered.filter((row) => {
            const val = row[col]
            return val !== undefined && val !== null && String(val).trim().length > 0
          })
          continue
        }

        // Match: column != {paramName:Type} (not-equals param)
        const neqMatch = trimmed.match(/^(\w+)\s*!=\s*\{(\w+):\w+\}$/i)
        if (neqMatch) {
          const col = neqMatch[1]!
          const paramName = neqMatch[2]!
          const paramValue = String(queryParams[paramName] ?? '')
          filtered = filtered.filter((row) => String(row[col] ?? '') !== paramValue)
          continue
        }

        // Match: column >= {paramName:Type} or column >= now() - INTERVAL N SECOND/MINUTE
        const gteMatch = trimmed.match(/^(\w+)\s*>=\s*(.+)$/i)
        if (gteMatch) {
          const col = gteMatch[1]!
          const valueExpr = gteMatch[2]!.trim()

          if (
            valueExpr.match(/now\(\)\s*-\s*INTERVAL\s+(?:\{?\w+[\w:]*\}?|\d+)\s+(SECOND|MINUTE)/i)
          ) {
            // Extract interval amount — either literal number or {param:Type} placeholder
            const intervalMatch = valueExpr.match(
              /INTERVAL\s+(?:\{(\w+):\w+\}|(\d+))\s+(SECOND|MINUTE)/i
            )
            if (intervalMatch) {
              const amount = intervalMatch[1]
                ? Number(queryParams[intervalMatch[1]] ?? 0)
                : parseInt(intervalMatch[2]!, 10)
              const unit = intervalMatch[3]!.toUpperCase()
              const multiplier = unit === 'MINUTE' ? 60000 : 1000
              const cutoff = new Date(Date.now() - amount * multiplier)
              filtered = filtered.filter((row) => {
                const rowTime = parseTimestamp(row[col])
                return rowTime >= cutoff
              })
            }
          } else if (valueExpr.match(/^\{(\w+):\w+\}$/)) {
            const paramName = valueExpr.match(/^\{(\w+):\w+\}$/)![1]!
            const paramValue = String(queryParams[paramName] ?? '')
            filtered = filtered.filter((row) => {
              const rowTime = parseTimestamp(row[col])
              const compareTime = new Date(
                paramValue.replace(' ', 'T') + (paramValue.includes('Z') ? '' : 'Z')
              )
              return rowTime >= compareTime
            })
          }
          continue
        }

        // Match: column < {paramName:Type}
        const ltMatch = trimmed.match(/^(\w+)\s*<\s*\{(\w+):\w+\}$/i)
        if (ltMatch) {
          const col = ltMatch[1]!
          const paramName = ltMatch[2]!
          const paramValue = String(queryParams[paramName] ?? '')
          filtered = filtered.filter((row) => {
            const rowTime = parseTimestamp(row[col])
            const compareTime = new Date(
              paramValue.replace(' ', 'T') + (paramValue.includes('Z') ? '' : 'Z')
            )
            return rowTime < compareTime
          })
          continue
        }

        // Match: column < now() - INTERVAL N SECOND/MINUTE
        const ltNowMatch = trimmed.match(
          /^(\w+)\s*<\s*now\(\)\s*-\s*INTERVAL\s+(?:\{(\w+):\w+\}|(\d+))\s+(SECOND|MINUTE)/i
        )
        if (ltNowMatch) {
          const col = ltNowMatch[1]!
          const amount = ltNowMatch[2]
            ? Number(queryParams[ltNowMatch[2]] ?? 0)
            : parseInt(ltNowMatch[3]!, 10)
          const unit = ltNowMatch[4]!.toUpperCase()
          const multiplier = unit === 'MINUTE' ? 60000 : 1000
          const cutoff = new Date(Date.now() - amount * multiplier)
          filtered = filtered.filter((row) => {
            const rowTime = parseTimestamp(row[col])
            return rowTime < cutoff
          })
          continue
        }
      }
    }

    // Handle GROUP BY with aggregation BEFORE ORDER BY / LIMIT / OFFSET
    const groupByMatch = queryStr.match(/GROUP\s+BY\s+(\w+)/i)
    if (groupByMatch) {
      // Extract the bucket size from toStartOfInterval so we can round timestamps
      const intervalMatch = queryStr.match(
        /toStartOfInterval\s*\(\s*\w+\s*,\s*INTERVAL\s+(\d+)\s+SECOND\s*\)/i
      )
      const bucketSeconds = intervalMatch ? parseInt(intervalMatch[1]!, 10) : 0
      filtered = applyGroupBy(filtered, queryStr, groupByMatch[1]!, bucketSeconds)
    } else if (queryStr.match(/\bcount\(\)\s+as\s+(\w+)/i)) {
      // Handle count() without GROUP BY — return a single row with the count
      const countAlias = queryStr.match(/\bcount\(\)\s+as\s+(\w+)/i)![1]!
      filtered = [{ [countAlias]: String(filtered.length) }]
    }

    // Apply ORDER BY (after GROUP BY so it sorts aggregated results correctly)
    const orderMatch = queryStr.match(/ORDER\s+BY\s+(\w+)\s+(ASC|DESC)/i)
    if (orderMatch) {
      const col = orderMatch[1]!
      const direction = orderMatch[2]!.toUpperCase()
      filtered.sort((a, b) => {
        const va = String(a[col] ?? '')
        const vb = String(b[col] ?? '')
        const cmp = va.localeCompare(vb)
        return direction === 'DESC' ? -cmp : cmp
      })
    }

    // Apply LIMIT (after ORDER BY)
    const limitMatch = queryStr.match(/LIMIT\s+(?:\{(\w+):\w+\}|(\d+))/i)
    if (limitMatch) {
      const limit = limitMatch[1]
        ? Number(queryParams[limitMatch[1]] ?? 100)
        : Number(limitMatch[2])
      filtered = filtered.slice(0, limit)
    }

    // Apply OFFSET (after LIMIT)
    const offsetMatch = queryStr.match(/OFFSET\s+(?:\{(\w+):\w+\}|(\d+))/i)
    if (offsetMatch) {
      const offset = offsetMatch[1]
        ? Number(queryParams[offsetMatch[1]] ?? 0)
        : Number(offsetMatch[2])
      filtered = filtered.slice(offset)
    }

    // Handle SELECT * vs specific columns (return as-is for now)
    // eslint-disable-next-line no-console
    console.debug(`[InMemoryClickHouse] Query on ${tableName}: ${filtered.length} row(s) matched`)

    return {
      async json<T = unknown>(): Promise<T[]> {
        return filtered as T[]
      },
    }
  }

  async command(_params: { query: string }): Promise<void> {
    // DDL is a no-op for in-memory store
  }

  // For debug / inspection
  getTableData(tableName: string): Record<string, unknown>[] {
    return this.tables.get(tableName) ?? []
  }

  getAllTables(): string[] {
    return Array.from(this.tables.keys())
  }

  clearAllTables(): { tablesCleared: string[]; totalRowsCleared: number } {
    const tablesCleared: string[] = []
    let totalRowsCleared = 0
    for (const [name, rows] of this.tables) {
      tablesCleared.push(name)
      totalRowsCleared += rows.length
      rows.length = 0
    }
    console.info(
      `[InMemoryClickHouse] Cleared ${totalRowsCleared} rows across ${tablesCleared.length} tables`
    )
    return { tablesCleared, totalRowsCleared }
  }

  clearTable(tableName: string): number {
    const rows = this.tables.get(tableName)
    if (!rows) return 0
    const count = rows.length
    rows.length = 0
    console.info(`[InMemoryClickHouse] Cleared ${count} rows from ${tableName}`)
    return count
  }
}

function parseTimestamp(value: unknown): Date {
  if (value instanceof Date) return value
  const str = String(value ?? '')
  // Handle ClickHouse format "2025-01-01 12:00:00.000"
  if (str.includes(' ') && !str.includes('T')) {
    return new Date(str.replace(' ', 'T') + 'Z')
  }
  return new Date(str)
}

/**
 * Simple GROUP BY implementation for the summaries endpoint.
 * Handles the specific aggregation functions used in recording-sessions.ts.
 * bucketSeconds > 0 means the group key is a toStartOfInterval alias — compute
 * the bucket boundary from the row's timestamp column instead.
 */
function applyGroupBy(
  rows: Record<string, unknown>[],
  queryStr: string,
  groupCol: string,
  bucketSeconds = 0
): Record<string, unknown>[] {
  // Group rows by the group column (or by rounded timestamp bucket)
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    let key: string
    if (bucketSeconds > 0) {
      // toStartOfInterval: round the row's timestamp down to the nearest bucket
      const ts = parseTimestamp(row['timestamp'])
      const bucketMs = bucketSeconds * 1000
      const bucketStart = new Date(Math.floor(ts.getTime() / bucketMs) * bucketMs)
      // Store as ISO string so normalizeTimestamp passes it through unchanged
      key = bucketStart.toISOString()
    } else {
      key = String(row[groupCol] ?? 'unknown')
    }
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }

  // For each group, compute aggregations
  const results: Record<string, unknown>[] = []
  for (const [key, groupRows] of groups) {
    const result: Record<string, unknown> = { [groupCol]: key }

    // count()
    if (queryStr.includes('count()')) {
      result['event_count'] = groupRows.length
    }

    // avg(confidence)
    if (queryStr.includes('avg(confidence)')) {
      const sum = groupRows.reduce((acc, r) => acc + Number(r['confidence'] ?? 0), 0)
      result['avg_confidence'] = groupRows.length > 0 ? sum / groupRows.length : 0
    }

    // groupArray(user_action)
    if (queryStr.includes('groupArray(user_action)')) {
      result['user_actions'] = groupRows.map((r) => r['user_action'] ?? '')
    }

    // groupArray(user_intent)
    if (queryStr.includes('groupArray(user_intent)')) {
      result['user_intents'] = groupRows.map((r) => r['user_intent'] ?? '')
    }

    // groupArray(summary_text)
    if (queryStr.includes('groupArray(summary_text)')) {
      result['summaries'] = groupRows.map((r) => r['summary_text'] ?? '')
    }

    // groupUniqArray(arrayJoin(tags))
    if (queryStr.includes('groupUniqArray')) {
      const allTags = new Set<string>()
      for (const r of groupRows) {
        const tags = r['tags']
        if (Array.isArray(tags)) {
          tags.forEach((t) => allTags.add(String(t)))
        }
      }
      result['all_tags'] = Array.from(allTags)
    }

    // toStartOfInterval — key is already the ISO bucket boundary string
    if (queryStr.includes('toStartOfInterval')) {
      result['bucket_start'] = key // ISO string, normalizeTimestamp will pass it through
    }

    results.push(result)
  }

  return results
}

// ─── Client Creation with Fallback ──────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _clickhouse: any
let _fallbackActivated = false

// Try real ClickHouse first
try {
  const realClient = createClient({
    url: clickhouseUrl,
    database: 'workspace_platform',
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 0,
    },
  })
  _clickhouse = realClient
} catch {
  console.warn('[ClickHouse] Failed to create client — using in-memory fallback')
  _clickhouse = new InMemoryClickHouse()
  _fallbackActivated = true
}

/**
 * Test connectivity and switch to in-memory fallback if needed.
 * Called during server startup.
 */
async function ensureClickHouseConnection(): Promise<void> {
  if (_fallbackActivated) return

  try {
    // Ping with a short timeout
    await Promise.race([
      _clickhouse.query({ query: 'SELECT 1', format: 'JSONEachRow' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ])
    console.info('[ClickHouse] Connected to', clickhouseUrl)
  } catch {
    console.warn('[ClickHouse] Not available — switching to in-memory fallback')
    _clickhouse = new InMemoryClickHouse()
    _fallbackActivated = true
  }
}

// Export a proxy that always reads from the current _clickhouse reference
// (same pattern as Redis — allows runtime switch to fallback)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const clickhouse: any = new Proxy(
  {},
  {
    get(_target, prop) {
      return Reflect.get(_clickhouse, prop, _clickhouse)
    },
  }
)

export async function initClickHouseTables(): Promise<void> {
  // First, check if real ClickHouse is reachable
  await ensureClickHouseConnection()

  if (_fallbackActivated) {
    console.info('[ClickHouse] Using in-memory fallback — tables initialized (no-op)')
    return
  }

  // If we have real ClickHouse, create the tables
  try {
    await _clickhouse.command({
      query: `CREATE DATABASE IF NOT EXISTS workspace_platform`,
    })

    await _clickhouse.command({
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
        TTL toDateTime(timestamp) + INTERVAL 2 YEAR
      `,
    })

    await _clickhouse.command({
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
        TTL toDateTime(timestamp) + INTERVAL 90 DAY
      `,
    })

    await _clickhouse.command({
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
        TTL toDateTime(timestamp) + INTERVAL 90 DAY
      `,
    })

    // Migration: add summary_text column
    try {
      await _clickhouse.command({
        query: `ALTER TABLE workspace_platform.processed_intents ADD COLUMN IF NOT EXISTS summary_text String DEFAULT ''`,
      })
    } catch {
      // Column may already exist
    }

    // Thread signals table (raw signals with 7-day TTL)
    await _clickhouse.command({
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

    console.info('[ClickHouse] Tables initialized')
  } catch (err) {
    console.error('[ClickHouse] Table init failed, switching to fallback:', err)
    _clickhouse = new InMemoryClickHouse()
    _fallbackActivated = true
    console.info('[ClickHouse] Switched to in-memory fallback')
  }
}

/**
 * Check if we're using the in-memory fallback.
 */
export function isClickHouseFallback(): boolean {
  return _fallbackActivated
}

/**
 * Get the in-memory store for debugging (only works in fallback mode).
 */
export function getInMemoryClickHouse(): InMemoryClickHouse | null {
  return _fallbackActivated ? (_clickhouse as InMemoryClickHouse) : null
}
