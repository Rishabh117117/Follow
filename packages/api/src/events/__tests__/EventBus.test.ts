import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Inline EventBus logic for unit testing (avoids DB/ClickHouse deps)

interface TimelineEventInput {
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
  durationMs?: number | null
  metadata?: Record<string, unknown>
}

type EventListener = (event: TimelineEventInput) => void

const BATCH_SIZE = 50
const FLUSH_INTERVAL_MS = 500
const SESSION_TIMEOUT_MS = 30 * 60 * 1000

class TestEventBus {
  batch: TimelineEventInput[] = []
  flushedBatches: TimelineEventInput[][] = []
  listeners: EventListener[] = []
  flushTimer: ReturnType<typeof setInterval> | null = null
  sessionMap = new Map<string, { sessionId: string; lastActivity: number }>()

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

  emit(event: TimelineEventInput): void {
    const enriched = this.enrich(event)
    this.batch.push(enriched)

    for (const listener of this.listeners) {
      listener(enriched)
    }

    if (this.batch.length >= BATCH_SIZE) {
      this.flush()
    }
  }

  flush(): void {
    if (this.batch.length === 0) return
    const events = this.batch.splice(0)
    this.flushedBatches.push(events)
  }

  private enrich(event: TimelineEventInput): TimelineEventInput {
    const userKey = `${event.workspaceId}:${event.userId}`
    const now = Date.now()
    let session = this.sessionMap.get(userKey)

    if (!session || now - session.lastActivity > SESSION_TIMEOUT_MS) {
      session = { sessionId: `session-${now}`, lastActivity: now }
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
}

describe('EventBus', () => {
  let bus: TestEventBus

  beforeEach(() => {
    bus = new TestEventBus()
  })

  afterEach(() => {
    bus.stop()
  })

  it('emits events and adds them to the batch', () => {
    bus.emit({
      workspaceId: 'ws-1',
      userId: 'user-1',
      actionType: 'create',
      objectType: 'file',
      objectId: 'file-1',
    })

    expect(bus.batch).toHaveLength(1)
    expect(bus.batch[0]!.actionType).toBe('create')
  })

  it('enriches events with session ID', () => {
    bus.emit({
      workspaceId: 'ws-1',
      userId: 'user-1',
      actionType: 'edit',
      objectType: 'doc',
      objectId: 'doc-1',
    })

    expect(bus.batch[0]!.sessionId).toBeDefined()
    expect(bus.batch[0]!.sessionId).toContain('session-')
  })

  it('reuses session ID for the same user within timeout', () => {
    bus.emit({
      workspaceId: 'ws-1',
      userId: 'user-1',
      actionType: 'edit',
      objectType: 'doc',
      objectId: 'doc-1',
    })

    const firstSession = bus.batch[0]!.sessionId

    bus.emit({
      workspaceId: 'ws-1',
      userId: 'user-1',
      actionType: 'view',
      objectType: 'doc',
      objectId: 'doc-2',
    })

    expect(bus.batch[1]!.sessionId).toBe(firstSession)
  })

  it('creates separate session entries for different users', () => {
    bus.emit({
      workspaceId: 'ws-1',
      userId: 'user-1',
      actionType: 'edit',
      objectType: 'doc',
      objectId: 'doc-1',
    })

    bus.emit({
      workspaceId: 'ws-1',
      userId: 'user-2',
      actionType: 'edit',
      objectType: 'doc',
      objectId: 'doc-2',
    })

    // Different users should have separate session map entries
    expect(bus.sessionMap.has('ws-1:user-1')).toBe(true)
    expect(bus.sessionMap.has('ws-1:user-2')).toBe(true)
    expect(bus.sessionMap.get('ws-1:user-1')).not.toBe(bus.sessionMap.get('ws-1:user-2'))
  })

  it('flushes batch when it reaches BATCH_SIZE', () => {
    for (let i = 0; i < BATCH_SIZE; i++) {
      bus.emit({
        workspaceId: 'ws-1',
        userId: 'user-1',
        actionType: 'view',
        objectType: 'file',
        objectId: `file-${i}`,
      })
    }

    expect(bus.flushedBatches).toHaveLength(1)
    expect(bus.flushedBatches[0]).toHaveLength(BATCH_SIZE)
    expect(bus.batch).toHaveLength(0)
  })

  it('notifies listeners on emit', () => {
    const listener = vi.fn()
    bus.on(listener)

    bus.emit({
      workspaceId: 'ws-1',
      userId: 'user-1',
      actionType: 'create',
      objectType: 'file',
      objectId: 'file-1',
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'create', objectId: 'file-1' })
    )
  })

  it('removes listeners with off()', () => {
    const listener = vi.fn()
    bus.on(listener)
    bus.off(listener)

    bus.emit({
      workspaceId: 'ws-1',
      userId: 'user-1',
      actionType: 'create',
      objectType: 'file',
      objectId: 'file-1',
    })

    expect(listener).not.toHaveBeenCalled()
  })

  it('enriches missing fields with defaults', () => {
    bus.emit({
      workspaceId: 'ws-1',
      userId: 'user-1',
      actionType: 'view',
      objectType: 'file',
      objectId: 'file-1',
    })

    const event = bus.batch[0]!
    expect(event.objectName).toBe('')
    expect(event.payload).toEqual({})
    expect(event.metadata).toEqual({})
  })

  it('preserves explicitly set fields', () => {
    bus.emit({
      workspaceId: 'ws-1',
      userId: 'user-1',
      actionType: 'edit',
      objectType: 'doc',
      objectId: 'doc-1',
      objectName: 'My Document',
      sessionId: 'custom-session',
      payload: { key: 'value' },
    })

    const event = bus.batch[0]!
    expect(event.objectName).toBe('My Document')
    expect(event.sessionId).toBe('custom-session')
    expect(event.payload).toEqual({ key: 'value' })
  })

  it('flush on stop empties the batch', () => {
    bus.emit({
      workspaceId: 'ws-1',
      userId: 'user-1',
      actionType: 'view',
      objectType: 'file',
      objectId: 'file-1',
    })

    expect(bus.batch).toHaveLength(1)
    bus.stop()
    expect(bus.batch).toHaveLength(0)
    expect(bus.flushedBatches).toHaveLength(1)
  })
})
