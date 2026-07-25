import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleMCPRequest } from '../server'
import type { MCPSession, JsonRpcRequest } from '../types'

// Mock all tool handlers to avoid DB calls
vi.mock('../tools/index', () => {
  const mockHandler = vi.fn()

  return {
    mcpTools: [
      { name: 'query_index', description: 'Query', inputSchema: {}, handler: mockHandler },
      { name: 'set_scope', description: 'Scope', inputSchema: {}, handler: mockHandler },
      { name: 'save_conversation', description: 'Save', inputSchema: {}, handler: mockHandler },
      { name: 'read_file', description: 'Read', inputSchema: {}, handler: mockHandler },
      {
        name: 'contribute',
        description: 'Contribute items to project',
        inputSchema: { type: 'object' },
        handler: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Contributed 3 items' }],
        }),
      },
      {
        name: 'send_message',
        description: 'Send message',
        inputSchema: { type: 'object' },
        handler: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Message sent' }],
        }),
      },
      {
        name: 'send_conversation',
        description: 'Send conversation',
        inputSchema: { type: 'object' },
        handler: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Conversation forwarded' }],
        }),
      },
      {
        name: 'get_activity',
        description: 'Get activity',
        inputSchema: { type: 'object' },
        handler: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Activity feed' }],
        }),
      },
      {
        name: 'detect_contradictions',
        description: 'Detect contradictions',
        inputSchema: { type: 'object' },
        handler: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'No contradictions found' }],
        }),
      },
    ],
  }
})

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

describe('MCP-2 Sharing Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists all 9 tools', async () => {
    const res = await handleMCPRequest(makeRequest('tools/list'), makeSession(), deps)
    const result = res.result as { tools: Array<{ name: string }> }
    expect(result.tools).toHaveLength(9)
    expect(result.tools.map((t) => t.name)).toContain('contribute')
    expect(result.tools.map((t) => t.name)).toContain('send_message')
    expect(result.tools.map((t) => t.name)).toContain('send_conversation')
    expect(result.tools.map((t) => t.name)).toContain('get_activity')
    expect(result.tools.map((t) => t.name)).toContain('detect_contradictions')
  })

  it('dispatches contribute tool call', async () => {
    const res = await handleMCPRequest(
      makeRequest('tools/call', { name: 'contribute', arguments: { scope_query: 'pricing' } }),
      makeSession({ activeProjectId: 'proj-1', activeProjectScope: 'project' }),
      deps
    )
    const result = res.result as { content: Array<{ text: string }> }
    expect(result.content[0].text).toBe('Contributed 3 items')
  })

  it('dispatches send_message tool call', async () => {
    const res = await handleMCPRequest(
      makeRequest('tools/call', {
        name: 'send_message',
        arguments: { to: 'Alice', content: 'Hello' },
      }),
      makeSession({ activeProjectId: 'proj-1' }),
      deps
    )
    const result = res.result as { content: Array<{ text: string }> }
    expect(result.content[0].text).toBe('Message sent')
  })

  it('dispatches send_conversation tool call', async () => {
    const res = await handleMCPRequest(
      makeRequest('tools/call', {
        name: 'send_conversation',
        arguments: {
          to: 'Bob',
          messages: [{ role: 'user', content: 'test' }],
        },
      }),
      makeSession({ activeProjectId: 'proj-1' }),
      deps
    )
    const result = res.result as { content: Array<{ text: string }> }
    expect(result.content[0].text).toBe('Conversation forwarded')
  })

  it('dispatches get_activity tool call', async () => {
    const res = await handleMCPRequest(
      makeRequest('tools/call', {
        name: 'get_activity',
        arguments: { since: 'today' },
      }),
      makeSession(),
      deps
    )
    const result = res.result as { content: Array<{ text: string }> }
    expect(result.content[0].text).toBe('Activity feed')
  })

  it('dispatches detect_contradictions tool call', async () => {
    const res = await handleMCPRequest(
      makeRequest('tools/call', {
        name: 'detect_contradictions',
        arguments: {},
      }),
      makeSession({ activeProjectId: 'proj-1' }),
      deps
    )
    const result = res.result as { content: Array<{ text: string }> }
    expect(result.content[0].text).toBe('No contradictions found')
  })

  it('returns error for unknown tool', async () => {
    const res = await handleMCPRequest(
      makeRequest('tools/call', { name: 'nonexistent_tool', arguments: {} }),
      makeSession(),
      deps
    )
    expect(res.error).toBeDefined()
    expect(res.error?.message).toContain('Unknown tool')
  })
})
