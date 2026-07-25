/* eslint-disable @typescript-eslint/no-explicit-any -- mock-heavy test file */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Mock auth middleware to bypass authentication
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn().mockImplementation(async (c: any, next: any) => {
    c.set('userId', 'test-user-001')
    c.set('workspaceId', 'test-ws-001')
    await next()
  }),
}))

vi.mock('../../middleware/api-key-auth', () => ({
  createFlexAuthMiddleware: vi.fn().mockImplementation((_authMw: any) => {
    return async (c: any, next: any) => {
      c.set('userId', 'test-user-001')
      c.set('workspaceId', 'test-ws-001')
      await next()
    }
  }),
  apiKeyAuthMiddleware: vi.fn(),
}))

// security-gate-1: the /mcp handlers guard the session workspace before
// getOrCreateSession; membership has its own tests — mock permissive here.
vi.mock('../../services/workspace-access', () => ({
  assertWorkspaceAccess: vi.fn().mockResolvedValue(null),
  checkWorkspaceAccess: vi.fn().mockResolvedValue({ ok: true, role: 'owner' }),
}))

// Mock tools to avoid DB calls
vi.mock('../tools/index', () => ({
  mcpTools: [
    {
      name: 'query_index',
      description: 'Test tool',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      handler: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Test result' }],
      }),
    },
  ],
}))

// Mock DB import
vi.mock('../../db/index', () => ({
  db: {},
}))

describe('MCP Transport', () => {
  let app: Hono

  beforeEach(async () => {
    vi.clearAllMocks()
    // Re-import to get fresh module with mocks
    const { mcpRoutes } = await import('../transport')
    app = new Hono()
    app.route('/mcp', mcpRoutes)
  })

  describe('POST /mcp', () => {
    it('handles initialize request', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.jsonrpc).toBe('2.0')
      expect(body.id).toBe(1)
      expect(body.result.serverInfo.name).toBe('follow-mcp')
    })

    it('handles tools/list request', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.result.tools).toHaveLength(1)
      expect(body.result.tools[0].name).toBe('query_index')
    })

    it('routes tools/call to the correct handler', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'query_index', arguments: { query: 'test' } },
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.result.content[0].text).toBe('Test result')
    })

    it('rejects invalid JSON', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error.code).toBe(-32700)
    })

    it('rejects invalid JSON-RPC structure', async () => {
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foo: 'bar' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error.code).toBe(-32600)
    })
  })

  describe('GET /mcp', () => {
    it('returns SSE stream headers', async () => {
      const controller = new AbortController()
      const res = await app.request('/mcp', {
        method: 'GET',
        signal: controller.signal,
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')

      // Abort the stream to clean up
      controller.abort()
    })
  })
})
