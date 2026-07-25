/**
 * MCP REST Wrapper Tests (Sprint DEPLOY-1)
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'

// Must use vi.hoisted so the fn is available inside vi.mock factory
const mockHandler = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'mock result' }],
    isError: false,
  })
)

vi.mock('../../mcp/tools/index', () => ({
  mcpTools: [
    {
      name: 'query_index',
      description: 'Query the knowledge index',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      handler: mockHandler,
    },
    {
      name: 'detect_contradictions',
      description: 'Detect contradictions',
      inputSchema: {
        type: 'object',
        properties: { topic: { type: 'string' } },
      },
      handler: mockHandler,
    },
  ],
}))

// Mock transport session
vi.mock('../../mcp/transport', () => ({
  getOrCreateSession: vi.fn().mockResolvedValue({
    userId: 'test-user',
    workspaceId: 'test-ws',
    activeProjectId: null,
    activeProjectScope: 'personal',
    connectedAt: new Date(),
    lastActivityAt: new Date(),
    clientName: 'Test Client',
    transport: 'REST/OpenAPI',
    toolCalls: {},
  }),
  recordToolCall: vi.fn(),
}))

// Mock db
vi.mock('../../db/index', () => ({
  db: {},
}))

// security-gate-1: the REST wrapper guards the session workspace before
// getOrCreateSession; membership has its own tests — mock permissive here.
vi.mock('../../services/workspace-access', () => ({
  assertWorkspaceAccess: vi.fn().mockResolvedValue(null),
  checkWorkspaceAccess: vi.fn().mockResolvedValue({ ok: true, role: 'owner' }),
}))

// Mock auth middleware — pass through
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn().mockImplementation(async (_c: unknown, next: () => Promise<void>) => {
    await next()
  }),
}))

vi.mock('../../middleware/api-key-auth', () => ({
  createFlexAuthMiddleware:
    () => async (c: { set: (key: string, val: string) => void }, next: () => Promise<void>) => {
      c.set('userId', 'test-user')
      c.set('workspaceId', 'test-ws')
      await next()
    },
}))

import { Hono } from 'hono'
import { mcpRestRouter } from '../mcp-rest'
import { mcpRestOpenApiRouter } from '../mcp-rest-openapi'

const app = new Hono()
app.route('/api/mcp-rest', mcpRestRouter)
app.route('/api/mcp-rest', mcpRestOpenApiRouter)

describe('MCP REST Wrappers', () => {
  beforeAll(() => {
    vi.clearAllMocks()
  })

  it('POST /query-index — passes through to MCP tool handler', async () => {
    const res = await app.request('/api/mcp-rest/query-index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test query' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { content: Array<{ text: string }> } }
    expect(body.data.content[0].text).toBe('mock result')
    expect(mockHandler).toHaveBeenCalled()
  })

  it('POST /detect-contradictions — works with no body', async () => {
    mockHandler.mockClear()
    const res = await app.request('/api/mcp-rest/detect-contradictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(200)
    expect(mockHandler).toHaveBeenCalled()
  })

  it('GET /openapi.json — returns valid OpenAPI 3.0 spec', async () => {
    const res = await app.request('/api/mcp-rest/openapi.json')
    expect(res.status).toBe(200)

    const spec = (await res.json()) as {
      openapi: string
      info: { title: string }
      paths: Record<string, unknown>
    }
    expect(spec.openapi).toBe('3.0.0')
    expect(spec.info.title).toBe('Follow Index API')
    expect(spec.paths['/api/mcp-rest/query-index']).toBeDefined()
    expect(spec.paths['/api/mcp-rest/detect-contradictions']).toBeDefined()
  })

  it('OPTIONS returns CORS headers', async () => {
    const res = await app.request('/api/mcp-rest/query-index', {
      method: 'OPTIONS',
    })

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
  })

  it('POST responses include CORS headers', async () => {
    const res = await app.request('/api/mcp-rest/query-index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test' }),
    })

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('ngrok-skip-browser-warning')).toBe('true')
  })

  it('handles tool errors gracefully', async () => {
    mockHandler.mockRejectedValueOnce(new Error('Tool failed'))

    const res = await app.request('/api/mcp-rest/query-index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test' }),
    })

    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Tool failed')
  })
})
