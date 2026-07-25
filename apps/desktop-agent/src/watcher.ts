/**
 * File System Watcher (Sprint DA-1)
 *
 * Watches folders for file changes using chokidar.
 */

import chokidar from 'chokidar'
import { statSync } from 'fs'
import { relative } from 'path'
import type { AgentConfig, WatchFolder } from './config.js'
import { DEFAULT_EXCLUDES } from './config.js'
import type { Logger } from './logger.js'
import type { FileChangeEvent } from './syncer.js'

export type ChangeHandler = (event: FileChangeEvent) => void

export function startWatcher(
  config: AgentConfig,
  onChange: ChangeHandler,
  logger: Logger
): chokidar.FSWatcher[] {
  const watchers: chokidar.FSWatcher[] = []
  const maxBytes = config.maxFileSizeMb * 1024 * 1024

  for (const folder of config.folders) {
    const watchPattern = folder.includePatterns && folder.includePatterns.length > 0
      ? folder.includePatterns.map((p) => `${folder.path}/${p}`)
      : folder.path

    const ignored = [...DEFAULT_EXCLUDES, ...(folder.excludePatterns ?? [])]

    const watcher = chokidar.watch(watchPattern, {
      ignored,
      persistent: true,
      ignoreInitial: false,
      depth: folder.recursive ? undefined : 0,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 200,
      },
    })

    let initialCount = 0

    const handleEvent = (type: 'add' | 'change' | 'unlink', filePath: string) => {
      // Skip files over size limit
      if (type !== 'unlink') {
        try {
          const stat = statSync(filePath)
          if (stat.size > maxBytes) {
            logger.debug(`Skipping (too large): ${filePath} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`)
            return
          }
        } catch {
          return
        }
      }

      const rel = relative(folder.path, filePath)
      if (type === 'add') initialCount++

      onChange({
        type,
        filePath,
        folderConfig: folder,
        detectedAt: new Date(),
      })

      // Only log change/unlink (add is too noisy during initial scan)
      if (type !== 'add') {
        logger.info(`[${type}] ${rel}`)
      }
    }

    watcher.on('add', (path) => handleEvent('add', path))
    watcher.on('change', (path) => handleEvent('change', path))
    watcher.on('unlink', (path) => handleEvent('unlink', path))

    watcher.on('ready', () => {
      logger.info(`${folder.path} — Initial scan complete. ${initialCount} files found.`)
    })

    watcher.on('error', (err) => {
      logger.error(`Watcher error: ${err.message}`)
    })

    watchers.push(watcher)
  }

  return watchers
}
