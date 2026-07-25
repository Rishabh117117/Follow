import { describe, it, expect, beforeEach } from 'vitest'
import {
  getOrCreateSession,
  recordToolCall,
  getActiveClients,
  getToolAggregates,
  getSessionCount,
  resetSessionsForTesting,
} from '../transport'

describe('MCP Session Tracking (WIRE-1)', () => {
  beforeEach(() => {
    resetSessionsForTesting()
  })

  it('session stores clientName and transport type', async () => {
    const session = await getOrCreateSession('user-1', 'ws-1', {
      clientName: 'Claude',
      transport: 'MCP SSE',
    })
    expect(session.clientName).toBe('Claude')
    expect(session.transport).toBe('MCP SSE')
    expect(session.toolCalls).toEqual({})
  })

  it('tool invocation increments call count', async () => {
    const session = await getOrCreateSession('user-1', 'ws-1', {
      clientName: 'Claude',
      transport: 'MCP SSE',
    })
    recordToolCall(session, 'query_index', 50, false)
    recordToolCall(session, 'query_index', 60, false)
    expect(session.toolCalls['query_index']!.count).toBe(2)
  })

  it('tool invocation tracks latency', async () => {
    const session = await getOrCreateSession('user-1', 'ws-1', {
      clientName: 'Claude',
      transport: 'MCP SSE',
    })
    recordToolCall(session, 'query_index', 100, false)
    recordToolCall(session, 'query_index', 200, false)
    expect(session.toolCalls['query_index']!.totalLatencyMs).toBe(300)
  })

  it('failed tool invocation increments error count', async () => {
    const session = await getOrCreateSession('user-1', 'ws-1', {
      clientName: 'Claude',
      transport: 'MCP SSE',
    })
    recordToolCall(session, 'query_index', 50, false)
    recordToolCall(session, 'query_index', 50, true)
    recordToolCall(session, 'query_index', 50, true)
    expect(session.toolCalls['query_index']!.errors).toBe(2)
    expect(session.toolCalls['query_index']!.count).toBe(3)
  })

  it('getActiveClients returns connected sessions with call counts', async () => {
    const s1 = await getOrCreateSession('user-1', 'ws-1', { clientName: 'Claude', transport: 'MCP SSE' })
    const s2 = await getOrCreateSession('user-2', 'ws-1', { clientName: 'ChatGPT', transport: 'REST/OpenAPI' })
    recordToolCall(s1, 'query_index', 10, false)
    recordToolCall(s1, 'read_file', 20, false)
    recordToolCall(s2, 'query_index', 15, false)

    const clients = getActiveClients()
    expect(clients).toHaveLength(2)
    const claude = clients.find((c) => c.name === 'Claude')
    const chatgpt = clients.find((c) => c.name === 'ChatGPT')
    expect(claude?.callCount).toBe(2)
    expect(claude?.transport).toBe('MCP SSE')
    expect(chatgpt?.callCount).toBe(1)
    expect(chatgpt?.transport).toBe('REST/OpenAPI')
  })

  it('getToolAggregates aggregates across all sessions', async () => {
    const s1 = await getOrCreateSession('user-1', 'ws-1', { clientName: 'Claude', transport: 'MCP SSE' })
    const s2 = await getOrCreateSession('user-2', 'ws-1', { clientName: 'ChatGPT', transport: 'REST/OpenAPI' })
    recordToolCall(s1, 'query_index', 100, false)
    recordToolCall(s2, 'query_index', 200, true)

    const agg = getToolAggregates()
    const queryIndex = agg.find((t) => t.name === 'query_index')
    expect(queryIndex?.calls).toBe(2)
    expect(queryIndex?.avgLatency).toBe(150)
    expect(queryIndex?.errors).toBe(1)
  })

  it('getToolAggregates includes all registered tools even with 0 calls', () => {
    const agg = getToolAggregates()
    // Should have all 9 MCP tools
    expect(agg.length).toBeGreaterThanOrEqual(9)
    const zeroCalled = agg.find((t) => t.calls === 0)
    expect(zeroCalled).toBeDefined()
    expect(zeroCalled?.avgLatency).toBe(0)
  })

  it('getSessionCount returns number of active sessions', async () => {
    expect(getSessionCount()).toBe(0)
    await getOrCreateSession('user-1', 'ws-1')
    await getOrCreateSession('user-2', 'ws-1')
    expect(getSessionCount()).toBe(2)
  })

  it('same user+workspace reuses existing session', async () => {
    const s1 = await getOrCreateSession('user-1', 'ws-1', { clientName: 'Claude', transport: 'MCP SSE' })
    const s2 = await getOrCreateSession('user-1', 'ws-1')
    expect(s1).toBe(s2)
    expect(getSessionCount()).toBe(1)
  })
})
