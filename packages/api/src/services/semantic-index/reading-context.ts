/**
 * Reading Context Query (Sprint IX-3)
 *
 * Queries ClickHouse heartbeats to determine what the user was viewing
 * at the time of an event. Feeds into composite embedding text templates.
 */

import { clickhouse } from '../../db/clickhouse'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReadingContext {
  sectionBeingViewed: string | null
  viewDurationSeconds: number
  cursorPosition: string | null
  collaboratorsPresent: string[]
}

interface HeartbeatRow {
  cursor_context: string
  active_document_id: string
  is_idle: number
  user_id: string
  timestamp: string
}

const DEFAULT_CONTEXT: ReadingContext = {
  sectionBeingViewed: null,
  viewDurationSeconds: 0,
  cursorPosition: null,
  collaboratorsPresent: [],
}

// ─── Main Query ──────────────────────────────────────────────────────────────

/**
 * Get the reading context for a user at a specific timestamp.
 * Queries the 60 seconds of heartbeats preceding the event.
 */
export async function getReadingContext(
  workspaceId: string,
  userId: string,
  documentId: string | null,
  eventTimestamp: string
): Promise<ReadingContext> {
  try {
    const fromTime = new Date(new Date(eventTimestamp).getTime() - 60_000).toISOString()
    const toTime = eventTimestamp

    const docFilter = documentId
      ? `AND active_document_id = {documentId:String}`
      : ''

    const query = `
      SELECT
        cursor_context,
        active_document_id,
        is_idle,
        user_id,
        timestamp
      FROM timeline_heartbeats
      WHERE workspace_id = {workspaceId:String}
        AND timestamp >= toDateTime64({fromTime:String}, 3)
        AND timestamp <= toDateTime64({toTime:String}, 3)
        ${docFilter}
      ORDER BY timestamp DESC
      LIMIT 120
    `

    const params: Record<string, string> = { workspaceId, fromTime, toTime }
    if (documentId) params['documentId'] = documentId

    const result = await clickhouse.query({
      query,
      query_params: params,
      format: 'JSONEachRow',
    })

    const rows = (await result.json()) as HeartbeatRow[]

    if (rows.length === 0) return { ...DEFAULT_CONTEXT }

    // Split by user
    const userRows = rows.filter((r: HeartbeatRow) => r.user_id === userId && r.is_idle === 0)
    const otherUserRows = rows.filter((r: HeartbeatRow) => r.user_id !== userId && r.is_idle === 0)

    // Extract section from most recent cursor context
    let sectionBeingViewed: string | null = null
    let cursorPosition: string | null = null

    const latestCursor = userRows[0]?.cursor_context
    if (latestCursor) {
      try {
        const parsed = JSON.parse(latestCursor)
        sectionBeingViewed =
          parsed.sectionTitle ?? parsed.heading ?? parsed.section ?? null
        cursorPosition =
          parsed.paragraphIndex?.toString() ?? parsed.position ?? null
      } catch {
        // cursor_context might be a plain string
        if (latestCursor.length > 0 && latestCursor.length < 200) {
          sectionBeingViewed = latestCursor
        }
      }
    }

    return {
      sectionBeingViewed,
      viewDurationSeconds: userRows.length, // ~1 heartbeat per second
      cursorPosition,
      collaboratorsPresent: [...new Set(otherUserRows.map((r: HeartbeatRow) => r.user_id))] as string[],
    }
  } catch (err) {
    // ClickHouse may be unavailable (dev mode, in-memory fallback)
    console.warn('[ReadingContext] Heartbeat query failed:', (err as Error).message)
    return { ...DEFAULT_CONTEXT }
  }
}
