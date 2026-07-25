/**
 * TriggerMonitor — Watches workspace events and detects opportunities
 * for proactive prompting.
 *
 * Trigger types:
 *  - stuck_detection: User idle or looping on same page for too long
 *  - context_switch: User jumped to very different area of workspace
 *  - new_member: New member joined the workspace
 *  - periodic_insight: Scheduled periodic analysis (end-of-day, etc.)
 *  - dormant_content: Content that hasn't been touched for a while
 *  - completion_detected: User finished a milestone or project
 */

// ─── Types ──────────────────────────────────────────────────────────

export type TriggerKind =
  | 'stuck_detection'
  | 'context_switch'
  | 'new_member'
  | 'periodic_insight'
  | 'dormant_content'
  | 'completion_detected'

export interface TriggerEvent {
  kind: TriggerKind
  workspaceId: string
  userId: string
  confidence: number // 0-1
  data: Record<string, unknown>
  timestamp: Date
}

interface ActivityWindow {
  userId: string
  workspaceId: string
  currentPage: string | null
  lastActivity: Date
  pageVisits: Array<{ page: string; at: Date }>
  idleStarted: Date | null
  actionCount: number
}

// ─── In-memory state ────────────────────────────────────────────────

const activityWindows = new Map<string, ActivityWindow>()
const recentTriggers = new Map<string, TriggerEvent[]>()
const listeners: Array<(event: TriggerEvent) => void> = []

// ─── Constants ──────────────────────────────────────────────────────

const STUCK_IDLE_THRESHOLD_MS = 5 * 60 * 1000 // 5 min idle on same page
const STUCK_LOOP_THRESHOLD = 5 // Same 2-3 pages visited this many times
const CONTEXT_SWITCH_THRESHOLD = 3 // Different object types in quick succession
const TRIGGER_COOLDOWN_MS = 15 * 60 * 1000 // Don't re-fire same trigger type within 15 min
const MAX_RECENT_TRIGGERS = 20

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Register a listener for trigger events.
 * Returns an unsubscribe function.
 */
export function onTrigger(fn: (event: TriggerEvent) => void): () => void {
  listeners.push(fn)
  return () => {
    const idx = listeners.indexOf(fn)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

/**
 * Ingest a user activity event. Called from EventBus or timeline middleware.
 */
export function ingestActivity(params: {
  userId: string
  workspaceId: string
  action: string
  objectType?: string
  objectId?: string
  page?: string
}): void {
  const key = `${params.workspaceId}:${params.userId}`
  const now = new Date()

  let window = activityWindows.get(key)
  if (!window) {
    window = {
      userId: params.userId,
      workspaceId: params.workspaceId,
      currentPage: null,
      lastActivity: now,
      pageVisits: [],
      idleStarted: null,
      actionCount: 0,
    }
    activityWindows.set(key, window)
  }

  // Update activity
  window.lastActivity = now
  window.idleStarted = null
  window.actionCount++

  // Track page visits for stuck detection
  if (params.page) {
    if (window.currentPage !== params.page) {
      window.pageVisits.push({ page: params.page, at: now })
      // Keep last 20 visits
      if (window.pageVisits.length > 20) {
        window.pageVisits = window.pageVisits.slice(-20)
      }
      window.currentPage = params.page
    }

    // Check for context switch
    checkContextSwitch(window, params.objectType)
  }

  // Check for page loop (stuck detection)
  checkStuckLoop(window)
}

/**
 * Called periodically (e.g., every 60s) to check for idle users.
 */
export function checkIdleUsers(): void {
  const now = Date.now()

  for (const [, window] of activityWindows) {
    const idleMs = now - window.lastActivity.getTime()

    if (idleMs >= STUCK_IDLE_THRESHOLD_MS && window.currentPage) {
      // Only fire if we haven't already started tracking idle
      if (!window.idleStarted) {
        window.idleStarted = new Date()
        fireTrigger({
          kind: 'stuck_detection',
          workspaceId: window.workspaceId,
          userId: window.userId,
          confidence: Math.min(0.9, 0.5 + (idleMs / (10 * 60 * 1000)) * 0.4),
          data: {
            currentPage: window.currentPage,
            idleSeconds: Math.round(idleMs / 1000),
            actionCount: window.actionCount,
          },
          timestamp: new Date(),
        })
      }
    }
  }
}

/**
 * Fire a new member trigger when a member is added to a workspace.
 */
export function fireNewMemberTrigger(
  workspaceId: string,
  userId: string,
  memberName: string
): void {
  fireTrigger({
    kind: 'new_member',
    workspaceId,
    userId,
    confidence: 1.0,
    data: { memberName },
    timestamp: new Date(),
  })
}

/**
 * Fire a periodic insight trigger (e.g., end of day summary).
 */
export function firePeriodicInsight(
  workspaceId: string,
  userId: string,
  insightData: Record<string, unknown>
): void {
  fireTrigger({
    kind: 'periodic_insight',
    workspaceId,
    userId,
    confidence: 0.8,
    data: insightData,
    timestamp: new Date(),
  })
}

/**
 * Fire a dormant content trigger for files/docs not touched recently.
 */
export function fireDormantContent(
  workspaceId: string,
  userId: string,
  contentItems: Array<{ id: string; name: string; lastModified: Date }>
): void {
  fireTrigger({
    kind: 'dormant_content',
    workspaceId,
    userId,
    confidence: 0.6,
    data: { items: contentItems },
    timestamp: new Date(),
  })
}

/**
 * Fire a completion detected trigger.
 */
export function fireCompletionDetected(
  workspaceId: string,
  userId: string,
  completionData: { objectType: string; objectName: string }
): void {
  fireTrigger({
    kind: 'completion_detected',
    workspaceId,
    userId,
    confidence: 0.7,
    data: completionData,
    timestamp: new Date(),
  })
}

/**
 * Get recent triggers for a user (for debugging / display).
 */
export function getRecentTriggers(workspaceId: string, userId: string): TriggerEvent[] {
  return recentTriggers.get(`${workspaceId}:${userId}`) ?? []
}

/**
 * Clear state for a user (e.g., on disconnect).
 */
export function clearUserState(workspaceId: string, userId: string): void {
  const key = `${workspaceId}:${userId}`
  activityWindows.delete(key)
  recentTriggers.delete(key)
}

// ─── Internal ───────────────────────────────────────────────────────

function checkStuckLoop(window: ActivityWindow): void {
  if (window.pageVisits.length < STUCK_LOOP_THRESHOLD) return

  // Check if the last N visits are oscillating between 2-3 pages
  const recentPages = window.pageVisits.slice(-STUCK_LOOP_THRESHOLD).map((v) => v.page)
  const uniquePages = new Set(recentPages)

  if (uniquePages.size <= 2 && recentPages.length >= STUCK_LOOP_THRESHOLD) {
    fireTrigger({
      kind: 'stuck_detection',
      workspaceId: window.workspaceId,
      userId: window.userId,
      confidence: 0.7,
      data: {
        loopingPages: Array.from(uniquePages),
        visitCount: recentPages.length,
      },
      timestamp: new Date(),
    })
  }
}

function checkContextSwitch(window: ActivityWindow, objectType?: string): void {
  if (!objectType) return
  if (window.pageVisits.length < CONTEXT_SWITCH_THRESHOLD) return

  // Look at recent visits — if object types differ significantly, it's a context switch
  const recentVisits = window.pageVisits.slice(-CONTEXT_SWITCH_THRESHOLD)
  const types = recentVisits
    .map((v) => {
      // Extract type from page path (e.g., /workspace/x/files → file, /workspace/x/canvas/y → canvas)
      const parts = v.page.split('/')
      return parts[3] ?? 'unknown' // After /workspace/:id/
    })
    .filter(Boolean)

  const uniqueTypes = new Set(types)
  if (uniqueTypes.size >= CONTEXT_SWITCH_THRESHOLD) {
    fireTrigger({
      kind: 'context_switch',
      workspaceId: window.workspaceId,
      userId: window.userId,
      confidence: 0.5,
      data: {
        recentContexts: Array.from(uniqueTypes),
        currentObjectType: objectType,
      },
      timestamp: new Date(),
    })
  }
}

function fireTrigger(event: TriggerEvent): void {
  const key = `${event.workspaceId}:${event.userId}`

  // Check cooldown — don't re-fire same trigger type too quickly
  const existing = recentTriggers.get(key) ?? []
  const lastSameKind = [...existing].reverse().find((e: TriggerEvent) => e.kind === event.kind)
  if (lastSameKind) {
    const elapsed = event.timestamp.getTime() - lastSameKind.timestamp.getTime()
    if (elapsed < TRIGGER_COOLDOWN_MS) return // Skip — too soon
  }

  // Store
  existing.push(event)
  if (existing.length > MAX_RECENT_TRIGGERS) {
    existing.splice(0, existing.length - MAX_RECENT_TRIGGERS)
  }
  recentTriggers.set(key, existing)

  // Notify listeners
  for (const fn of listeners) {
    try {
      fn(event)
    } catch (err) {
      console.error('[TriggerMonitor] Listener error:', err)
    }
  }
}
