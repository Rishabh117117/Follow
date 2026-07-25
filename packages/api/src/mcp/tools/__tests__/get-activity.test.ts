import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Boundary, ScopeConflict } from '../../../services/scope/types'

const { mockResolve, mockSummarize, mockSelect } = vi.hoisted(() => {
  const mockSelect = vi.fn()
  return {
    mockResolve: vi.fn<
      (params: unknown) => Promise<{ boundaries: Boundary[]; conflicts: ScopeConflict[] }>
    >(),
    mockSummarize: vi.fn<(conflicts: ScopeConflict[]) => string>(),
    mockSelect,
  }
})

vi.mock('../../../services/scope', () => ({
  resolveEffectiveBoundaries: mockResolve,
  summarizeConflictsForResponse: mockSummarize,
}))

// Empty DB by default — individual tests override.
vi.mock('../../../db/index', () => ({
  db: {
    select: (..._args: unknown[]) => mockSelect(),
  },
}))

import { getActivityTool } from '../get-activity'

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

function emptyQueryChain() {
  return {
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: async () => [],
        }),
      }),
    }),
  }
}

function oneIndexRecordChain() {
  // Returns the index-record row on the first .select() call (indexRecords query),
  // and empty arrays for subsequent calls (rawFiles, chatConversations). Keeps the
  // test focused on governance behavior against a single known activity.
  let callIdx = 0
  return () => {
    const idx = callIdx++
    return {
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () =>
              idx === 0
                ? [
                    {
                      eventTime: new Date('2026-04-20T10:00:00Z'),
                      documentTitle: 'Q2 Notes',
                      threadType: 'doc',
                      isAIInvolved: false,
                    },
                  ]
                : [],
          }),
        }),
      }),
    }
  }
}

describe('get_activity governance (GOVERNANCE-AUDIT-FIX-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSummarize.mockImplementation((conflicts) =>
      conflicts.length === 0
        ? ''
        : '\n\n[SCOPE CONFLICTS]\n' + conflicts.map((c) => `- ${c.resolution.reason}`).join('\n')
    )
    mockSelect.mockImplementation(() => emptyQueryChain())
  })

  it('no-boundary case: returns activities as before (regression)', async () => {
    mockResolve.mockResolvedValue({ boundaries: [], conflicts: [] })
    mockSelect.mockImplementation(oneIndexRecordChain())
    const res = await getActivityTool.handler(
      { since: '1 days', type: 'ingestions' },
      session(),
      { db: null }
    )
    const text = res.content[0]!.text
    expect(text).toContain('Q2 Notes')
    expect(text).not.toContain('SCOPE CONFLICTS')
  })

  it('governance-blocked case: early return with conflict trailer', async () => {
    mockResolve.mockResolvedValue({
      boundaries: [],
      conflicts: [
        {
          type: 'vs_governance',
          boundaries: [],
          governance: { rule: 'privacy_preset_private', severity: 'hard' },
          resolution: { action: 'request_access', reason: 'Private preset blocks.' },
        },
      ],
    })
    const res = await getActivityTool.handler({}, session(), { db: null })
    const text = res.content[0]!.text
    expect(text).toContain('[GET_ACTIVITY BLOCKED]')
    expect(text).toContain('Private preset blocks')
    // No DB read should happen on block
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('fail-closed case: edge_type boundary drops all activities', async () => {
    const edgeBoundary: Boundary = {
      dimension: 'edge_type',
      op: 'include',
      value: 'contradicts',
    }
    mockResolve.mockResolvedValue({ boundaries: [edgeBoundary], conflicts: [] })
    mockSelect.mockImplementation(oneIndexRecordChain())
    const res = await getActivityTool.handler(
      { since: '1 days', type: 'ingestions' },
      session(),
      { db: null }
    )
    const text = res.content[0]!.text
    expect(text).toContain('No activity')
    expect(text).not.toContain('Q2 Notes')
  })

  it('governance-pass case: time boundary retains in-window activities', async () => {
    // Recent window: last 7 days — the stub activity is from 2026-04-20
    const timeBoundary: Boundary = {
      dimension: 'time',
      op: 'within',
      window: { type: 'absolute', from: '2000-01-01', to: '2099-12-31' },
    }
    mockResolve.mockResolvedValue({ boundaries: [timeBoundary], conflicts: [] })
    mockSelect.mockImplementation(oneIndexRecordChain())
    const res = await getActivityTool.handler(
      { since: '365 days', type: 'ingestions' },
      session(),
      { db: null }
    )
    const text = res.content[0]!.text
    expect(text).toContain('Q2 Notes')
  })
})
