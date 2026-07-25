import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { healthRouter } from '../health'

const app = new Hono()
app.route('/api/health', healthRouter)

describe('Health endpoint cost data (WIRE-1)', () => {
  it('health response includes costs.today', async () => {
    const res = await app.request('/api/health')
    const body = (await res.json()) as any
    expect(body.costs).toBeDefined()
    expect(typeof body.costs.today).toBe('number')
  })

  it('health response includes costs.thisMonth', async () => {
    const res = await app.request('/api/health')
    const body = (await res.json()) as any
    expect(typeof body.costs.thisMonth).toBe('number')
  })

  it('health response includes costs.byModel array', async () => {
    const res = await app.request('/api/health')
    const body = (await res.json()) as any
    expect(Array.isArray(body.costs.byModel)).toBe(true)
  })

  it('health response includes mcp.toolMetrics array', async () => {
    const res = await app.request('/api/health')
    const body = (await res.json()) as any
    expect(Array.isArray(body.mcp.toolMetrics)).toBe(true)
    // Should have all 9 MCP tools
    expect(body.mcp.toolMetrics.length).toBeGreaterThanOrEqual(9)
    // Each metric has the required shape
    for (const m of body.mcp.toolMetrics) {
      expect(typeof m.name).toBe('string')
      expect(typeof m.calls).toBe('number')
      expect(typeof m.avgLatency).toBe('number')
      expect(typeof m.errors).toBe('number')
    }
  })
})
