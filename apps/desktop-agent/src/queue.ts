/**
 * Sync Queue (Sprint DA-1)
 *
 * Batches file changes before syncing to the API.
 */

import type { Syncer, FileChangeEvent, SyncFileResult } from './syncer.js'
import type { AgentConfig } from './config.js'
import type { Logger } from './logger.js'

export interface SyncResult {
  uploaded: number
  unchanged: number
  errors: number
  deleted: number
}

export interface SyncQueue {
  enqueue(event: FileChangeEvent): void
  flush(): Promise<SyncResult>
  start(): void
  stop(): void
  pending(): number
}

export function createSyncQueue(
  config: AgentConfig,
  syncer: Syncer,
  logger: Logger
): SyncQueue {
  const pendingChanges = new Map<string, FileChangeEvent>()
  const pendingDeletes = new Set<string>()
  let intervalId: ReturnType<typeof setInterval> | null = null

  function enqueue(event: FileChangeEvent): void {
    if (event.type === 'unlink') {
      pendingDeletes.add(event.filePath)
      pendingChanges.delete(event.filePath)
    } else {
      // Dedup: latest event for same path wins
      pendingChanges.set(event.filePath, event)
      pendingDeletes.delete(event.filePath)
    }
  }

  async function flush(): Promise<SyncResult> {
    const result: SyncResult = { uploaded: 0, unchanged: 0, errors: 0, deleted: 0 }

    // Process changes
    const changes = Array.from(pendingChanges.values())
    pendingChanges.clear()

    for (const event of changes) {
      const preset = event.folderConfig.preset

      // Private preset: never auto-sync
      if (preset === 'private') {
        logger.debug(`[private] Skipping: ${event.filePath}`)
        continue
      }

      // Balanced preset: log only (interactive approval in future sprint)
      if (preset === 'balanced') {
        logger.info(`[balanced] Detected: ${event.filePath} — run manual sync to push`)
        continue
      }

      // Open preset: sync immediately
      try {
        const syncResult = await syncer.syncFile(event)
        switch (syncResult.status) {
          case 'uploaded':
            result.uploaded++
            logger.info(`Synced: ${syncResult.fileName} (uploaded)`)
            break
          case 'unchanged':
            result.unchanged++
            logger.debug(`Unchanged: ${syncResult.fileName}`)
            break
          case 'error':
            result.errors++
            logger.error(`Failed: ${syncResult.fileName} — ${syncResult.error}`)
            break
        }
      } catch (err) {
        result.errors++
        logger.error(`Sync error: ${(err as Error).message}`)
      }
    }

    // Process deletes
    const deletes = Array.from(pendingDeletes)
    pendingDeletes.clear()

    for (const filePath of deletes) {
      try {
        await syncer.deleteFile(filePath)
        result.deleted++
        logger.info(`Deleted: ${filePath}`)
      } catch {
        result.errors++
      }
    }

    return result
  }

  function start(): void {
    if (intervalId) return
    intervalId = setInterval(async () => {
      if (pendingChanges.size === 0 && pendingDeletes.size === 0) return
      try {
        await flush()
      } catch (err) {
        logger.warn(`Queue flush failed: ${(err as Error).message}. ${pending()} items queued for retry.`)
      }
    }, config.syncIntervalMs)
  }

  function stop(): void {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  function pending(): number {
    return pendingChanges.size + pendingDeletes.size
  }

  return { enqueue, flush, start, stop, pending }
}
