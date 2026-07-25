interface TrackEvent {
  actionType: string
  objectType: string
  objectId: string
  objectName?: string
  payload?: Record<string, unknown>
  durationMs?: number | null
}

interface TrackerConfig {
  apiUrl: string
  flushIntervalMs?: number
  getHeaders: () => Record<string, string>
}

export class EventTracker {
  private queue: TrackEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private config: TrackerConfig
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private idleStart: number | null = null
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000 // 5 min

  constructor(config: TrackerConfig) {
    this.config = config
  }

  start(): void {
    this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs ?? 2000)

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flushSync())
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.flushSync()
        }
      })

      // Idle detection
      const resetIdle = () => {
        if (this.idleStart) {
          this.idleStart = null
        }
        if (this.idleTimer) clearTimeout(this.idleTimer)
        this.idleTimer = setTimeout(() => {
          this.idleStart = Date.now()
          this.track({
            actionType: 'idle_start',
            objectType: 'session',
            objectId: 'self',
          })
        }, this.IDLE_TIMEOUT)
      }

      window.addEventListener('mousemove', resetIdle, { passive: true })
      window.addEventListener('keydown', resetIdle, { passive: true })
      window.addEventListener('click', resetIdle, { passive: true })
      resetIdle()
    }
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    this.flush()
  }

  track(event: TrackEvent): void {
    this.queue.push(event)
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return
    const events = this.queue.splice(0)

    try {
      await fetch(`${this.config.apiUrl}/api/timeline/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.getHeaders(),
        },
        body: JSON.stringify({ events }),
      })
    } catch {
      // Put events back in queue for retry
      this.queue.unshift(...events)
    }
  }

  private flushSync(): void {
    if (this.queue.length === 0) return
    const events = this.queue.splice(0)

    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      navigator.sendBeacon(`${this.config.apiUrl}/api/timeline/events`, JSON.stringify({ events }))
    }
  }
}
