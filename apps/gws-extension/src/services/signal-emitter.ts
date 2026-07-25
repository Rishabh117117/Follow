/**
 * Signal Emitter — batches signals and sends to Follow backend.
 * Port of packages/shared/src/events/tracker.ts adapted for Chrome Extension.
 *
 * Same 5-second batch interval as existing tracker.
 * Uses chrome.runtime.sendMessage to forward via background service worker.
 * Falls back to navigator.sendBeacon on page unload.
 */

import { SIGNAL_BATCH_INTERVAL, MAX_BATCH_SIZE, DEFAULT_API_BASE_URL, STORAGE_KEYS } from '@/lib/constants'
import { getDocType } from '@/content/page-detector'
import { offlineQueue } from './offline-queue'

export interface GWSSignal {
  signalType: string
  payload: Record<string, unknown>
  timestamp: string
  googleDocId: string
  docType: 'docs' | 'sheets' | 'slides'
}

class SignalEmitter {
  private queue: GWSSignal[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private followDocId: string | null = null

  start(followDocId: string) {
    this.followDocId = followDocId
    this.timer = setInterval(() => this.flush(), SIGNAL_BATCH_INTERVAL)
    // Flush on page unload via navigator.sendBeacon
    window.addEventListener('beforeunload', () => this.flushSync())
  }

  emit(signalType: string, payload: Record<string, unknown> = {}) {
    if (!this.followDocId) return

    this.queue.push({
      signalType,
      payload,
      timestamp: new Date().toISOString(),
      googleDocId: this.followDocId,
      docType: getDocType() || 'docs',
    })

    if (this.queue.length >= MAX_BATCH_SIZE) {
      this.flush()
    }
  }

  private async flush() {
    if (this.queue.length === 0 || !this.followDocId) return

    const batch = this.queue.splice(0, MAX_BATCH_SIZE)
    const docId = this.followDocId

    // Send via background service worker — this now returns a proper response
    // because service-worker.ts wraps fetch in fetchWithRetry.
    try {
      const result = await new Promise<{ success?: boolean; error?: string } | undefined>((resolve) => {
        try {
          chrome.runtime.sendMessage(
            { type: 'SIGNAL_BATCH', payload: { externalDocId: docId, signals: batch } },
            (res: { success?: boolean; error?: string } | undefined) => {
              // chrome.runtime.lastError is unavoidable when the SW is restarting;
              // treat as failure and let the offline queue handle it.
              void chrome.runtime.lastError
              resolve(res)
            },
          )
        } catch {
          resolve(undefined)
        }
      })

      if (!result?.success) {
        // Enqueue to offlineQueue for later retry
        await offlineQueue.enqueue(docId, batch)
      }
    } catch (err) {
      console.warn('[Follow] Failed to send signal batch:', err)
      await offlineQueue.enqueue(docId, batch)
    }
  }

  private async flushSync() {
    if (this.queue.length === 0 || !this.followDocId) return

    // navigator.sendBeacon for reliable delivery on page close
    try {
      const data = await chrome.storage.local.get([STORAGE_KEYS.API_BASE_URL])
      const apiBaseUrl = (data[STORAGE_KEYS.API_BASE_URL] as string) || DEFAULT_API_BASE_URL
      const url = `${apiBaseUrl}/api/gws/documents/${this.followDocId}/signals`

      navigator.sendBeacon(
        url,
        new Blob([JSON.stringify({ signals: this.queue })], { type: 'application/json' })
      )
    } catch {
      // Best effort — page is closing
    }
    this.queue = []
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.flushSync()
    this.followDocId = null
  }

  getQueueLength(): number {
    return this.queue.length
  }
}

export const signalEmitter = new SignalEmitter()
