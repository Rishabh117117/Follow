/**
 * Signal Pipeline — unified signal emitter, queue, and flusher.
 *
 * Replaces signal-emitter.ts + offline-queue.ts + WA background.js buffer.
 * Routes GWS signals to /api/gws/documents/:id/signals,
 * web signals to /api/capture/realtime.
 * Bounded offline queue (1000 signals, FIFO eviction) persisted to chrome.storage.
 */

import { SIGNAL_BATCH_INTERVAL, MAX_BATCH_SIZE, MAX_QUEUE_SIZE } from '@/lib/constants'

export interface Signal {
  signalType: string
  payload: Record<string, unknown>
  timestamp: string
  /** If set, routes to GWS endpoint. Otherwise routes to web capture. */
  googleDocId?: string
  docType?: 'docs' | 'sheets' | 'slides'
}

const OFFLINE_QUEUE_KEY = 'follow_offline_signal_queue'

class SignalPipeline {
  private queue: Signal[] = []
  private offlineRetryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private boundHandleOnline = () => this.handleOnline()
  private boundHandleOffline = () => this.handleOffline()
  private isOnline = true

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.boundHandleOnline)
      window.addEventListener('offline', this.boundHandleOffline)
    }
  }

  /**
   * Queue a signal for batched delivery.
   */
  emit(signalType: string, payload: Record<string, unknown> = {}, googleDocId?: string, docType?: Signal['docType']): void {
    this.queue.push({
      signalType,
      payload,
      timestamp: new Date().toISOString(),
      googleDocId,
      docType,
    })

    // Enforce max queue size — evict oldest
    while (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue.shift()
    }

    // Immediate flush if batch is full
    if (this.queue.length >= MAX_BATCH_SIZE) {
      this.flush()
    }
  }

  /**
   * Flush all queued signals to the backend via the service worker.
   * Called by the coordinator every SIGNAL_BATCH_INTERVAL.
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return

    // Partition signals by route
    const gwsBatches = new Map<string, Signal[]>()
    const webSignals: Signal[] = []

    for (const signal of this.queue) {
      if (signal.googleDocId) {
        const existing = gwsBatches.get(signal.googleDocId) || []
        existing.push(signal)
        gwsBatches.set(signal.googleDocId, existing)
      } else {
        webSignals.push(signal)
      }
    }

    // Clear queue optimistically
    const pending = [...this.queue]
    this.queue = []

    let anyFailed = false

    // Flush GWS signals
    for (const [docId, signals] of gwsBatches) {
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'SIGNAL_BATCH_GWS',
          payload: { externalDocId: docId, signals },
        })
        if (!result?.success) anyFailed = true
      } catch {
        anyFailed = true
      }
    }

    // Flush web signals
    if (webSignals.length > 0) {
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'SIGNAL_BATCH_WEB',
          payload: { signals: webSignals },
        })
        if (!result?.success) anyFailed = true
      } catch {
        anyFailed = true
      }
    }

    // On failure: persist to offline queue
    if (anyFailed) {
      await this.persistToOfflineQueue(pending)
      this.updateBadge('offline')
      this.scheduleRetry()
    } else {
      this.offlineRetryCount = 0
      this.isOnline = true
    }
  }

  /**
   * Synchronous flush for page unload — uses fetch with keepalive.
   * keepalive allows the request to outlive the page, unlike sendBeacon
   * it supports custom headers for auth.
   */
  flushSync(apiBaseUrl: string, authToken?: string, userId?: string, workspaceId?: string): void {
    if (this.queue.length === 0) return

    // Group GWS signals by doc ID
    const gwsBatches = new Map<string, Signal[]>()
    const webSignals: Signal[] = []

    for (const signal of this.queue) {
      if (signal.googleDocId) {
        const existing = gwsBatches.get(signal.googleDocId) || []
        existing.push(signal)
        gwsBatches.set(signal.googleDocId, existing)
      } else {
        webSignals.push(signal)
      }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`
    if (userId) headers['x-user-id'] = userId
    if (workspaceId) headers['x-workspace-id'] = workspaceId

    for (const [docId, signals] of gwsBatches) {
      try {
        fetch(`${apiBaseUrl}/api/gws/documents/${docId}/signals`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ signals }),
          keepalive: true,
        }).catch(() => {})
      } catch {
        // Best effort
      }
    }

    if (webSignals.length > 0) {
      try {
        fetch(`${apiBaseUrl}/api/capture/realtime`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ signals: webSignals }),
          keepalive: true,
        }).catch(() => {})
      } catch {
        // Best effort
      }
    }

    this.queue = []
  }

  /**
   * Get current queue length (for badge display).
   */
  getQueueLength(): number {
    return this.queue.length
  }

  /**
   * Attempt to flush the offline queue (stored in chrome.storage).
   */
  async flushOfflineQueue(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(OFFLINE_QUEUE_KEY)
      const offlineSignals = (stored[OFFLINE_QUEUE_KEY] as Signal[]) || []
      if (offlineSignals.length === 0) {
        this.updateBadge('clear')
        return
      }

      // Re-queue and flush
      this.queue.unshift(...offlineSignals)
      await chrome.storage.local.remove(OFFLINE_QUEUE_KEY)
      await this.flush()
    } catch (err) {
      console.warn('[SignalPipeline] Failed to flush offline queue:', err)
    }
  }

  private async persistToOfflineQueue(signals: Signal[]): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(OFFLINE_QUEUE_KEY)
      const existing = (stored[OFFLINE_QUEUE_KEY] as Signal[]) || []
      const combined = [...existing, ...signals]

      // Enforce max size
      const trimmed = combined.length > MAX_QUEUE_SIZE
        ? combined.slice(combined.length - MAX_QUEUE_SIZE)
        : combined

      await chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: trimmed })
    } catch (err) {
      console.warn('[SignalPipeline] Failed to persist offline queue:', err)
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    const delays = [5000, 10000, 30000, 60000, 300000]
    const delay = delays[Math.min(this.offlineRetryCount, delays.length - 1)]!
    this.offlineRetryCount++
    this.retryTimer = setTimeout(() => this.flushOfflineQueue(), delay)
  }

  private handleOnline(): void {
    this.isOnline = true
    this.offlineRetryCount = 0
    this.flushOfflineQueue()
  }

  private handleOffline(): void {
    this.isOnline = false
    this.updateBadge('offline')
  }

  private updateBadge(state: 'offline' | 'clear'): void {
    try {
      chrome.runtime.sendMessage({
        type: 'BADGE_UPDATE',
        payload: state === 'offline'
          ? { text: '\u25CF', color: '#F59E0B' }
          : { text: '', color: '#16A34A' },
      })
    } catch {
      // Service worker may be asleep
    }
  }

  destroy(apiBaseUrl?: string, authToken?: string, userId?: string, workspaceId?: string): void {
    // Flush remaining signals synchronously on teardown (e.g. page unload)
    if (apiBaseUrl) {
      this.flushSync(apiBaseUrl, authToken, userId, workspaceId)
    }
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.boundHandleOnline)
      window.removeEventListener('offline', this.boundHandleOffline)
    }
  }
}

export const signalPipeline = new SignalPipeline()
