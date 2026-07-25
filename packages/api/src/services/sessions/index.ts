/**
 * Sessions service (2026-04-29)
 *
 * Unified open/heartbeat/close lifecycle for MCP + webapp sessions, plus a
 * typed event emitter and an idle reaper. Subscribed to by the indexing
 * queue (services/indexing/index-queue.ts) which enqueues Archivist +
 * Profiler jobs on session.started / session.ended.
 *
 * See db/schema/sessions.ts for the table, and config/model-tier-prompts.ts
 * → PIPELINE_ROLES for the role-level architecture this powers.
 */

import { EventEmitter } from 'events'
import { and, eq, isNull, lt } from 'drizzle-orm'
import { db } from '../../db/index'
import { sessions, type Session } from '../../db/schema/sessions'

/** 20 minutes — confirmed in the planning step. */
const IDLE_TIMEOUT_MS = 20 * 60 * 1000
const REAPER_TICK_MS = 60 * 1000

// ─── Event types ───────────────────────────────────────────────────────────

export interface SessionStartedEvent {
  sessionId: string
  userId: string
  workspaceId: string
  surface: 'mcp' | 'webapp'
  scopeSnapshot: Session['scopeSnapshot']
  startedAt: Date
}

export interface SessionEndedEvent {
  sessionId: string
  userId: string
  workspaceId: string
  surface: 'mcp' | 'webapp'
  endReason: 'explicit' | 'disconnect' | 'idle_timeout' | 'replaced'
  startedAt: Date
  endedAt: Date
  durationMs: number
}

interface SessionEventMap {
  'session.started': SessionStartedEvent
  'session.ended': SessionEndedEvent
}

class TypedSessionEmitter extends EventEmitter {
  override emit<K extends keyof SessionEventMap>(
    event: K,
    payload: SessionEventMap[K]
  ): boolean {
    return super.emit(event, payload)
  }
  override on<K extends keyof SessionEventMap>(
    event: K,
    listener: (payload: SessionEventMap[K]) => void
  ): this {
    return super.on(event, listener)
  }
}

export const sessionEvents = new TypedSessionEmitter()

// ─── Open ──────────────────────────────────────────────────────────────────

export interface OpenSessionInput {
  userId: string
  workspaceId: string
  surface: 'mcp' | 'webapp'
  /** SSE connection id (MCP) or browser tab uuid (webapp). Optional but
   * recommended — lets us detect refresh/reconnect and end the prior session
   * with reason='replaced' instead of stranding it. */
  surfaceClientId?: string
  scopeSnapshot?: Session['scopeSnapshot']
}

export async function openSession(input: OpenSessionInput): Promise<Session> {
  // Reconnect cleanup: if this surfaceClientId already has an open session,
  // close it first as 'replaced'. Without this, tab refresh creates ghost
  // sessions that only the reaper would clean up 20 minutes later.
  if (input.surfaceClientId) {
    const [existing] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, input.userId),
          eq(sessions.surfaceClientId, input.surfaceClientId),
          isNull(sessions.endedAt)
        )
      )
      .limit(1)
    if (existing) await closeSession(existing.id, 'replaced')
  }

  const [created] = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      workspaceId: input.workspaceId,
      surface: input.surface,
      surfaceClientId: input.surfaceClientId ?? null,
      scopeSnapshot: input.scopeSnapshot ?? null,
    })
    .returning()

  if (!created) throw new Error('openSession: insert returned no row')

  sessionEvents.emit('session.started', {
    sessionId: created.id,
    userId: created.userId,
    workspaceId: created.workspaceId,
    surface: created.surface as 'mcp' | 'webapp',
    scopeSnapshot: created.scopeSnapshot,
    startedAt: created.startedAt,
  })

  return created
}

// ─── Heartbeat ─────────────────────────────────────────────────────────────

export async function heartbeat(sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ lastHeartbeatAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.endedAt)))
}

/** Convenience for MCP: heartbeat by surfaceClientId (the SSE connection id)
 *  without needing the session row id at the call site. Returns the session
 *  id if one was found, null otherwise. */
export async function heartbeatBySurface(
  userId: string,
  surfaceClientId: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.surfaceClientId, surfaceClientId),
        isNull(sessions.endedAt)
      )
    )
    .limit(1)
  if (!row) return null
  await heartbeat(row.id)
  return row.id
}

// ─── Close ─────────────────────────────────────────────────────────────────

export async function closeSession(
  sessionId: string,
  reason: SessionEndedEvent['endReason']
): Promise<void> {
  const now = new Date()
  const [closed] = await db
    .update(sessions)
    .set({ endedAt: now, endReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.endedAt)))
    .returning()
  if (!closed) return // already closed; idempotent

  sessionEvents.emit('session.ended', {
    sessionId: closed.id,
    userId: closed.userId,
    workspaceId: closed.workspaceId,
    surface: closed.surface as 'mcp' | 'webapp',
    endReason: reason,
    startedAt: closed.startedAt,
    endedAt: now,
    durationMs: now.getTime() - closed.startedAt.getTime(),
  })
}

// ─── Idle reaper ───────────────────────────────────────────────────────────
// Runs every minute; closes sessions whose lastHeartbeatAt < now - 20min.

let reaperHandle: NodeJS.Timeout | null = null

export function startIdleReaper(): NodeJS.Timeout {
  if (reaperHandle) return reaperHandle
  reaperHandle = setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - IDLE_TIMEOUT_MS)
      const stale = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(isNull(sessions.endedAt), lt(sessions.lastHeartbeatAt, cutoff)))
      for (const s of stale) await closeSession(s.id, 'idle_timeout')
    } catch (err) {
      // Non-fatal — log and try again next tick
      console.error('[sessions] idle reaper error:', err)
    }
  }, REAPER_TICK_MS)
  return reaperHandle
}

export function stopIdleReaper(): void {
  if (reaperHandle) {
    clearInterval(reaperHandle)
    reaperHandle = null
  }
}
