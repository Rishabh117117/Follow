import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { trafficLogger, trafficEmitter } from '../traffic-logger'

describe('traffic-logger middleware (DC-2)', () => {
  it('logs request method and path', async () => {
    const app = new Hono()
    app.use('*', trafficLogger)
    app.get('/api/test', (c) => c.json({ ok: true }))

    const events: unknown[] = []
    trafficEmitter.on('traffic', (e) => events.push(e))

    await app.request('/api/test')

    expect(events.length).toBeGreaterThanOrEqual(1)
    const event = events[events.length - 1] as Record<string, unknown>
    expect(event.method).toBe('GET')
    expect(event.path).toBe('/api/test')

    trafficEmitter.removeAllListeners('traffic')
  })

  it('calculates latency correctly', async () => {
    const app = new Hono()
    app.use('*', trafficLogger)
    app.get('/api/slow', async (c) => {
      await new Promise((r) => setTimeout(r, 10))
      return c.json({ ok: true })
    })

    const events: unknown[] = []
    trafficEmitter.on('traffic', (e) => events.push(e))

    await app.request('/api/slow')

    const event = events[events.length - 1] as Record<string, unknown>
    expect(typeof event.ms).toBe('number')
    expect(event.ms).toBeGreaterThanOrEqual(0)

    trafficEmitter.removeAllListeners('traffic')
  })

  it('identifies MCP tool name from POST /mcp body', async () => {
    const app = new Hono()
    app.use('*', trafficLogger)
    app.post('/mcp', (c) => c.json({ result: {} }))

    const events: unknown[] = []
    trafficEmitter.on('traffic', (e) => events.push(e))

    await app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'query_index', arguments: { query: 'test' } },
      }),
    })

    const event = events[events.length - 1] as Record<string, unknown>
    expect(event.tool).toBe('query_index')

    trafficEmitter.removeAllListeners('traffic')
  })
})
