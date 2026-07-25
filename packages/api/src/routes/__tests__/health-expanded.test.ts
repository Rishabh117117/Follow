import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { healthRouter } from '../health'

// Create a minimal app with the health router
const app = new Hono()
app.route('/api/health', healthRouter)

describe('health endpoint (expanded DC-1)', () => {
  it('health response includes mcp.clients array', async () => {
    const res = await app.request('/api/health')
    const body = await res.json()
    expect(body.mcp).toBeDefined()
    expect(Array.isArray(body.mcp.clients)).toBe(true)
  })

  it('health response includes index.rawFiles count', async () => {
    const res = await app.request('/api/health')
    const body = await res.json()
    expect(body.index).toBeDefined()
    expect(typeof body.index.rawFiles).toBe('number')
  })

  it('health response includes index.edges count', async () => {
    const res = await app.request('/api/health')
    const body = await res.json()
    expect(body.index).toBeDefined()
    expect(typeof body.index.edges).toBe('number')
  })

  it('health response includes config.publicUrl', async () => {
    const res = await app.request('/api/health')
    const body = await res.json()
    expect(body.config).toBeDefined()
    expect('publicUrl' in body.config).toBe(true)
  })
})
