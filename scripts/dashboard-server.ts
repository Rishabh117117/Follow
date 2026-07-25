/**
 * Dashboard Server (Sprint LAUNCH-1 → DC-2)
 *
 * HTTP server on :4000 serving the dev console.
 * WebSocket on /ws for live traffic and log streaming.
 */

import { createServer } from 'http'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { WebSocketServer, WebSocket } from 'ws'
import type { LaunchState } from './launch.js'

const AGENT_CONFIG_PATH = resolve('apps/desktop-agent/follow-agent.config.json')

interface WatchFolder {
  path: string
  preset: 'open' | 'balanced' | 'private'
  recursive: boolean
  includePatterns?: string[]
  excludePatterns?: string[]
  cloudCopy?: boolean
}

interface AgentConfigFile {
  apiUrl: string
  apiKey: string
  workspaceId: string
  folders: WatchFolder[]
  syncIntervalMs: number
  maxFileSizeMb: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

function readAgentConfig(): AgentConfigFile | null {
  if (!existsSync(AGENT_CONFIG_PATH)) return null
  try {
    return JSON.parse(readFileSync(AGENT_CONFIG_PATH, 'utf-8')) as AgentConfigFile
  } catch {
    return null
  }
}

function writeAgentConfig(next: AgentConfigFile): void {
  writeFileSync(AGENT_CONFIG_PATH, JSON.stringify(next, null, 2) + '\n', 'utf-8')
}

async function readBody(req: import('http').IncomingMessage): Promise<unknown> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8')
        ok(raw ? JSON.parse(raw) : {})
      } catch (e) {
        fail(e)
      }
    })
    req.on('error', fail)
  })
}

const __dirname = dirname(fileURLToPath(import.meta.url))

export function startDashboardServer(state: LaunchState, port: number) {
  const htmlPath = resolve(__dirname, 'dashboard.html')

  const readDashboardHtml = (): string => {
    try {
      const raw = readFileSync(htmlPath, 'utf-8')
      // Inject dashboard token as a meta tag so authedFetch() can read it.
      const token = process.env.DASHBOARD_TOKEN ?? ''
      if (!token) return raw
      const tag = `<meta name="dashboard-token" content="${token.replace(/"/g, '&quot;')}">`
      if (raw.includes('name="dashboard-token"')) {
        return raw.replace(
          /<meta\s+name="dashboard-token"[^>]*>/,
          tag
        )
      }
      return raw.replace(/<head>/i, `<head>\n${tag}`)
    } catch {
      return '<html><body><h1>Dashboard HTML not found</h1></body></html>'
    }
  }

  const server = createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')

    const url = new URL(req.url ?? '/', `http://localhost:${port}`)

    // GET / — Dashboard HTML (re-read on each request so edits apply without restart)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      })
      res.end(readDashboardHtml())
      return
    }

    // GET /api/status — Launch state JSON
    if (url.pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(state))
      return
    }

    // GET /api/logs/:service — Last 100 log lines
    if (url.pathname.startsWith('/api/logs/')) {
      const service = url.pathname.split('/').pop()
      let logs: string[] = []
      if (service === 'api') logs = state.api.logs
      else if (service === 'agent') logs = state.agent.logs
      else if (service === 'ngrok') logs = state.api.logs.filter((l) => l.includes('[ngrok]'))

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ logs }))
      return
    }

    // ─── Agent config & sources (STABILIZE-2) ──────────────────────
    // CORS preflight for browser POSTs from the web app at :3009
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.writeHead(204)
      res.end()
      return
    }

    // GET /api/agent/config — current agent config (without the raw key)
    if (req.method === 'GET' && url.pathname === '/api/agent/config') {
      const cfg = readAgentConfig()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        present: !!cfg,
        apiUrl: cfg?.apiUrl ?? null,
        workspaceId: cfg?.workspaceId ?? null,
        keyPrefix: cfg?.apiKey ? cfg.apiKey.slice(0, 12) : null,
        folders: cfg?.folders ?? [],
      }))
      return
    }

    // POST /api/agent/config — write a fresh config (called after provision)
    // Body: { apiUrl, apiKey, workspaceId }
    if (req.method === 'POST' && url.pathname === '/api/agent/config') {
      readBody(req).then((body) => {
        const b = body as { apiUrl?: string; apiKey?: string; workspaceId?: string }
        if (!b.apiUrl || !b.apiKey || !b.workspaceId) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'apiUrl, apiKey, workspaceId required' }))
          return
        }
        const existing = readAgentConfig()
        const next: AgentConfigFile = {
          apiUrl: b.apiUrl,
          apiKey: b.apiKey,
          workspaceId: b.workspaceId,
          folders: existing?.folders ?? [],
          syncIntervalMs: existing?.syncIntervalMs ?? 5000,
          maxFileSizeMb: existing?.maxFileSizeMb ?? 50,
          logLevel: existing?.logLevel ?? 'info',
        }
        writeAgentConfig(next)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, path: AGENT_CONFIG_PATH }))
      }).catch((e) => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: (e as Error).message }))
      })
      return
    }

    // GET /api/agent/sources — list watched folders
    if (req.method === 'GET' && url.pathname === '/api/agent/sources') {
      const cfg = readAgentConfig()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ folders: cfg?.folders ?? [] }))
      return
    }

    // POST /api/agent/sources/watch — start following a single folder.
    // Body: { path: string, preset?: 'open'|'balanced'|'private',
    //         recursive?: boolean, includePatterns?: string[],
    //         excludePatterns?: string[] }
    // Mirror of /unwatch: the Auto-update toggle flips this on, which adds
    // the folder to the agent config (dedup by normalized path). The agent
    // hot-reloads on config change and picks up watching.
    if (req.method === 'POST' && url.pathname === '/api/agent/sources/watch') {
      readBody(req).then((body) => {
        const b = body as Partial<WatchFolder> & { path?: string }
        if (!b.path || typeof b.path !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'path (string) required' }))
          return
        }
        const existing = readAgentConfig()
        if (!existing) {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'No agent config — provision the Desktop Agent first' }))
          return
        }
        const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
        const target = norm(b.path)
        if (existing.folders.some((f) => norm(f.path) === target)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, alreadyWatched: true, path: b.path }))
          return
        }
        // Sensible defaults mirror the settings page — recursive, balanced
        // preset. Callers can override.
        const next: WatchFolder = {
          path: b.path,
          preset: (b.preset as WatchFolder['preset']) ?? 'balanced',
          recursive: b.recursive ?? true,
          includePatterns: b.includePatterns,
          excludePatterns: b.excludePatterns,
          cloudCopy: b.cloudCopy,
        }
        writeAgentConfig({ ...existing, folders: [...existing.folders, next] })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, added: b.path, total: existing.folders.length + 1 }))
      }).catch((e) => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: (e as Error).message }))
      })
      return
    }

    // POST /api/agent/sources/unwatch — stop following a single folder.
    // Body: { path: string }. This is the surgical cousin of PUT /sources:
    // the "Stop following" button in the web app calls this with the exact
    // folder the user is looking at, and we drop it from the watched list
    // without touching the other entries. The agent hot-reloads on config
    // changes so the effect is immediate.
    if (req.method === 'POST' && url.pathname === '/api/agent/sources/unwatch') {
      readBody(req).then((body) => {
        const b = body as { path?: string }
        if (!b.path || typeof b.path !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'path (string) required' }))
          return
        }
        const existing = readAgentConfig()
        if (!existing) {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'No agent config — nothing to unwatch' }))
          return
        }
        // Normalize separators so users can send forward- or back-slashed
        // paths and still match the stored form.
        const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
        const target = norm(b.path)
        const before = existing.folders.length
        const next = existing.folders.filter((f) => norm(f.path) !== target)
        if (next.length === before) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'path not in watched folders', path: b.path }))
          return
        }
        writeAgentConfig({ ...existing, folders: next })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, removed: b.path, remaining: next.length }))
      }).catch((e) => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: (e as Error).message }))
      })
      return
    }

    // PUT /api/agent/sources — replace the folders[] array wholesale
    // Body: { folders: WatchFolder[] }
    if (req.method === 'PUT' && url.pathname === '/api/agent/sources') {
      readBody(req).then((body) => {
        const b = body as { folders?: WatchFolder[] }
        if (!Array.isArray(b.folders)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'folders[] required' }))
          return
        }
        const existing = readAgentConfig()
        if (!existing) {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Provision an agent first — no config file exists' }))
          return
        }
        writeAgentConfig({ ...existing, folders: b.folders })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, count: b.folders.length }))
      }).catch((e) => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: (e as Error).message }))
      })
      return
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  })

  // ─── WebSocket server for live streaming ───
  const wss = new WebSocketServer({ server, path: '/ws' })

  const broadcast = (data: object) => {
    const msg = JSON.stringify(data)
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg)
      }
    })
  }

  // Expose broadcast for external use (traffic middleware, log pipes)
  ;(server as unknown as Record<string, unknown>).__wsBroadcast = broadcast
  ;(server as unknown as Record<string, unknown>).__wss = wss

  // Pipe API logs to WebSocket clients
  const lastLogIndex = { api: 0, agent: 0 }

  setInterval(() => {
    // Stream new API log lines
    const apiLogs = state.api.logs
    if (apiLogs.length > lastLogIndex.api) {
      const newLines = apiLogs.slice(lastLogIndex.api)
      lastLogIndex.api = apiLogs.length
      for (const line of newLines) {
        broadcast({ type: 'log', source: 'api', line })
      }
    }

    // Stream new Agent log lines
    const agentLogs = state.agent.logs
    if (agentLogs.length > lastLogIndex.agent) {
      const newLines = agentLogs.slice(lastLogIndex.agent)
      lastLogIndex.agent = agentLogs.length
      for (const line of newLines) {
        const source = line.includes('[ngrok]') ? 'ngrok' : 'agent'
        broadcast({ type: 'log', source, line })
      }
    }
  }, 1000)

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`  ! Dashboard port ${port} is already in use. Dashboard disabled.`)
      console.warn(`    (Kill the other process or change the port to enable monitoring.)`)
    } else {
      console.error(`  ! Dashboard server error:`, err.message)
    }
  })

  server.listen(port, () => {
    // Server started silently — launcher handles the log message
  })

  return server
}

/**
 * Connect the traffic emitter from the API middleware to the dashboard WebSocket.
 * Call this after both the API and dashboard server are started.
 */
export function connectTrafficStream(dashboardServer: ReturnType<typeof createServer>) {
  try {
    // Dynamic import to avoid circular dependency at startup
    const broadcast = (dashboardServer as unknown as Record<string, unknown>).__wsBroadcast as
      | ((data: object) => void)
      | undefined
    if (!broadcast) return

    // Listen for traffic events from the API middleware
    import('../packages/api/src/middleware/traffic-logger.js')
      .then(({ trafficEmitter }) => {
        trafficEmitter.on('traffic', (event: object) => {
          broadcast(event)
        })
      })
      .catch(() => {
        // Traffic emitter not available — running standalone
      })

    // Listen for index queue events so the dashboard Index tab can render
    // live progress without polling.
    import('../packages/api/src/services/indexing/index-queue.js')
      .then(({ indexQueueEvents }) => {
        indexQueueEvents.on('event', (event: object) => {
          broadcast({ type: 'index', event })
        })
      })
      .catch(() => {
        // Queue not available — running standalone
      })
  } catch {
    // Silently fail if traffic module unavailable
  }
}
