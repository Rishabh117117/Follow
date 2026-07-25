/**
 * MCP SSE Transport (Sprint MCP-1 → WIRE-1)
 *
 * Hono route group providing SSE transport for the MCP protocol.
 * - GET /  → SSE stream for server→client messages
 * - POST / → JSON-RPC request/response for client→server messages
 *
 * WIRE-1 additions:
 * - Session map tracks clientName, transport, and per-tool metrics
 * - Tool invocations increment count/latency/errors on the session
 * - getActiveClients() and getToolAggregates() expose data for /api/health
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { randomUUID } from 'crypto'
import { createFlexAuthMiddleware } from '../middleware/api-key-auth'
import { authMiddleware } from '../middleware/auth'
import { handleMCPRequest, SERVER_INFO } from './server'
import {
  openSession as openDbSession,
  closeSession as closeDbSession,
  heartbeatBySurface as heartbeatDbSession,
} from '../services/sessions'
import { getActiveProjectId } from '../services/mcp/active-project'
import type {
  MCPSession,
  JsonRpcRequest,
  MCPToolMetric,
  MCPClientInfo,
  MCPToolAggregate,
} from './types'
import { mcpTools } from './tools/index'

// ─── Session Management ────────────────────────────────────────────

const sessions = new Map<string, MCPSession>()
const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

function inferClientName(userAgent: string | undefined, referer: string | undefined): string {
  const ua = (userAgent || '').toLowerCase()
  if (ua.includes('claude') || (referer || '').includes('claude.ai')) return 'Claude'
  if (ua.includes('chatgpt') || ua.includes('openai') || (referer || '').includes('chatgpt.com'))
    return 'ChatGPT'
  if (ua.includes('follow-agent') || ua.includes('desktop-agent')) return 'Desktop Agent'
  if (ua.includes('follow')) return 'Follow'
  return 'Unknown Client'
}

function emptyToolMetric(): MCPToolMetric {
  return { count: 0, totalLatencyMs: 0, errors: 0, lastCalledAt: null }
}

async function getOrCreateSession(
  userId: string,
  workspaceId: string,
  opts: { clientName?: string; transport?: string } = {}
): Promise<MCPSession> {
  const key = `${userId}:${workspaceId}`
  const existing = sessions.get(key)

  if (existing) {
    existing.lastActivityAt = new Date()
    if (opts.clientName) existing.clientName = opts.clientName
    if (opts.transport) existing.transport = opts.transport
    return existing
  }

  // Hydrate the routing decision from `mcp_active_project`. Without this,
  // a server restart silently drops the user back to personal even though
  // they previously called set_scope. Read failure is non-fatal — we just
  // start at personal in that case.
  let activeProjectId: string | null = null
  try {
    activeProjectId = await getActiveProjectId(userId, workspaceId)
  } catch (err) {
    console.error('[mcp] getActiveProjectId failed; defaulting to personal:', err)
  }

  const session: MCPSession = {
    userId,
    workspaceId,
    activeProjectId,
    activeProjectScope: activeProjectId ? 'project' : 'personal',
    connectedAt: new Date(),
    lastActivityAt: new Date(),
    clientName: opts.clientName || 'Unknown Client',
    transport: opts.transport || 'MCP SSE',
    toolCalls: {},
  }
  sessions.set(key, session)
  return session
}

/** Record a single tool invocation on the session. */
export function recordToolCall(
  session: MCPSession,
  toolName: string,
  latencyMs: number,
  isError: boolean
): void {
  if (!session.toolCalls[toolName]) {
    session.toolCalls[toolName] = emptyToolMetric()
  }
  const m = session.toolCalls[toolName]!
  m.count++
  m.totalLatencyMs += latencyMs
  if (isError) m.errors++
  m.lastCalledAt = new Date()
  session.lastActivityAt = new Date()
}

// Periodic cleanup of expired sessions
setInterval(() => {
  const now = Date.now()
  for (const [key, session] of sessions) {
    if (now - session.lastActivityAt.getTime() > SESSION_TIMEOUT_MS) {
      sessions.delete(key)
    }
  }
}, 60_000)

// ─── Exported for REST wrapper + dashboard ────────────────────────

export { getOrCreateSession }

export function getSessionCount(): number {
  return sessions.size
}

export function getActiveClients(): MCPClientInfo[] {
  const clients: MCPClientInfo[] = []
  for (const session of sessions.values()) {
    const callCount = Object.values(session.toolCalls).reduce((sum, m) => sum + m.count, 0)
    clients.push({
      name: session.clientName,
      transport: session.transport,
      lastSeen: session.lastActivityAt.toISOString(),
      callCount,
      connectedAt: session.connectedAt.toISOString(),
    })
  }
  return clients
}

export function getToolAggregates(): MCPToolAggregate[] {
  // Aggregate across all sessions per tool name
  const agg = new Map<string, { count: number; totalLatencyMs: number; errors: number; lastCalledAt: Date | null }>()
  for (const session of sessions.values()) {
    for (const [toolName, m] of Object.entries(session.toolCalls)) {
      const cur = agg.get(toolName) ?? { count: 0, totalLatencyMs: 0, errors: 0, lastCalledAt: null }
      cur.count += m.count
      cur.totalLatencyMs += m.totalLatencyMs
      cur.errors += m.errors
      if (m.lastCalledAt && (!cur.lastCalledAt || m.lastCalledAt > cur.lastCalledAt)) {
        cur.lastCalledAt = m.lastCalledAt
      }
      agg.set(toolName, cur)
    }
  }
  // Ensure every registered tool appears (even with zero calls)
  return mcpTools.map((t) => {
    const m = agg.get(t.name)
    return {
      name: t.name,
      calls: m?.count ?? 0,
      avgLatency: m && m.count > 0 ? Math.round(m.totalLatencyMs / m.count) : 0,
      errors: m?.errors ?? 0,
      lastCalled: m?.lastCalledAt?.toISOString() ?? null,
    }
  })
}

/** Reset for testing */
export function resetSessionsForTesting(): void {
  sessions.clear()
}

// ─── Routes ────────────────────────────────────────────────────────

export const mcpRoutes = new Hono()

// DEPLOY-1: CORS for external MCP clients (Claude.ai, ChatGPT via tunnel)
mcpRoutes.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*')
  c.header('ngrok-skip-browser-warning', 'true')
  await next()
})

// OPTIONS — CORS preflight
mcpRoutes.options('*', (c) => {
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')
  c.header('Access-Control-Max-Age', '86400')
  return c.body(null, 204)
})

// Auth: supports both wsp_* API keys and session auth (x-user-id)
const flexAuth = createFlexAuthMiddleware(authMiddleware)
mcpRoutes.use('*', flexAuth)

/**
 * GET /mcp — SSE stream endpoint.
 */
mcpRoutes.get('/', async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = (c.get('workspaceId') as string) ?? ''
  const clientName = inferClientName(c.req.header('user-agent'), c.req.header('referer'))

  const session = await getOrCreateSession(userId, workspaceId, {
    clientName,
    transport: 'MCP SSE',
  })

  // Persisted session row — drives session.started/ended events that the
  // index queue subscribes to for Archivist + Profiler scheduling. We tie
  // the row to a per-connection uuid so reconnects/refreshes get their own
  // lifecycle (no ghost sessions).
  const surfaceClientId = `mcp-sse:${randomUUID()}`
  let dbSessionId: string | null = null
  if (workspaceId) {
    try {
      const dbRow = await openDbSession({
        userId,
        workspaceId,
        surface: 'mcp',
        surfaceClientId,
      })
      dbSessionId = dbRow.id
    } catch (err) {
      // Non-fatal — pipeline scheduling will miss this session, but the SSE
      // stream still works.
      console.error('[mcp] openDbSession failed:', err)
    }
  }

  c.header('Cache-Control', 'no-cache')
  c.header('X-Accel-Buffering', 'no')
  c.header('Access-Control-Expose-Headers', 'Content-Type')

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      data: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/server_info',
        params: {
          name: SERVER_INFO.name,
          version: SERVER_INFO.version,
        },
      }),
      event: 'message',
    })

    const keepaliveInterval = setInterval(async () => {
      try {
        await stream.writeSSE({ data: '', event: 'keepalive' })
      } catch {
        clearInterval(keepaliveInterval)
      }
    }, 30_000)

    try {
      await new Promise<void>((_resolve, reject) => {
        stream.onAbort(() => {
          clearInterval(keepaliveInterval)
          reject(new Error('Client disconnected'))
        })
      })
    } catch {
      // Expected: client disconnected
    } finally {
      clearInterval(keepaliveInterval)
      const key = `${session.userId}:${session.workspaceId}`
      sessions.delete(key)
      // Close the persisted session row — fires session.ended for the queue.
      if (dbSessionId) {
        await closeDbSession(dbSessionId, 'disconnect').catch((err) => {
          console.error('[mcp] closeDbSession failed:', err)
        })
      }
    }
  })
})

/**
 * POST /mcp — JSON-RPC request handler with per-tool metric tracking.
 */
mcpRoutes.post('/', async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = (c.get('workspaceId') as string) ?? ''
  const clientName = inferClientName(c.req.header('user-agent'), c.req.header('referer'))

  const session = await getOrCreateSession(userId, workspaceId, {
    clientName,
    transport: 'MCP SSE',
  })

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: invalid JSON' } },
      400
    )
  }

  const request = body as JsonRpcRequest

  if (!request.jsonrpc || request.jsonrpc !== '2.0' || !request.method) {
    return c.json(
      {
        jsonrpc: '2.0',
        id: request?.id ?? null,
        error: { code: -32600, message: 'Invalid JSON-RPC request' },
      },
      400
    )
  }

  const deps = { db: (await import('../db/index')).db }

  // WIRE-1: track tool call metrics
  const startedAt = Date.now()
  const response = await handleMCPRequest(request, session, deps)
  if (request.method === 'tools/call') {
    const toolName = (request.params?.['name'] as string) || 'unknown'
    const latency = Date.now() - startedAt
    const isError =
      !!response.error ||
      !!(response.result && typeof response.result === 'object' && (response.result as Record<string, unknown>)['isError'])
    recordToolCall(session, toolName, latency, isError)

    // Heartbeat the user's active MCP session row, if any. Best-effort —
    // a missing row just means this client never opened an SSE stream.
    if (workspaceId) {
      // We don't carry the SSE connection id on POST requests, so heartbeat
      // every active MCP session for this user. Cheap update, no cascade.
      heartbeatDbSession(userId, `mcp-rest:${workspaceId}`).catch(() => {
        /* ignore — REST-only callers don't have a persisted session yet */
      })
    }
  }

  return c.json(response)
})
