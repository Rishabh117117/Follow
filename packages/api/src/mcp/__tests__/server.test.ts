import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleMCPRequest } from '../server'
import type { MCPSession, JsonRpcRequest } from '../types'

// Mock tool modules
vi.mock('../tools/index', () => ({
  mcpTools: [
    {
      name: 'query_index',
      description: 'Query the knowledge index',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      handler: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Mock query result' }],
      }),
    },
    {
      name: 'set_scope',
      description: 'Set project scope',
      inputSchema: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'] },
      handler: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Scope set' }],
      }),
    },
    {
      name: 'save_conversation',
      description: 'Save a conversation',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Conversation saved' }],
      }),
    },
    {
      name: 'read_file',
      description: 'Read a file',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'File content' }],
      }),
    },
  ],
}))

function makeSession(overrides?: Partial<MCPSession>): MCPSession {
  return {
    userId: 'user-001',
    workspaceId: 'ws-001',
    activeProjectId: null,
    activeProjectScope: 'personal',
    connectedAt: new Date(),
    lastActivityAt: new Date(),
    ...overrides,
  }
}

function makeRequest(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: '2.0', id: 1, method, params }
}

const deps = { db: {} }

describe('MCP Server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles initialize and returns server info', async () => {
    const res = await handleMCPRequest(makeRequest('initialize'), makeSession(), deps)
    expect(res.error).toBeUndefined()
    const result = res.result as Record<string, unknown>
    expect(result.serverInfo).toEqual({ name: 'follow-mcp', version: '1.0.0' })
    expect(result.capabilities).toEqual({ tools: { listChanged: false } })
  })

  it('handles ping', async () => {
    const res = await handleMCPRequest(makeRequest('ping'), makeSession(), deps)
    expect(res.error).toBeUndefined()
  })

  it('lists all 4 tools', async () => {
    const res = await handleMCPRequest(makeRequest('tools/list'), makeSession(), deps)
    expect(res.error).toBeUndefined()
    const result = res.result as { tools: Array<{ name: string }> }
    expect(result.tools).toHaveLength(4)
    expect(result.tools.map((t) => t.name)).toEqual([
      'query_index',
      'set_scope',
      'save_conversation',
      'read_file',
    ])
  })

  it('each tool has description and inputSchema', async () => {
    const res = await handleMCPRequest(makeRequest('tools/list'), makeSession(), deps)
    const result = res.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> }
    for (const tool of result.tools) {
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeTruthy()
    }
  })

  it('dispatches tools/call to the correct handler', async () => {
    const res = await handleMCPRequest(
      makeRequest('tools/call', { name: 'query_index', arguments: { query: 'test' } }),
      makeSession(),
      deps
    )
    expect(res.error).toBeUndefined()
    const result = res.result as { content: Array<{ text: string }> }
    expect(result.content[0].text).toBe('Mock query result')
  })

  it('returns error for unknown tool', async () => {
    const res = await handleMCPRequest(
      makeRequest('tools/call', { name: 'nonexistent', arguments: {} }),
      makeSession(),
      deps
    )
    expect(res.error).toBeDefined()
    expect(res.error?.message).toContain('Unknown tool')
  })

  it('returns error for missing tool name', async () => {
    const res = await handleMCPRequest(
      makeRequest('tools/call', { arguments: {} }),
      makeSession(),
      deps
    )
    expect(res.error).toBeDefined()
    expect(res.error?.message).toContain('Missing required parameter')
  })

  it('returns error for unknown method', async () => {
    const res = await handleMCPRequest(makeRequest('unknown/method'), makeSession(), deps)
    expect(res.error).toBeDefined()
    expect(res.error?.code).toBe(-32601)
  })

  it('handles tools/call with missing params', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method: 'tools/call' }
    const res = await handleMCPRequest(req, makeSession(), deps)
    expect(res.error).toBeDefined()
    expect(res.error?.message).toContain('Missing params')
  })

  it('handles tool handler error gracefully', async () => {
    const { mcpTools } = await import('../tools/index')
    const handler = mcpTools[0].handler as ReturnType<typeof vi.fn>
    handler.mockRejectedValueOnce(new Error('Agent failed'))

    const res = await handleMCPRequest(
      makeRequest('tools/call', { name: 'query_index', arguments: { query: 'test' } }),
      makeSession(),
      deps
    )
    // Should return a result (not error) with isError flag
    expect(res.error).toBeUndefined()
    const result = res.result as { content: Array<{ text: string }>; isError: boolean }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Agent failed')
  })

  it('handles notifications/initialized', async () => {
    const res = await handleMCPRequest(makeRequest('notifications/initialized'), makeSession(), deps)
    expect(res.error).toBeUndefined()
  })
})
