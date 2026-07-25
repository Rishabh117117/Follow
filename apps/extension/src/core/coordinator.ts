/**
 * Coordinator — single tick loop that replaces all independent timers.
 *
 * One setInterval(1000) drives all periodic work. Registered handlers
 * execute at their own intervals. The entire loop PAUSES when the tab
 * is hidden (Page Visibility API), eliminating background CPU waste.
 */

export interface CoordinatorHandler {
  /** Unique handler ID */
  id: string
  /** How often to run (ms). E.g. 5000 = every 5 seconds */
  interval: number
  /** If true, handler is skipped when document is hidden */
  visibilityRequired: boolean
  /** The work to perform */
  execute: () => void | Promise<void>
}

const TICK_INTERVAL = 1000

class Coordinator {
  private handlers = new Map<string, CoordinatorHandler & { lastRun: number }>()
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private isRunning = false

  /**
   * Register a periodic handler. If a handler with the same ID exists, it's replaced.
   */
  register(handler: CoordinatorHandler): void {
    this.handlers.set(handler.id, { ...handler, lastRun: 0 })
    // Auto-start if not running and we have handlers
    if (!this.isRunning && this.handlers.size > 0) {
      this.start()
    }
  }

  /**
   * Remove a handler by ID.
   */
  unregister(id: string): void {
    this.handlers.delete(id)
    // Auto-stop if no handlers remain
    if (this.handlers.size === 0) {
      this.stop()
    }
  }

  /**
   * Start the coordinator tick loop.
   */
  start(): void {
    if (this.isRunning) return
    this.isRunning = true

    // Listen for visibility changes to pause/resume
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange)
    }

    this.startTick()
  }

  /**
   * Stop the coordinator and all handlers.
   */
  stop(): void {
    this.isRunning = false
    this.stopTick()

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange)
    }
  }

  /**
   * Clear all handlers and stop.
   */
  destroy(): void {
    this.handlers.clear()
    this.stop()
  }

  /**
   * Force-run a specific handler immediately (e.g. on page unload).
   */
  async runNow(id: string): Promise<void> {
    const handler = this.handlers.get(id)
    if (handler) {
      await handler.execute()
      handler.lastRun = Date.now()
    }
  }

  private startTick(): void {
    if (this.tickTimer) return
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL)
  }

  private stopTick(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
  }

  private onVisibilityChange = (): void => {
    if (!this.isRunning) return

    if (document.hidden) {
      // Tab hidden — pause the tick loop entirely
      this.stopTick()
    } else {
      // Tab visible — resume and run any overdue handlers immediately
      this.startTick()
      this.tick()
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now()
    const isHidden = typeof document !== 'undefined' && document.hidden

    for (const handler of this.handlers.values()) {
      // Skip if not enough time has elapsed
      if (now - handler.lastRun < handler.interval) continue
      // Skip visibility-required handlers when hidden
      if (handler.visibilityRequired && isHidden) continue

      handler.lastRun = now
      try {
        await handler.execute()
      } catch (err) {
        console.warn(`[Coordinator] Handler "${handler.id}" failed:`, err)
      }
    }
  }
}

/** Singleton coordinator for the content script */
export const coordinator = new Coordinator()
