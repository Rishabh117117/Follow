import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockReadFullState } = vi.hoisted(() => ({
  mockReadFullState: vi.fn(),
}))

vi.mock('../../ai-state/state-reader', () => ({
  readFullState: mockReadFullState,
}))

// Silence actual DB access from other sources during this test.
vi.mock('../../../db/index', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    }),
  },
}))

import { executeRetrievalPlan } from '../retriever'
import type { RetrievalPlan } from '../planner'

describe('memory_layers source (GOVERNANCE-AUDIT-FIX-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty when userId is missing (fail-closed)', async () => {
    const plan: RetrievalPlan = {
      intent: 'multi_layer',
      steps: [
        {
          source: 'memory_layers',
          priority: 'required',
          params: { workspaceId: 'ws-1' }, // no userId — older caller path
          reason: 'test',
        },
      ],
      estimatedLatencyMs: 0,
      citationStrategy: 'none',
    }
    const result = await executeRetrievalPlan(plan)
    expect(result.items).toHaveLength(0)
    expect(mockReadFullState).not.toHaveBeenCalled()
  })

  it('returns memory_layers items when userId is threaded', async () => {
    mockReadFullState.mockResolvedValue({
      immediate: {
        focus: {
          documentId: 'doc-1',
          documentTitle: 'My Doc',
          sectionRef: 'section-a',
          surface: 'editor',
        },
        presence: { collaborators: [] },
      },
      event: {
        recentEvents: [
          {
            threadType: 'doc',
            label: 'User added paragraph about pricing',
            timestamp: '2026-04-19T10:00:00Z',
            isKeyChange: true,
          },
        ],
      },
      session: { summary: 'User is building pricing doc.' },
      persistent: { preferredTone: 'formal' },
    })

    const plan: RetrievalPlan = {
      intent: 'multi_layer',
      steps: [
        {
          source: 'memory_layers',
          priority: 'required',
          params: { workspaceId: 'ws-1', userId: 'user-1', documentId: 'doc-1' },
          reason: 'test',
        },
      ],
      estimatedLatencyMs: 0,
      citationStrategy: 'none',
    }

    const result = await executeRetrievalPlan(plan)
    expect(mockReadFullState).toHaveBeenCalledWith('user-1', 'ws-1', 'doc-1')
    expect(result.items.length).toBeGreaterThan(0)

    const sources = result.items.map((i) => i.source)
    expect(sources.every((s) => s === 'memory_layers')).toBe(true)

    const contents = result.items.map((i) => i.content).join(' | ')
    expect(contents).toMatch(/Focus|User added paragraph|building pricing|preferredTone/)
  })

  it('planner threads userId for multi_layer intent', async () => {
    const { planRetrieval } = await import('../planner')
    const plan = planRetrieval(
      {
        intent: 'multi_layer',
        confidence: 0.9,
        reasoning: 'test',
      },
      { workspaceId: 'ws-1', userId: 'user-1', documentId: 'doc-1' }
    )
    const memStep = plan.steps.find((s) => s.source === 'memory_layers')
    expect(memStep).toBeDefined()
    expect(memStep!.params.userId).toBe('user-1')
  })

  it('planner threads userId for longitudinal intent', async () => {
    const { planRetrieval } = await import('../planner')
    const plan = planRetrieval(
      {
        intent: 'longitudinal',
        confidence: 0.9,
        reasoning: 'test',
      },
      { workspaceId: 'ws-1', userId: 'user-2' }
    )
    const memStep = plan.steps.find((s) => s.source === 'memory_layers')
    expect(memStep).toBeDefined()
    expect(memStep!.params.userId).toBe('user-2')
  })
})
