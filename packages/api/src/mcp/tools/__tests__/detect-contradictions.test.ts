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

vi.mock('../../../db/index', () => ({
  db: {
    select: (..._args: unknown[]) => mockSelect(),
  },
}))

import { detectContradictionsTool } from '../detect-contradictions'

function session(overrides: Record<string, unknown> = {}): any {
  return {
    userId: 'user-1',
    workspaceId: 'ws-1',
    activeProjectId: 'proj-1',
    activeProjectScope: 'project',
    connectedAt: new Date(),
    lastActivityAt: new Date(),
    clientName: 'test',
    transport: 'sse',
    toolCalls: {},
    ...overrides,
  }
}

// Chained chain: first call (workspaces lookup) returns name; second call (states) returns rows.
function chain(workspaceName: string, states: unknown[]) {
  let callIdx = 0
  return () => {
    const idx = callIdx++
    return {
      from: () => ({
        where: () => ({
          limit: async () => (idx === 0 ? [{ name: workspaceName }] : states),
          // For states query which has no .limit()
        }),
        // Fall-through: the states query doesn't chain .limit(), it awaits the where clause directly.
        // Drizzle's builder is thenable, so we expose a then on where().
      }),
    }
  }
}

function workspaceThenStates(workspaceName: string, states: unknown[]) {
  let callIdx = 0
  return () => {
    const idx = callIdx++
    if (idx === 0) {
      // .from().where().limit() for workspace name
      return {
        from: () => ({
          where: () => ({
            limit: async () => [{ name: workspaceName }],
          }),
        }),
      }
    }
    // For states query: awaited from .where() directly
    return {
      from: () => ({
        where: () => {
          const promise = Promise.resolve(states)
          return Object.assign(promise, {
            limit: async () => states,
          })
        },
      }),
    }
  }
}

describe('detect_contradictions governance (GOVERNANCE-AUDIT-FIX-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSummarize.mockImplementation((conflicts) =>
      conflicts.length === 0
        ? ''
        : '\n\n[SCOPE CONFLICTS]\n' + conflicts.map((c) => `- ${c.resolution.reason}`).join('\n')
    )
  })

  it('no-boundary case: returns tensions as before (regression)', async () => {
    mockResolve.mockResolvedValue({ boundaries: [], conflicts: [] })
    mockSelect.mockImplementation(
      workspaceThenStates('MyProj', [
        {
          state: {
            tensions: [
              {
                id: 't1',
                description: 'Pricing model mismatch',
                severity: 'high',
                type: 'contradiction',
                involvedUsers: ['alice'],
                involvedSections: ['pricing'],
                detectedAt: '2026-04-10T00:00:00Z',
                resolvedAt: null,
                resolution: null,
                confidence: 0.9,
              },
            ],
            knowledge: [],
          },
        },
      ])
    )
    const res = await detectContradictionsTool.handler({}, session(), { db: null })
    const text = res.content[0]!.text
    expect(text).toContain('contradiction')
    expect(text).toContain('PRICING MODEL MISMATCH')
    expect(text).not.toContain('SCOPE CONFLICTS')
  })

  it('governance-blocked case: early return, no state read', async () => {
    mockResolve.mockResolvedValue({
      boundaries: [],
      conflicts: [
        {
          type: 'vs_governance',
          boundaries: [],
          governance: { rule: 'index_access_denied', severity: 'hard' },
          resolution: { action: 'request_access', reason: 'Index access denied.' },
        },
      ],
    })
    const res = await detectContradictionsTool.handler({}, session(), { db: null })
    const text = res.content[0]!.text
    expect(text).toContain('[DETECT_CONTRADICTIONS BLOCKED]')
    expect(text).toContain('Index access denied')
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('fail-closed case: edge_type boundary drops all tensions', async () => {
    const edgeBoundary: Boundary = {
      dimension: 'edge_type',
      op: 'include',
      value: 'contradicts',
    }
    mockResolve.mockResolvedValue({ boundaries: [edgeBoundary], conflicts: [] })
    mockSelect.mockImplementation(
      workspaceThenStates('MyProj', [
        {
          state: {
            tensions: [
              {
                id: 't1',
                description: 'Pricing model mismatch',
                severity: 'high',
                type: 'contradiction',
                involvedUsers: ['alice'],
                involvedSections: ['pricing'],
                detectedAt: '2026-04-10T00:00:00Z',
                resolvedAt: null,
                resolution: null,
                confidence: 0.9,
              },
            ],
            knowledge: [],
          },
        },
      ])
    )
    const res = await detectContradictionsTool.handler({}, session(), { db: null })
    const text = res.content[0]!.text
    expect(text).toContain('No active contradictions')
    expect(text).not.toContain('Pricing model mismatch')
  })

  it('governance-pass case: contributor boundary retains matching tension', async () => {
    const contributorBoundary: Boundary = {
      dimension: 'contributor',
      op: 'include',
      value: 'alice',
    }
    mockResolve.mockResolvedValue({ boundaries: [contributorBoundary], conflicts: [] })
    mockSelect.mockImplementation(
      workspaceThenStates('MyProj', [
        {
          state: {
            tensions: [
              {
                id: 't1',
                description: 'Pricing model mismatch',
                severity: 'high',
                type: 'contradiction',
                involvedUsers: ['alice'],
                involvedSections: ['pricing'],
                detectedAt: '2026-04-10T00:00:00Z',
                resolvedAt: null,
                resolution: null,
                confidence: 0.9,
              },
            ],
            knowledge: [],
          },
        },
      ])
    )
    const res = await detectContradictionsTool.handler({}, session(), { db: null })
    const text = res.content[0]!.text
    expect(text).toContain('PRICING MODEL MISMATCH')
  })

  it('no active project: returns error before boundary resolution', async () => {
    const res = await detectContradictionsTool.handler(
      {},
      session({ activeProjectId: null }),
      { db: null }
    )
    expect(res.isError).toBe(true)
    expect(mockResolve).not.toHaveBeenCalled()
  })
})
