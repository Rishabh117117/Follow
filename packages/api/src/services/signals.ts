import { clickhouse } from '../db/clickhouse'

/**
 * Insert signals directly into the ClickHouse thread_signals table.
 * Used by internal services (chat completion, GWS snapshot ingestion)
 * that need to emit signals without going through an HTTP endpoint.
 */
export async function insertSignals(
  signals: Array<{
    sessionId: string
    threadId?: string
    workspaceId: string
    userId: string
    signalType: string
    timestamp?: Date
    url?: string
    domain?: string
    title?: string
    metadata?: Record<string, unknown>
  }>
): Promise<void> {
  if (signals.length === 0) return

  try {
    await clickhouse.insert({
      table: 'thread_signals',
      values: signals.map((s) => ({
        id: crypto.randomUUID(),
        session_id: s.sessionId,
        thread_id: s.threadId || '',
        workspace_id: s.workspaceId,
        user_id: s.userId,
        signal_type: s.signalType,
        timestamp: (s.timestamp || new Date()).toISOString().replace('T', ' ').replace('Z', ''),
        url: s.url || '',
        domain: s.domain || '',
        title: s.title || '',
        metadata: JSON.stringify(s.metadata || {}),
        processed: 0,
      })),
      format: 'JSONEachRow',
    })
  } catch (chErr) {
    console.warn('[Signals] ClickHouse signal insert failed (non-fatal):', (chErr as Error).message)
  }
}
