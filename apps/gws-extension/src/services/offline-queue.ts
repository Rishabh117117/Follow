/**
 * OfflineQueue — stores signals in chrome.storage.local when backend is unreachable.
 *
 * Sprint G8: Error handling and offline resilience.
 *
 * - Queues signals when backend returns errors or network is down
 * - Retries with exponential backoff: 5s, 10s, 30s, 60s, 300s
 * - Maximum 1000 queued signals (FIFO eviction)
 * - Flushes automatically on reconnection
 * - Shows orange badge while offline
 */

import { STORAGE_KEYS } from '@/lib/constants'

const OFFLINE_QUEUE_KEY = 'follow_offline_signal_queue'
const MAX_QUEUE_SIZE = 1000
const RETRY_DELAYS = [5000, 10000, 30000, 60000, 300000] // 5s, 10s, 30s, 1m, 5m

interface QueuedBatch {
  externalDocId: string
  signals: unknown[]
  queuedAt: number
  retryCount: number
}

export class OfflineQueue {
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private isOnline = true
  private retryCount = 0
  // Bound handlers so removeEventListener works correctly
  private boundHandleOnline = () => this.handleOnline()
  private boundHandleOffline = () => this.handleOffline()

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.boundHandleOnline)
      window.addEventListener('offline', this.boundHandleOffline)
    }
  }

  /**
   * Queue a signal batch for later delivery.
   */
  async enqueue(externalDocId: string, signals: unknown[]): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(OFFLINE_QUEUE_KEY)
      const queue: QueuedBatch[] = (stored[OFFLINE_QUEUE_KEY] as QueuedBatch[]) || []

      queue.push({
        externalDocId,
        signals,
        queuedAt: Date.now(),
        retryCount: 0,
      })

      // Enforce max size — evict oldest
      const totalSignals = queue.reduce((sum, b) => sum + b.signals.length, 0)
      while (queue.length > 0 && totalSignals > MAX_QUEUE_SIZE) {
        queue.shift()
      }

      await chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: queue })

      this.setBadgeOffline()
      this.scheduleRetry()
    } catch (err) {
      console.warn('[OfflineQueue] Failed to enqueue signals:', err)
    }
  }

  /**
   * Attempt to flush all queued signals to the backend.
   */
  async flush(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(OFFLINE_QUEUE_KEY)
      const queue: QueuedBatch[] = (stored[OFFLINE_QUEUE_KEY] as QueuedBatch[]) || []

      if (queue.length === 0) {
        this.clearBadge()
        return
      }

      const remaining: QueuedBatch[] = []

      for (const batch of queue) {
        try {
          const result = await chrome.runtime.sendMessage({
            type: 'SIGNAL_BATCH',
            payload: {
              externalDocId: batch.externalDocId,
              signals: batch.signals,
            },
          })

          if (!result?.success) {
            batch.retryCount++
            remaining.push(batch)
          }
        } catch {
          batch.retryCount++
          remaining.push(batch)
        }
      }

      await chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: remaining })

      if (remaining.length === 0) {
        this.retryCount = 0
        this.clearBadge()
        this.isOnline = true
      } else {
        this.scheduleRetry()
      }
    } catch (err) {
      console.warn('[OfflineQueue] Flush failed:', err)
      this.scheduleRetry()
    }
  }

  /**
   * Get the current queue size.
   */
  async getQueueSize(): Promise<number> {
    try {
      const stored = await chrome.storage.local.get(OFFLINE_QUEUE_KEY)
      const queue: QueuedBatch[] = (stored[OFFLINE_QUEUE_KEY] as QueuedBatch[]) || []
      return queue.reduce((sum, b) => sum + b.signals.length, 0)
    } catch {
      return 0
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)

    const delay = RETRY_DELAYS[Math.min(this.retryCount, RETRY_DELAYS.length - 1)]!
    this.retryCount++

    this.retryTimer = setTimeout(() => {
      this.flush()
    }, delay)
  }

  private handleOnline(): void {
    this.isOnline = true
    this.retryCount = 0
    this.flush()
  }

  private handleOffline(): void {
    this.isOnline = false
    this.setBadgeOffline()
  }

  private setBadgeOffline(): void {
    try {
      chrome.runtime.sendMessage({
        type: 'BADGE_UPDATE',
        payload: { text: '\u25CF', color: '#F59E0B' }, // orange dot
      })
    } catch {
      // Can't communicate with service worker
    }
  }

  private clearBadge(): void {
    try {
      chrome.runtime.sendMessage({
        type: 'BADGE_UPDATE',
        payload: { text: '', color: '#16A34A' },
      })
    } catch {
      // Can't communicate with service worker
    }
  }

  destroy(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.boundHandleOnline)
      window.removeEventListener('offline', this.boundHandleOffline)
    }
  }
}

// Singleton instance
export const offlineQueue = new OfflineQueue()
