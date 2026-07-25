/**
 * Follow — One-Click Launcher (Sprint LAUNCH-1)
 *
 * Starts all services in sequence and opens the monitoring dashboard.
 * Usage: npx tsx scripts/launch.ts
 */

import { spawn, execSync, type ChildProcess } from 'child_process'
import { createServer } from 'net'
import { resolve, join } from 'path'
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  createWriteStream,
} from 'fs'
import { randomBytes } from 'crypto'
import { config as loadDotenv } from 'dotenv'

// STABILIZE-1: load packages/api/.env.local BEFORE spawning children.
// Without this, process.env.DATABASE_URL is undefined and the API's
// db/index.ts module body (hoisted before its own dotenv call via ESM
// import-order) falls back to PGlite, which leaves the running API
// pointed at an ephemeral in-process DB instead of the real Postgres.
loadDotenv({ path: resolve('packages/api/.env.local') })
loadDotenv({ path: resolve('.env') })

// ─── ANSI Colors ──────────────────────────────────────────────────

const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

function ok(msg: string) {
  console.info(`  ${GREEN}✓${RESET} ${msg}`)
}
function warn(msg: string) {
  console.info(`  ${YELLOW}!${RESET} ${msg}`)
}
function fail(msg: string) {
  console.info(`  ${RED}✗${RESET} ${msg}`)
}
function info(msg: string) {
  console.info(`  ${DIM}${msg}${RESET}`)
}

// ─── State ────────────────────────────────────────────────────────

export interface LaunchState {
  docker: { status: 'starting' | 'running' | 'error' | 'skipped'; containers: string[] }
  postgres: { status: 'waiting' | 'ready' | 'error' }
  redis: { status: 'waiting' | 'ready' | 'error' }
  api: { status: 'starting' | 'running' | 'error'; port: number; logs: string[] }
  web: { status: 'starting' | 'running' | 'error'; port: number; logs: string[] }
  ngrok: { status: 'starting' | 'running' | 'error' | 'skipped'; url: string | null }
  agent: {
    status: 'starting' | 'running' | 'error' | 'skipped'
    filesWatched: number
    logs: string[]
  }
  dashboard: { status: 'running'; port: number }
  mcp: { tools: number; connected: boolean }
  startedAt: Date
}

export const state: LaunchState = {
  docker: { status: 'starting', containers: [] },
  postgres: { status: 'waiting' },
  redis: { status: 'waiting' },
  api: { status: 'starting', port: 3001, logs: [] },
  web: { status: 'starting', port: 3009, logs: [] },
  ngrok: { status: 'starting', url: null },
  agent: { status: 'starting', filesWatched: 0, logs: [] },
  dashboard: { status: 'running', port: 4000 },
  mcp: { tools: 9, connected: false },
  startedAt: new Date(),
}

const children: ChildProcess[] = []

// LAUNCHER-LOG-BUFFER-1 (2026-04-23): tee API stdout+stderr to disk alongside
// the in-memory ring buffer. The ring buffer (100 lines; see pushLog below)
// remains the dashboard's read source at `/api/logs/api`; this stream is the
// diagnostic surface so startup lines ([Startup] X scheduler started / gated
// off, mount-time logs) survive past the dashboard's polling window.
// Opens at module load — before any `spawnApiServer()` call — so the very
// first stdout line from the API child is already capturable.
const LOG_DIR = resolve('logs')
const API_LOG_PATH = join(LOG_DIR, 'api.log')
mkdirSync(LOG_DIR, { recursive: true })
const apiLogStream = createWriteStream(API_LOG_PATH, { flags: 'a' })

function teeApiLine(line: string) {
  const ts = new Date().toISOString()
  apiLogStream.write(`[${ts}] ${line}\n`)
}

function pushLog(target: string[], line: string) {
  target.push(line)
  if (target.length > 100) target.shift()
}

// ─── Dashboard token (shared secret between launcher-served HTML and API) ─

const DASHBOARD_TOKEN_PATH = resolve('data', '.dashboard-token')

function ensureDashboardToken(): string {
  // Already in env? use it.
  if (process.env.DASHBOARD_TOKEN) return process.env.DASHBOARD_TOKEN
  try {
    if (!existsSync(resolve('data'))) mkdirSync(resolve('data'), { recursive: true })
  } catch {
    /* swallowed: mkdir race is non-fatal — next read attempt will surface a real error */
  }
  // File cache
  if (existsSync(DASHBOARD_TOKEN_PATH)) {
    try {
      const tok = readFileSync(DASHBOARD_TOKEN_PATH, 'utf-8').trim()
      if (tok) {
        process.env.DASHBOARD_TOKEN = tok
        return tok
      }
    } catch {
      /* swallowed: cached token unreadable — fall through to generate a new one */
    }
  }
  // Generate new
  const tok = randomBytes(24).toString('base64url')
  try {
    writeFileSync(DASHBOARD_TOKEN_PATH, tok, { mode: 0o600 })
  } catch (err) {
    warn('Could not persist dashboard token: ' + (err as Error).message)
  }
  process.env.DASHBOARD_TOKEN = tok
  return tok
}

// ─── Helpers ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitFor(
  check: () => Promise<boolean>,
  label: string,
  maxMs = 30000,
  intervalMs = 2000
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    try {
      if (await check()) return true
    } catch {
      /* retry */
    }
    await sleep(intervalMs)
  }
  fail(`${label} timed out after ${maxMs / 1000}s`)
  return false
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for future port-conflict checks
function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createServer()
    socket.once('error', () => resolve(false))
    socket.once('listening', () => {
      socket.close(() => resolve(true))
    })
    socket.listen(port)
  })
}

function killPortProcess(port: number): void {
  try {
    // Windows: find PID listening on port and kill entire process tree
    const result = execSync(`cmd.exe /c "netstat -ano | findstr :${port} | findstr LISTENING"`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    })
    const lines = result.trim().split('\n')
    const pids = new Set<string>()
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      const pid = parts[parts.length - 1]
      if (pid && pid !== '0' && /^\d+$/.test(pid)) pids.add(pid)
    }
    for (const pid of pids) {
      try {
        execSync(`cmd.exe /c "taskkill /PID ${pid} /T /F"`, { stdio: 'ignore' })
        info(`Killed process tree ${pid} on port ${port}`)
      } catch {
        /* already dead */
      }
    }
  } catch {
    // No process found on port — good
  }
}

/** Ports owned by the API process (killed on restart) */
const API_PORTS = [3001, 3002, 3003]
/** All ports the launcher manages (killed only on initial startup) */
const ALL_LAUNCHER_PORTS = [3001, 3002, 3003, 3009, 4000]

function freeApiPorts(): void {
  for (const port of API_PORTS) {
    killPortProcess(port)
  }
}

function freeRequiredPorts(): void {
  for (const port of ALL_LAUNCHER_PORTS) {
    killPortProcess(port)
  }
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`where ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// ─── Launch Steps ─────────────────────────────────────────────────

async function startDocker(): Promise<boolean> {
  info('Starting Docker containers...')
  try {
    execSync('docker compose up -d', { stdio: 'pipe', cwd: resolve('.'), timeout: 60000 })
    state.docker.status = 'running'
    state.docker.containers = ['postgres', 'redis', 'clickhouse', 'minio']
    ok('Docker containers started')
    return true
  } catch (err) {
    state.docker.status = 'error'
    warn('Docker Desktop is not running. Continuing with in-memory fallbacks.')
    warn('To use real databases, start Docker Desktop and restart the launcher.')
    state.postgres.status = 'error'
    state.redis.status = 'error'
    return false
  }
}

async function waitForPostgres(): Promise<void> {
  info('Waiting for PostgreSQL...')
  const ready = await waitFor(async () => {
    try {
      execSync('docker exec workspace_postgres pg_isready -q', { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }, 'PostgreSQL')

  if (ready) {
    state.postgres.status = 'ready'
    ok('PostgreSQL ready')
  } else {
    state.postgres.status = 'error'
  }
}

async function waitForRedis(): Promise<void> {
  info('Waiting for Redis...')
  const ready = await waitFor(async () => {
    return new Promise<boolean>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/consistent-type-imports -- runtime-only require; top-level import would bundle the net module unnecessarily
      const net = require('net') as typeof import('net')
      const client = net.connect(6379, '127.0.0.1', () => {
        client.end()
        resolve(true)
      })
      client.on('error', () => resolve(false))
      setTimeout(() => {
        client.destroy()
        resolve(false)
      }, 1000)
    })
  }, 'Redis')

  if (ready) {
    state.redis.status = 'ready'
    ok('Redis ready')
  } else {
    state.redis.status = 'error'
  }
}

let apiRestartCount = 0
const API_MAX_RESTARTS = 3

function spawnApiServer(): ChildProcess {
  const child = spawn('npx', ['tsx', 'packages/api/src/index.ts'], {
    cwd: resolve('.'),
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
  })
  children.push(child)

  child.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) {
      pushLog(state.api.logs, line)
      teeApiLine(line)
    }
  })
  child.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) {
      pushLog(state.api.logs, line)
      teeApiLine(line)
    }
  })
  child.on('exit', (code) => {
    if (state.api.status === 'running' && !shuttingDown) {
      apiRestartCount++
      if (apiRestartCount > API_MAX_RESTARTS) {
        fail(`API server crashed ${apiRestartCount} times — giving up. Check logs above.`)
        state.api.status = 'error'
        return
      }
      warn(
        `API server exited with code ${code} — restarting (attempt ${apiRestartCount}/${API_MAX_RESTARTS})...`
      )
      // Log last 10 lines to help debug
      const recentLogs = state.api.logs.slice(-10)
      for (const line of recentLogs) {
        console.info(`    ${DIM}${line}${RESET}`)
      }
      state.api.status = 'starting'
      setTimeout(() => {
        if (!shuttingDown) {
          // Free API ports only (NOT web app port 3009) before restart
          freeApiPorts()
          sleep(1000).then(() => {
            spawnApiServer()
            waitFor(
              async () => {
                try {
                  const r = await fetch('http://localhost:3001/health')
                  return r.ok
                } catch {
                  return false
                }
              },
              'API restart',
              30000
            ).then((ready) => {
              if (ready) {
                state.api.status = 'running'
                apiRestartCount = 0 // reset on successful recovery
              }
            })
          })
        }
      }, 2000)
    }
  })

  return child
}

let shuttingDown = false

async function startApiServer(): Promise<void> {
  info('Starting API server...')
  state.api.status = 'starting'

  // Kill any leftover processes from previous runs
  freeRequiredPorts()
  await sleep(1000) // Give OS time to release ports

  spawnApiServer()

  // Wait for health
  const ready = await waitFor(
    async () => {
      try {
        const res = await fetch('http://localhost:3001/health')
        return res.ok
      } catch {
        return false
      }
    },
    'API server',
    45000
  )

  if (ready) {
    state.api.status = 'running'
    ok('API server running on :3001')
  } else {
    state.api.status = 'error'
  }
}

async function startWebApp(): Promise<void> {
  info('Starting Next.js web app...')
  state.web.status = 'starting'

  const child = spawn('npx', ['next', 'dev', '--port', '3009'], {
    cwd: resolve('apps/web'),
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
  })
  children.push(child)

  child.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) pushLog(state.web.logs, line)
  })
  child.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) pushLog(state.web.logs, line)
  })
  child.on('exit', (code) => {
    if (state.web.status === 'running') {
      state.web.status = 'error'
      fail(`Web app exited with code ${code}`)
    }
  })

  // Wait for Next.js to be ready (can take 15-30s on first compile)
  const ready = await waitFor(
    async () => {
      try {
        const res = await fetch('http://localhost:3009')
        return res.ok || res.status === 200 || res.status === 307 || res.status === 302
      } catch {
        return false
      }
    },
    'Next.js web app',
    60000,
    3000
  )

  if (ready) {
    state.web.status = 'running'
    ok('Web app running on :3009')
  } else {
    state.web.status = 'error'
    warn('Web app may still be compiling. Check :3009 in a moment.')
  }
}

function resolveNgrokPath(): string | null {
  if (commandExists('ngrok')) return 'ngrok'
  const localApp = process.env.LOCALAPPDATA
  if (!localApp) return null
  const pkgRoot = join(localApp, 'Microsoft', 'WinGet', 'Packages')
  if (!existsSync(pkgRoot)) return null
  try {
    for (const entry of readdirSync(pkgRoot)) {
      if (entry.toLowerCase().startsWith('ngrok.ngrok')) {
        const candidate = join(pkgRoot, entry, 'ngrok.exe')
        if (existsSync(candidate)) return candidate
      }
    }
  } catch {
    /* swallowed: npm root probe failed — caller falls through to global npx resolution */
  }
  return null
}

function extractTokenFromYml(contents: string): string | null {
  // Matches `authtoken: <token>` or `authtoken=<token>`
  const m = contents.match(/authtoken\s*[:=]\s*(\S+)/)
  return m ? m[1].trim() : null
}

function readNgrokAuthtoken(): string | null {
  if (process.env.NGROK_AUTHTOKEN) return process.env.NGROK_AUTHTOKEN

  const candidates: string[] = []
  if (process.env.LOCALAPPDATA)
    candidates.push(join(process.env.LOCALAPPDATA, 'ngrok', 'ngrok.yml'))
  if (process.env.USERPROFILE)
    candidates.push(join(process.env.USERPROFILE, 'AppData', 'Local', 'ngrok', 'ngrok.yml'))
  candidates.push(resolve('.ngrok-authtoken')) // project-local cache fallback

  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue
      const body = readFileSync(p, 'utf8')
      const tok = p.endsWith('.ngrok-authtoken') ? body.trim() : extractTokenFromYml(body)
      if (tok) {
        // Cache to project dir so future launches never depend on AppData access
        const cachePath = resolve('.ngrok-authtoken')
        try {
          if (!existsSync(cachePath)) writeFileSync(cachePath, tok, { mode: 0o600 })
        } catch {
          /* swallowed: cache write failure is non-fatal — token still returned from memory */
        }
        return tok
      }
    } catch {
      /* swallowed: candidate file unreadable — try the next candidate */
    }
  }
  return null
}

async function startNgrok(): Promise<void> {
  let ngrokBin = resolveNgrokPath()

  if (!ngrokBin) {
    info('ngrok not found. Auto-installing via winget...')
    try {
      execSync(
        'winget install --id Ngrok.Ngrok --accept-source-agreements --accept-package-agreements --silent',
        { stdio: 'ignore', timeout: 180000 }
      )
    } catch {
      state.ngrok.status = 'skipped'
      warn('ngrok auto-install failed. Local-only mode. Install manually: winget install ngrok')
      return
    }
    ngrokBin = resolveNgrokPath()
    if (!ngrokBin) {
      state.ngrok.status = 'skipped'
      warn('ngrok installed but could not be located. Restart shell, then re-run for tunnel.')
      return
    }
    ok('ngrok installed successfully')
    // winget ships an old ngrok (3.3.1) — self-update so the tunnel actually connects
    try {
      info('Updating ngrok to latest version...')
      execSync(`"${ngrokBin}" update`, { stdio: 'ignore', timeout: 120000 })
      ok('ngrok updated')
    } catch {
      warn('ngrok self-update failed (non-fatal). Tunnel may fail if version is too old.')
    }
  }

  const authtoken = readNgrokAuthtoken()
  if (!authtoken) {
    state.ngrok.status = 'skipped'
    warn('ngrok has no authtoken — tunnel skipped. Local-only mode.')
    warn('  1. Get token: https://dashboard.ngrok.com/get-started/your-authtoken')
    warn(`  2. Run: ngrok config add-authtoken <YOUR_TOKEN>`)
    warn('  (or set NGROK_AUTHTOKEN env var, or drop token in .ngrok-authtoken)')
    return
  }

  info('Starting ngrok tunnel...')
  state.ngrok.status = 'starting'

  // Pass --authtoken explicitly so we don't depend on ngrok's config file lookup
  // (some Windows shells see AppData differently than the subprocess does).
  const child = spawn(
    ngrokBin,
    ['http', '3001', '--authtoken', authtoken, '--log=stdout', '--log-format=json'],
    {
      stdio: 'pipe',
      shell: false,
    }
  )
  children.push(child)

  let authError = false
  child.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) {
      pushLog(state.api.logs, `[ngrok] ${line}`)
      teeApiLine(`[ngrok] ${line}`)
    }
    if (
      line.includes('ERR_NGROK_4018') ||
      line.includes('ERR_NGROK_121') ||
      line.includes('authentication failed')
    ) {
      authError = true
    }
  })

  await sleep(3000)
  const ready = await waitFor(
    async () => {
      if (authError) return false
      try {
        const res = await fetch('http://localhost:4040/api/tunnels')
        const body = (await res.json()) as { tunnels: Array<{ public_url: string }> }
        const tunnel = body.tunnels?.find((t) => t.public_url.startsWith('https://'))
        if (tunnel) {
          state.ngrok.url = tunnel.public_url
          return true
        }
        return false
      } catch {
        return false
      }
    },
    'ngrok tunnel',
    15000
  )

  if (ready) {
    state.ngrok.status = 'running'
    ok(`Tunnel active: ${CYAN}${state.ngrok.url}${RESET}`)
  } else if (authError) {
    state.ngrok.status = 'error'
    warn('ngrok auth/version failed. Try: ngrok update  (or re-add authtoken)')
  } else {
    state.ngrok.status = 'error'
    warn('ngrok tunnel failed to start. Continuing without tunnel.')
  }
}

let agentRestartCount = 0
const AGENT_MAX_RESTARTS = 5

function spawnAgent(agentDir: string): ChildProcess {
  const child = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: agentDir,
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
  })
  children.push(child)

  child.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) {
      pushLog(state.agent.logs, line)
      const match = line.match(/(\d+) files? found/)
      if (match) state.agent.filesWatched = parseInt(match[1], 10)
    }
  })
  child.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) pushLog(state.agent.logs, line)
  })

  child.on('exit', (code) => {
    if (shuttingDown) return
    // Clean exit(0) is the hot-reload signal from the agent itself — always respawn.
    // Crash exit (non-zero) — respawn up to AGENT_MAX_RESTARTS.
    const isHotReload = code === 0
    if (!isHotReload) {
      agentRestartCount++
      if (agentRestartCount > AGENT_MAX_RESTARTS) {
        fail(`Desktop agent crashed ${agentRestartCount} times — giving up.`)
        state.agent.status = 'error'
        return
      }
      warn(
        `Desktop agent exited ${code} — restarting (${agentRestartCount}/${AGENT_MAX_RESTARTS})...`
      )
    } else {
      info('Desktop agent restarting to pick up new config...')
    }
    state.agent.status = 'starting'
    setTimeout(() => {
      if (!shuttingDown) spawnAgent(agentDir)
    }, 1500)
  })

  return child
}

async function startDesktopAgent(): Promise<void> {
  const agentDir = resolve('apps/desktop-agent')
  const configPath = resolve(agentDir, 'follow-agent.config.json')

  if (!existsSync(configPath)) {
    state.agent.status = 'skipped'
    warn(
      'Desktop agent config not found. Create apps/desktop-agent/follow-agent.config.json to enable.'
    )
    return
  }

  info('Starting desktop agent...')
  state.agent.status = 'starting'

  spawnAgent(agentDir)

  // Wait for agent to connect
  const ready = await waitFor(
    async () => {
      return state.agent.logs.some(
        (l) => l.includes('Connected') || l.includes('Initial scan') || l.includes('files found')
      )
    },
    'Desktop agent',
    15000,
    1000
  )

  if (ready) {
    state.agent.status = 'running'
    ok(`Desktop agent watching ${YELLOW}${state.agent.filesWatched || '?'}${RESET} files`)
  } else {
    state.agent.status = 'error'
    warn('Desktop agent may not have started correctly')
  }
}

async function startDashboard(): Promise<void> {
  // Dynamic import of dashboard server
  const { startDashboardServer } = await import('./dashboard-server.js')
  startDashboardServer(state, 4000)
  ok(`Dashboard: ${CYAN}http://localhost:4000${RESET}`)
}

function openBrowser(url: string) {
  try {
    spawn('cmd', ['/c', 'start', url], { shell: true, stdio: 'ignore' })
  } catch {
    /* non-fatal */
  }
}

// ─── Shutdown ─────────────────────────────────────────────────────

function shutdown() {
  shuttingDown = true
  console.info('')
  info('Shutting down...')

  for (const child of children) {
    try {
      child.kill('SIGTERM')
    } catch {
      /* already exited */
    }
  }

  // Force kill any remaining after 3s
  setTimeout(() => {
    for (const child of children) {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already exited */
      }
    }
    console.info('')
    ok('Follow stopped. Docker containers still running (docker compose down to stop).')
    process.exit(0)
  }, 3000)
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  console.info('')
  console.info('  ┌─────────────────────────────────────────┐')
  console.info('  │  Follow — Starting all services...      │')
  console.info('  └─────────────────────────────────────────┘')
  console.info('')

  // Make the dashboard token available to all children (API reads it for
  // the /api/models PUT / /api/openrouter/refresh / cancel endpoints, and
  // the dashboard server embeds it in the served HTML).
  ensureDashboardToken()

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  try {
    // Clean up any leftover processes from previous runs
    info('Cleaning up stale processes...')
    freeRequiredPorts()
    await sleep(1000)

    const dockerUp = await startDocker()
    if (dockerUp) {
      await Promise.all([waitForPostgres(), waitForRedis()])
    } else {
      info('Skipping Postgres/Redis waits (no Docker). API will use in-memory fallbacks.')
    }
    await startApiServer()
    await startWebApp()
    await startNgrok()
    await startDesktopAgent()
    await startDashboard()

    // Open both dashboard and web app
    openBrowser('http://localhost:4000')
    await sleep(500) // Small delay so the second tab opens after the first
    openBrowser('http://localhost:3009')

    console.info('')
    console.info('  ┌─────────────────────────────────────────────────┐')
    console.info('  │  Follow — All services running                  │')
    console.info('  │                                                 │')
    console.info(`  │  Web App:    ${CYAN}http://localhost:3009${RESET}              │`)
    console.info(`  │  Dashboard:  ${CYAN}http://localhost:4000${RESET}              │`)
    console.info(`  │  API:        ${CYAN}http://localhost:3001${RESET}              │`)
    if (state.ngrok.url) {
      const urlPadded = state.ngrok.url.padEnd(34)
      console.info(`  │  MCP:        ${CYAN}${urlPadded}${RESET}│`)
    }
    console.info('  │                                                 │')
    console.info('  │  Press Ctrl+C to stop all services              │')
    console.info('  └─────────────────────────────────────────────────┘')
    console.info('')
  } catch (err) {
    fail(`Startup failed: ${(err as Error).message}`)
    console.info('')
    console.info(`  ${YELLOW}The launcher will stay open so you can see the error.${RESET}`)
    console.info(`  ${DIM}Press Ctrl+C to exit.${RESET}`)
    console.info('')
    // Keep process alive so terminal window stays open
    await new Promise(() => {
      /* never resolves */
    })
  }
}

main()
