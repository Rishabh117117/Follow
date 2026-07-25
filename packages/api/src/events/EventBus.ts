import { db } from '../db/index'
import { timelineEvents } from '../db/schema/index'
import { broadcast } from '../ws/index'

export interface TimelineEventInput {
  workspaceId: string
  userId: string
  actionType: string
  objectType: string
  objectId: string
  objectName?: string
  parentObjectId?: string | null
  payload?: Record<string, unknown>
  sessionId?: string
  agentRunId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  durationMs?: number | null
  metadata?: Record<string, unknown>
}

type EventListener = (event: TimelineEventInput) => void | Promise<void>

const BATCH_SIZE = 50
const FLUSH_INTERVAL_MS = 500

class EventBusClass {
  private batch: TimelineEventInput[] = []
  private listeners: EventListener[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private sessionMap = new Map<string, { sessionId: string; lastActivity: number }>()
  private readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

  start(): void {
    if (this.flushTimer) return
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    this.flush()
  }

  on(listener: EventListener): void {
    this.listeners.push(listener)
  }

  off(listener: EventListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener)
  }

  async emit(event: TimelineEventInput): Promise<void> {
    const enriched = this.enrich(event)
    this.batch.push(enriched)

    // Notify listeners synchronously (for WebSocket broadcast etc.)
    for (const listener of this.listeners) {
      try {
        listener(enriched)
      } catch (err) {
        console.error('[EventBus] Listener error:', err)
      }
    }

    // Broadcast to WebSocket timeline channel
    broadcast(`timeline:${enriched.workspaceId}`, {
      type: 'timeline_event',
      room: `timeline:${enriched.workspaceId}`,
      payload: {
        actionType: enriched.actionType,
        objectType: enriched.objectType,
        objectId: enriched.objectId,
        objectName: enriched.objectName,
        userId: enriched.userId,
        timestamp: new Date().toISOString(),
        payload: enriched.payload,
      },
    })

    if (this.batch.length >= BATCH_SIZE) {
      await this.flush()
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return
    const events = this.batch.splice(0)

    // Write to PostgreSQL
    this.writeToPostgres(events).catch((err) => {
      console.error('[EventBus] PostgreSQL write failed:', err)
    })
  }

  private enrich(event: TimelineEventInput): TimelineEventInput {
    // Session management
    const userKey = `${event.workspaceId}:${event.userId}`
    const now = Date.now()
    let session = this.sessionMap.get(userKey)

    if (!session || now - session.lastActivity > this.SESSION_TIMEOUT_MS) {
      session = { sessionId: crypto.randomUUID(), lastActivity: now }
      this.sessionMap.set(userKey, session)
    } else {
      session.lastActivity = now
    }

    return {
      ...event,
      sessionId: event.sessionId ?? session.sessionId,
      objectName: event.objectName ?? '',
      payload: event.payload ?? {},
      metadata: event.metadata ?? {},
    }
  }

  private async writeToPostgres(events: TimelineEventInput[]): Promise<void> {
    const values = events.map((e) => ({
      workspaceId: e.workspaceId,
      userId: e.userId,
      actionType: e.actionType,
      objectType: e.objectType,
      objectId: e.objectId,
      payload: e.payload ?? {},
      sessionId: e.sessionId ?? null,
      agentRunId: e.agentRunId ?? null,
    }))

    await db.insert(timelineEvents).values(values)
  }
}

export const EventBus = new EventBusClass()
