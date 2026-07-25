/**
 * Live Slice Sync Scheduler (Sprint SH-3)
 *
 * Periodic catch-up for live slices. The event-driven `sync-trigger`
 * is the fast path (fires on every indexer batch), but the scheduler
 * guarantees that slices still sync if the trigger misses events
 * (for example, cross-workspace scenarios, process restarts, or
 * rare races between indexing and slice creation).
 *
 * Runs every 2 minutes after a 30s startup delay. Sequential per-slice
 * processing to avoid hammering the DB.
 *
 * Follows the same staggered-start pattern as the other schedulers
 * registered from `packages/api/src/index.ts`.
 */

import { getLiveSlicesForSync, syncLiveSlice } from './sync-service'

let syncInterval: ReturnType<typeof setInterval> | null = null
const SYNC_INTERVAL_MS = 2 * 60 * 1000 // 2 minutes
const STARTUP_DELAY_MS = 30 * 1000 // 30s warmup before first pass

/**
 * Start the live slice sync scheduler. Idempotent — calling twice is
 * a no-op so startup code can re-register without duplicating the timer.
 */
export function startSyncScheduler(): void {
  if (syncInterval) return

  console.info(
    '[SyncScheduler] Starting live slice sync scheduler (2min interval, 30s startup delay)'
  )

  setTimeout(() => {
    runSyncPass().catch((err) => {
      console.warn('[SyncScheduler] Initial sync pass failed:', err)
    })

    syncInterval = setInterval(() => {
      runSyncPass().catch((err) => {
        console.warn('[SyncScheduler] Sync pass failed:', err)
      })
    }, SYNC_INTERVAL_MS)
  }, STARTUP_DELAY_MS)
}

/**
 * Stop the scheduler. Used for graceful shutdown or test teardown.
 */
export function stopSyncScheduler(): void {
  if (syncInterval) {
    clearInterval(syncInterval)
    syncInterval = null
    console.info('[SyncScheduler] Stopped')
  }
}

/**
 * Run one sync pass: find all live slices and sync each sequentially.
 * Non-throwing — every per-slice error is logged but the pass
 * continues so one broken slice can't wedge the queue.
 */
async function runSyncPass(): Promise<void> {
  const liveSlices = await getLiveSlicesForSync()
  if (liveSlices.length === 0) return

  console.info(`[SyncScheduler] Syncing ${liveSlices.length} live slice(s)`)

  for (const slice of liveSlices) {
    try {
      const result = await syncLiveSlice(slice.id)
      if (result.synced) {
        console.info(`[SyncScheduler] Slice ${slice.id}: synced to v${result.newVersion}`)
      }
    } catch (err) {
      console.warn(`[SyncScheduler] Slice ${slice.id} sync failed:`, err)
    }
  }
}
