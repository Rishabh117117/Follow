import { createMiddleware } from 'hono/factory'
import { EventEmitter } from 'events'

export interface TrafficEvent {
  type: 'traffic'
  time: string
  method: string
  path: string
  tool: string | null
  status: number
  ms: number
  client: string | null
}

export const trafficEmitter = new EventEmitter()
trafficEmitter.setMaxListeners(50)

function extractMcpTool(path: string, body?: string): string | null {
  if (path === '/mcp' && body) {
    try {
      const parsed = JSON.parse(body)
      if (parsed.params?.name) return parsed.params.name
      // eslint-disable-next-line no-empty
    } catch {
      /* swallowed: non-JSON body — skip tool extraction, fall through to null */
    }
  }
  return null
}

function extractClient(headers: Record<string, string | undefined>): string | null {
  const ua = headers['user-agent'] || ''
  if (ua.includes('Claude')) return 'Claude'
  if (ua.includes('ChatGPT') || ua.includes('OpenAI')) return 'ChatGPT'
  if (ua.includes('Follow')) return 'Follow'
  const apiKey = headers['x-api-key']
  if (apiKey) return 'API Key: ' + apiKey.slice(0, 8) + '...'
  return null
}

export const trafficLogger = createMiddleware(async (c, next) => {
  const start = Date.now()
  const method = c.req.method
  const path = c.req.path

  // Skip health/status polling to reduce noise
  if (path === '/api/health' || path === '/health' || path === '/api/status') {
    await next()
    return
  }

  let bodyText: string | undefined
  if (method === 'POST' && path === '/mcp') {
    try {
      bodyText = await c.req.raw.clone().text()
      // eslint-disable-next-line no-empty
    } catch {
      /* swallowed: body read failure is non-fatal — we log the request without a tool name */
    }
  }

  await next()

  const ms = Date.now() - start
  const now = new Date()
  const timeStr =
    now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0')

  const event: TrafficEvent = {
    type: 'traffic',
    time: timeStr,
    method,
    path,
    tool: extractMcpTool(path, bodyText),
    status: c.res.status,
    ms,
    client: extractClient(
      Object.fromEntries([...c.req.raw.headers.entries()].map(([k, v]) => [k, v]))
    ),
  }

  trafficEmitter.emit('traffic', event)
})
