import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// Resolve .env paths relative to this file (packages/api/src/), not CWD.
// The launch config may start the server from the monorepo root.
const __dirname_api = resolve(dirname(fileURLToPath(import.meta.url)), '..')
config({ path: resolve(__dirname_api, '.env.local') })
config({ path: resolve(__dirname_api, '.env') })
// Also load .env.docker from project root if present
config({ path: resolve(__dirname_api, '..', '..', '.env.docker') })

import { validateEnv } from './config/env'
validateEnv()

import { serve } from '@hono/node-server'
import { createApp } from './app'
import { waitForDb } from './db/index'
import { seedDevUser } from './db/seed-dev-user'
import { EventBus } from './events/EventBus'
import { initPromptingPipeline } from './services/prompting/pipeline'
import { initClickHouseTables } from './db/clickhouse'
import { startIndexWorker, hydrateQueueState } from './services/indexing/index-queue'
import { startSemanticIndexBackground } from './services/semantic-index/background'
import { runIndexAgent } from './services/indexing/indexing-agent'
import { createWebSocketServer } from './ws/index'
import { createYjsWebSocketServer } from './ws/yjs-server'
import { redis } from './redis/index'
import { isServerFeatureActive } from './config/server-vault'

const app = createApp()
const port = parseInt(process.env['PORT'] ?? '3001', 10)
const wsPort = parseInt(process.env['WS_PORT'] ?? '3002', 10)
const yjsPort = parseInt(process.env['YJS_WS_PORT'] ?? '3003', 10)

// ─── Connection retry helper ───────────────────────────────────────────

async function retryConnect(
  name: string,
  fn: () => Promise<void>,
  maxRetries = 5,
  delayMs = 2000
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fn()
      console.info(`[Startup] ${name} connected`)
      return true
    } catch (err) {
      if (attempt < maxRetries) {
        console.warn(
          `[Startup] ${name} attempt ${attempt}/${maxRetries} failed, retrying in ${delayMs}ms...`
        )
        await new Promise((r) => setTimeout(r, delayMs))
      } else {
        console.warn(`[Startup] ${name} unavailable after ${maxRetries} attempts — using fallback`)
      }
    }
  }
  return false
}

// ─── Startup ───────��───────────────────────────────────────────────────

let wsServer: ReturnType<typeof createWebSocketServer> | null = null
let yjsServer: ReturnType<typeof createYjsWebSocketServer> | null = null

waitForDb()
  .then(async () => {
    // DEPLOY-1 / A6: production must not silently run with auth bypass.
    // DEV_BYPASS_AUTH already defaults to false (only the literal string
    // 'true' enables it — see middleware/auth.ts), but warn loudly if it was
    // left on in production so the unified auth-header path (CLEAN-2) is
    // actually enforced.
    if (process.env['NODE_ENV'] === 'production' && process.env['DEV_BYPASS_AUTH'] === 'true') {
      console.warn(
        '[Startup] SECURITY: DEV_BYPASS_AUTH=true in production — authentication is bypassed. Set DEV_BYPASS_AUTH=false.'
      )
    }

    // Phase 3 break-glass must never become a steady state: it re-enables the
    // forgeable x-user-id identity path that Phase 3 removed.
    if (
      process.env['NODE_ENV'] === 'production' &&
      process.env['AUTH_ACCEPT_LEGACY_USER_HEADER'] === 'true'
    ) {
      console.warn(
        '[Startup] SECURITY: AUTH_ACCEPT_LEGACY_USER_HEADER=true in production — legacy x-user-id identity is re-enabled (break-glass). Migrate the client, then unset it.'
      )
    }

    // Seed dev user when running in dev bypass mode
    if (process.env['DEV_BYPASS_AUTH'] === 'true') {
      await seedDevUser()
    }

    // Verify infrastructure connections with retry
    await retryConnect('ClickHouse', async () => {
      await initClickHouseTables()
    })

    await retryConnect('Redis', async () => {
      await redis.get('__startup_check__')
    })

    // Start core services
    EventBus.start()
    initPromptingPipeline()

    // Sessions infra (2026-04-29) — idle reaper + queue bridge + pipeline
    // crons. Powers the session-bracketed Archivist + Profiler triggers
    // from the v5.2 pipeline. See services/sessions/ for the lifecycle.
    {
      const { startIdleReaper } = await import('./services/sessions')
      const { installSessionToQueueBridge, startPipelineCrons } =
        await import('./services/sessions/queue-bridge')
      startIdleReaper()
      installSessionToQueueBridge()
      startPipelineCrons()
      console.info('[Startup] Sessions + pipeline crons started')
    }

    // Load persisted pause/stop intent before the worker ticks so a stop from
    // last session isn't silently ignored. This is the guard that prevents a
    // restart from auto-resuming an expensive run.
    await hydrateQueueState()
    startIndexWorker(runIndexAgent)
    startSemanticIndexBackground()

    // Sprint SH-3: live slice sync scheduler — 2min catch-up pass for
    // live shared_slices. Starts after a 150s warmup so the indexer
    // and schema are fully ready. The sync-scheduler itself also adds
    // its own 30s delay before the first pass.
    if (isServerFeatureActive('scheduler-sync')) {
      setTimeout(() => {
        import('./services/sharing/sync-scheduler')
          .then(({ startSyncScheduler }) => {
            startSyncScheduler()
            console.info('[Startup] Live slice sync scheduler started')
          })
          .catch((err) => console.warn('[Sharing] Sync scheduler failed:', err))
      }, 150_000)
    } else {
      console.info('[Startup] scheduler-sync gated off via server-vault')
    }

    // ── WebSocket servers (signal + Yjs) ───────────────────────────────
    // DEPLOY-1 / A4: single-port PaaS note. On Railway only $PORT is publicly
    // reachable. The signal WS (WS_PORT) and the Yjs collab WS (YJS_WS_PORT)
    // still bind to their own ports *inside* the container, but those ports
    // are NOT exposed externally — so real-time collaboration is DEGRADED
    // until they're multiplexed onto the main HTTP server (follow-up sprint;
    // see deploy/DEPLOY-1.md §A4). We bind best-effort and warn loudly rather
    // than crash the API if a bind fails.
    if (process.env['NODE_ENV'] === 'production') {
      console.warn(
        `[Startup] Single-port deploy (NODE_ENV=production): signal WS (:${wsPort}) and Yjs WS (:${yjsPort}) bind internally but are NOT publicly reachable on Railway's one-port model. Real-time collaboration is DEGRADED until these are multiplexed onto $PORT. See deploy/DEPLOY-1.md §A4.`
      )
    }
    try {
      wsServer = createWebSocketServer(wsPort)
    } catch (err) {
      console.warn(
        `[Startup] signal WS failed to bind on :${wsPort} — real-time signals disabled:`,
        err
      )
    }
    try {
      yjsServer = createYjsWebSocketServer(yjsPort)
    } catch (err) {
      console.warn(
        `[Startup] Yjs WS failed to bind on :${yjsPort} — real-time collab disabled:`,
        err
      )
    }

    // HTTP server
    serve({ fetch: app.fetch, port }, (info) => {
      console.info(`\n[Follow API] Ready`)
      console.info(`  HTTP:  http://localhost:${info.port}`)
      console.info(`  WS:    ws://localhost:${wsPort}`)
      console.info(`  Yjs:   ws://localhost:${yjsPort}\n`)
    })
  })
  .catch((err) => {
    console.error('[API] Failed to start — database init error:', err)
    process.exit(1)
  })

// ─── Graceful Shutdown ─────────────────────────────────────────────────

async function shutdown() {
  console.info('\n[Shutdown] Graceful shutdown initiated...')

  EventBus.stop()

  // Close WebSocket servers
  if (wsServer) {
    try {
      wsServer.close()
    } catch {
      /* ignore */
    }
  }
  if (yjsServer) {
    try {
      yjsServer.close()
    } catch {
      /* ignore */
    }
  }

  // Close Redis
  try {
    await redis.disconnect()
  } catch {
    /* ignore */
  }

  console.info('[Shutdown] Complete')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
