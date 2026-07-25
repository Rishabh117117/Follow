import { describe, it, expect, vi } from 'vitest'

const { mockQueryDirectory } = vi.hoisted(() => ({
  mockQueryDirectory: vi.fn(),
}))

vi.mock('../../../services/directory/directory-query', () => ({
  queryDirectory: mockQueryDirectory,
}))

import { directoryQueryTool } from '../directory-query'
import { mcpTools } from '../index'

function session(overrides: Record<string, unknown> = {}): any {
  return {
    userId: 'user-1',
    workspaceId: 'ws-1',
    activeProjectId: null,
    activeProjectScope: 'personal',
    connectedAt: new Date(),
    lastActivityAt: new Date(),
    clientName: 'test',
    transport: 'sse',
    toolCalls: {},
    ...overrides,
  }
}

describe('directory_query MCP tool (Sprint CTX-2)', () => {
  it('handler calls queryDirectory with correct params', async () => {
    mockQueryDirectory.mockResolvedValue({
      topic: 'encryption',
      totalContributors: 1,
      contributors: [],
      contradictions: [],
      routingReason: 'single-source',
      recommendation: 'stub',
    })
    await directoryQueryTool.handler(
      { topic: 'encryption', scope: 'project-1', include_contradictions: true, max_contributors: 5 },
      session(),
      { db: null }
    )
    expect(mockQueryDirectory).toHaveBeenCalledWith({
      topic: 'encryption',
      indexId: 'project-1',
      userId: 'user-1',
      includeContradictions: true,
      maxContributors: 5,
    })
  })

  it('handler uses session scope when no scope param provided', async () => {
    mockQueryDirectory.mockResolvedValue({
      topic: 't',
      totalContributors: 0,
      contributors: [],
      contradictions: [],
      routingReason: 'single-source',
      recommendation: '',
    })
    await directoryQueryTool.handler(
      { topic: 't' },
      session({ activeProjectScope: 'project', activeProjectId: 'proj-99' }),
      { db: null }
    )
    expect(mockQueryDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ indexId: 'proj-99' })
    )
  })

  it('handler returns formatted JSON result', async () => {
    const stub = {
      topic: 'encryption',
      totalContributors: 2,
      contributors: [],
      contradictions: [],
      routingReason: 'multi-contributor' as const,
      recommendation: 'Alice leads.',
    }
    mockQueryDirectory.mockResolvedValue(stub)
    const res = await directoryQueryTool.handler({ topic: 'encryption' }, session(), { db: null })
    expect(res.content[0]?.type).toBe('text')
    const parsed = JSON.parse(res.content[0]!.text)
    expect(parsed.topic).toBe('encryption')
    expect(parsed.routingReason).toBe('multi-contributor')
  })

  it('is registered in mcpTools array (count = 12 after V41-DISCOVER-1 added discover_similar)', () => {
    expect(mcpTools.length).toBe(12)
    expect(mcpTools.some((t) => t.name === 'directory_query')).toBe(true)
    expect(mcpTools.some((t) => t.name === 'scope_configure')).toBe(true)
    expect(mcpTools.some((t) => t.name === 'discover_similar')).toBe(true)
  })
})
