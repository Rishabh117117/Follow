import { describe, it, expect, vi, beforeEach } from 'vitest'

// GRAPH-1 shadow harness: drive reporter→archivist→profiler through the graph
// with the role internals mocked, and assert the shadow verdict passes — i.e.
// facts accumulate in shared state (the `totalFacts:0 / topicsCovered:[]` bug
// is structurally gone) and no commits run in shadow.

vi.mock('../../reporter', () => ({ reportEvent: vi.fn() }))
vi.mock('../../archivist', () => ({ computeArchivist: vi.fn(), commitArchivist: vi.fn() }))
vi.mock('../../profiler', () => ({ computeProfiler: vi.fn(), commitProfiler: vi.fn() }))

import { reportEvent } from '../../reporter'
import { computeArchivist, commitArchivist } from '../../archivist'
import { computeProfiler, commitProfiler } from '../../profiler'
import { runPipelineGraph } from '../index'

const mockReport = vi.mocked(reportEvent)
const mockComputeArch = vi.mocked(computeArchivist)
const mockCommitArch = vi.mocked(commitArchivist)
const mockComputeProf = vi.mocked(computeProfiler)
const mockCommitProf = vi.mocked(commitProfiler)

const event = {
  userId: 'u1',
  workspaceId: 'ws1',
  rawText: 'shipped pricing',
  provenance: {
    source_tool: 'manual',
    source_type: 'chat',
    contributor: 'alice',
    timestamp: '2026-06-02T00:00:00.000Z',
  },
  scopeTags: ['pricing'],
}

const baseOpts = { persist: false, userId: 'u1', workspaceId: 'ws1', mode: 'scheduled' as const }

beforeEach(() => {
  vi.clearAllMocks()
  mockReport.mockResolvedValue({
    skip: false,
    embedding_text: 'shipped pricing',
    summary: 'Shipped the pricing change',
    topics: ['pricing'],
    entities: { people: [], decisions: [], dates: [], actionItems: [] },
    claim: null,
    magnitude: 'small',
    confidence: 0.5,
    applicableTags: ['pricing'],
    tentative: true,
  } as never)
  mockComputeArch.mockResolvedValue({
    input: { userId: 'u1', workspaceId: 'ws1', mode: 'scheduled' },
    tentatives: [],
    decisions: [],
  } as never)
  mockComputeProf.mockResolvedValue({
    input: { userId: 'u1', workspaceId: 'ws1', mode: 'scheduled' },
    records: [],
    llmResponse: null,
    ran: false,
  } as never)
})

describe('GRAPH-1 · shadow run (reporter→profiler)', () => {
  it('shadowVerdict().pass — facts > 0 and topicsCovered > 0', async () => {
    const { verdict, state } = await runPipelineGraph({ ...baseOpts, events: [event] })
    expect(verdict.pass).toBe(true)
    expect(verdict.totalFacts).toBeGreaterThan(0)
    expect(verdict.topicsCovered).toContain('pricing')
    expect(state.nodeLog.map((n) => n.node)).toEqual(
      expect.arrayContaining(['reporter', 'archivist', 'profiler'])
    )
  })

  it('shadow (persist=false) performs NO commits', async () => {
    await runPipelineGraph({ ...baseOpts, events: [event] })
    expect(mockComputeArch).toHaveBeenCalled()
    expect(mockComputeProf).toHaveBeenCalled()
    expect(mockCommitArch).not.toHaveBeenCalled()
    expect(mockCommitProf).not.toHaveBeenCalled()
  })

  it('router over shared state: no facts ⇒ persisting roles skipped, verdict fails', async () => {
    const { verdict, state } = await runPipelineGraph({ ...baseOpts, events: [] })
    expect(verdict.pass).toBe(false)
    expect(verdict.totalFacts).toBe(0)
    expect(state.nodeLog.map((n) => n.node)).toEqual(['reporter'])
    expect(mockComputeArch).not.toHaveBeenCalled()
  })
})
