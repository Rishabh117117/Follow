import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { errorHandler } from './middleware/error'
import { trafficLogger } from './middleware/traffic-logger'
import { usersRouter } from './routes/users'
import { usersMeRouter } from './routes/users-me'
import { workspacesRouter } from './routes/workspaces'
import { filesRouter } from './routes/files'
import { chatRouter } from './routes/chat'
import { promptingRouter } from './routes/prompting'
import { knowledgeRouter } from './routes/knowledge'
import { notificationsRouter } from './routes/notifications'
import { sharingRouter } from './routes/sharing'
import { webhooksRouter } from './routes/webhooks'
import { spacesRouter } from './routes/spaces'
import { docMemoryRouter } from './routes/doc-memory'
import { gwsRouter } from './routes/gws'
import { authRouter } from './routes/auth'
import { indexQueryRouter } from './routes/index-query'
import { indexManageRouter } from './routes/index-manage'
import { indexesRouter } from './routes/indexes'
import { memorySectionsRouter } from './routes/memory-sections'
import { adminRouter } from './routes/admin'
import { devGraphRouter } from './routes/dev-graph'
import { sessionsRouter } from './routes/sessions'
import { adminServerVaultRouter } from './routes/admin-server-vault'
import { sharedStateRouter } from './routes/shared-state'
import { aiStateRouter } from './routes/ai-state'
import { healthRouter } from './routes/health'
import { mcpRoutes } from './mcp/transport'
import { mcpKeysRouter } from './routes/mcp-keys'
import { agentsRouter } from './routes/agents'
import { mcpRestRouter } from './routes/mcp-rest'
import { mcpRestOpenApiRouter } from './routes/mcp-rest-openapi'
import { rawFilesRouter } from './routes/raw-files'
import { publicRouter } from './routes/public'
import { searchRouter } from './routes/search'
import { modelsRouter } from './routes/models'
import { openrouterRouter } from './routes/openrouter'
import { indexQueueRouter } from './routes/index-queue'
import { scopeRouter } from './routes/scope'
import { queriesRouter } from './routes/queries'
import { discoverRouter } from './routes/discover'
import { getInMemoryClickHouse, isClickHouseFallback } from './db/clickhouse'
import { isServerFeatureActive } from './config/server-vault'

interface CreateAppOptions {
  /** Skip HTTP request logging (useful for tests) */
  silent?: boolean
}

/**
 * Build and return the Hono application with all routes registered.
 * Extracted from index.ts so integration tests can import the app
 * without starting HTTP/WebSocket servers.
 */
export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono()

  if (!options.silent) {
    app.use('*', logger())
  }

  const isDev = process.env['DEV_BYPASS_AUTH'] === 'true'
  app.use(
    '*',
    cors({
      origin: (origin) => {
        // Dev mode: allow all origins (extension content scripts run from page origins like google.com)
        if (isDev) return origin || '*'
        // Allow Chrome extension origins
        if (origin?.startsWith('chrome-extension://')) return origin
        // Allow any localhost origin (dev server, webapp, etc.)
        if (origin?.includes('localhost')) return origin
        // Allow the configured web origin (NEXT_PUBLIC_URL) and any Railway
        // sibling service — the web app + API share the *.up.railway.app
        // domain. CORS only governs which browser origins may READ responses;
        // the API still enforces its own x-user-id / API-key auth on every
        // route, so this does not widen actual access.
        const webOrigin = process.env['NEXT_PUBLIC_URL']
        if (origin && webOrigin && origin === webOrigin) return origin
        if (origin?.endsWith('.up.railway.app')) return origin
        // Default: webapp URL
        return webOrigin ?? 'http://localhost:3000'
      },
      credentials: true,
    })
  )
  app.onError(errorHandler)
  app.use('*', trafficLogger)

  app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))
  app.route('/api/health', healthRouter)
  app.route('/api/public', publicRouter)

  // IMPORTANT: /api/users/me must be mounted BEFORE /api/users
  // so Hono doesn't match the :id route first
  app.route('/api/users/me', usersMeRouter)
  app.route('/api/users', usersRouter)
  app.route('/api/workspaces', workspacesRouter)
  app.route('/api/files', filesRouter)
  if (isServerFeatureActive('route-chat')) {
    app.route('/api/chat', chatRouter)
  } else {
    console.info('[Startup] route-chat gated off via server-vault (/api/chat not mounted)')
  }
  app.route('/api/prompting', promptingRouter)
  app.route('/api/knowledge', knowledgeRouter)
  app.route('/api/notifications', notificationsRouter)
  app.route('/api/sharing', sharingRouter)
  app.route('/api/webhooks', webhooksRouter)
  app.route('/api/spaces', spacesRouter)
  app.route('/api/doc-memory', docMemoryRouter)
  app.route('/api/gws', gwsRouter)
  app.route('/api/auth', authRouter)
  app.route('/api/index/items', indexManageRouter)
  app.route('/api/index', indexQueryRouter)
  app.route('/api/indexes', indexesRouter)
  app.route('/api/memory', memorySectionsRouter)
  app.route('/api/admin', adminRouter)
  app.route('/api/dev/graph', devGraphRouter)
  app.route('/api/sessions', sessionsRouter)
  // SERVER-VAULT-DASHBOARD-1 (2026-04-23): operator inspection of server-vault
  // state. KEEP — intentionally not wrapped in isServerFeatureActive (this is
  // the surface that reports what's gated; self-referential gating would
  // defeat its purpose).
  app.route('/api/admin/server-vault', adminServerVaultRouter)
  app.route('/api/shared-state', sharedStateRouter)
  app.route('/api/ai-state', aiStateRouter)
  app.route('/api/search', searchRouter)
  app.route('/mcp', mcpRoutes)
  app.route('/api/mcp/keys', mcpKeysRouter)
  app.route('/api/agents', agentsRouter)
  // DEPLOY-1: mount the OpenAPI spec router FIRST so GET
  // /api/mcp-rest/openapi.json stays PUBLIC — ChatGPT Actions and the
  // claude.ai connector dialog fetch the spec unauthenticated. Mounted after
  // mcpRestRouter, its catch-all flexAuth (use('*')) intercepts the spec
  // request and 401s it before it can reach the openapi handler.
  app.route('/api/mcp-rest', mcpRestOpenApiRouter)
  app.route('/api/mcp-rest', mcpRestRouter)
  app.route('/api/raw-files', rawFilesRouter)
  app.route('/api/models', modelsRouter)
  app.route('/api/openrouter', openrouterRouter)
  app.route('/api/index-queue', indexQueueRouter)
  app.route('/api/scope', scopeRouter)
  app.route('/api/queries', queriesRouter)
  app.route('/api/discover', discoverRouter)

  // ─── Debug endpoint: inspect in-memory ClickHouse data ───────────
  app.get('/api/debug/clickhouse', (c) => {
    if (!isClickHouseFallback()) {
      return c.json({ mode: 'real', message: 'Using real ClickHouse — no in-memory data' })
    }
    const mem = getInMemoryClickHouse()
    if (!mem) return c.json({ mode: 'unknown', message: 'No in-memory store' })

    const tables = mem.getAllTables()
    const data: Record<string, unknown[]> = {}
    for (const table of tables) {
      data[table] = mem.getTableData(table)
    }
    return c.json({
      mode: 'in-memory',
      tables,
      rowCounts: Object.fromEntries(tables.map((t) => [t, data[t]?.length ?? 0])),
      data,
    })
  })

  // Debug: clear all in-memory ClickHouse data
  app.post('/api/debug/clear', (c) => {
    if (!isClickHouseFallback()) {
      return c.json({ mode: 'real', message: 'Using real ClickHouse — cannot clear' })
    }
    const mem = getInMemoryClickHouse()
    if (!mem) return c.json({ mode: 'unknown', message: 'No in-memory store' })

    const result = mem.clearAllTables()
    return c.json({
      mode: 'in-memory',
      cleared: true,
      ...result,
    })
  })

  // Debug: get just processed intents (summaries)
  app.get('/api/debug/summaries', (c) => {
    if (!isClickHouseFallback()) {
      return c.json({ mode: 'real', message: 'Using real ClickHouse' })
    }
    const mem = getInMemoryClickHouse()
    if (!mem) return c.json({ mode: 'unknown' })

    const intents = mem.getTableData('processed_intents')
    return c.json({
      mode: 'in-memory',
      count: intents.length,
      summaries: intents.map((r) => ({
        timestamp: r['timestamp'],
        user_action: r['user_action'],
        user_intent: r['user_intent'],
        summary_text: r['summary_text'],
        confidence: r['confidence'],
        tags: r['tags'],
      })),
    })
  })

  return app
}
