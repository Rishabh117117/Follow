/**
 * Follow Desktop Agent (Sprint DA-1)
 *
 * Watches local folders, extracts text, and syncs files to Follow's index.
 * Run: pnpm start (or tsx src/index.ts)
 */

import { loadConfig } from './config.js'
import { createLogger } from './logger.js'
import { createSyncer } from './syncer.js'
import { createSyncQueue } from './queue.js'
import { startWatcher } from './watcher.js'

const VERSION = '1.0.0'

async function main() {
  // 1. Load config
  const config = loadConfig()
  const logger = createLogger(config.logLevel)

  // 2. Create services
  const syncer = createSyncer(config, logger)
  const queue = createSyncQueue(config, syncer, logger)

  // 3. Check API connection
  const connected = await syncer.checkConnection()
  if (!connected) {
    logger.error(`Cannot reach Follow API at ${config.apiUrl}. Is the server running?`)
    process.exit(1)
  }

  // 4. Print startup banner
  const folderCount = config.folders.length
  const presets = [...new Set(config.folders.map((f) => f.preset))].join(', ')
  console.log('')
  console.log('  ┌─────────────────────────────────────┐')
  console.log(`  │  Follow Desktop Agent v${VERSION}        ��`)
  console.log(`  │  API: ${config.apiUrl.padEnd(28)}│`)
  console.log(`  │  Watching: ${String(folderCount).padEnd(2)} folder(s)${' '.repeat(16)}│`)
  console.log(`  │  Preset: ${presets.padEnd(26)}│`)
  console.log(`  │  Sync interval: ${(config.syncIntervalMs / 1000).toFixed(0)}s${' '.repeat(18)}│`)
  console.log('  └─────────���───────────────────────────┘')
  console.log('')

  logger.info(`API: ${config.apiUrl} — Connected`)

  // 5. Start watcher
  const watchers = startWatcher(config, (event) => {
    queue.enqueue(event)
  }, logger)

  // 5a. Hot-reload: poll the config file mtime. On change, exit(0) and
  // let the launcher respawn us with the new config.
  const { statSync } = await import('fs')
  const { resolve } = await import('path')
  const configPath = resolve(process.cwd(), 'follow-agent.config.json')
  let lastMtime = statSync(configPath).mtimeMs
  setInterval(() => {
    try {
      const current = statSync(configPath).mtimeMs
      if (current !== lastMtime) {
        lastMtime = current
        logger.info('Config file changed on disk — exiting for restart…')
        // Drain queue quickly then exit; launcher auto-restarts.
        queue.flush().finally(() => process.exit(0))
      }
    } catch {
      // Config deleted or unreadable — don't crash the agent
    }
  }, 2000)

  // 6. Start sync queue
  queue.start()

  // 7. Track session stats
  let totalSynced = 0
  const originalFlush = queue.flush.bind(queue)
  // We'll count on shutdown

  // 8. Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down...`)

    // Stop watching
    for (const w of watchers) {
      await w.close()
    }

    // Flush remaining items
    const remaining = queue.pending()
    if (remaining > 0) {
      logger.info(`Flushing ${remaining} remaining item(s)...`)
      await queue.flush()
    }
    queue.stop()

    logger.info('Agent stopped.')
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Initial scan flush — wait a bit for the watcher to discover files, then flush
  setTimeout(async () => {
    const count = queue.pending()
    if (count > 0) {
      logger.info(`Initial scan: ${count} file(s) queued. Syncing...`)
      const result = await queue.flush()
      logger.info(
        `Initial scan complete. ${result.uploaded} new, ${result.unchanged} unchanged, ${result.errors} errors.`
      )
    }
  }, 3000) // Wait 3s for chokidar initial scan
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
