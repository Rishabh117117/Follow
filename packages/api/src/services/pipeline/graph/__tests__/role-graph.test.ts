import { describe, it, expect, vi, beforeEach } from 'vitest'

// GRAPH-WIRE-1: the queue path runs a single-role graph (archivist OR profiler),
// no reporter fact-gate. These tests assert the graph path produces the SAME
// counts as the legacy direct `runArchivist` / `runProfiler` on a seeded
// fixture (role compute/commit mocked for determinism), and that with no
// DATABASE_URL the runner works WITHOUT a checkpointer.

vi.mock('../../reporter', () => ({ reportEvent: vi.fn() }))
vi.mock('../../archivist', () => ({
  computeArchivist: vi.fn(),
  commitArchivist: vi.fn(),
  runArchivist: vi.fn(),
}))
vi.mock('../../profiler', () => ({
  computeProfiler: vi.fn(),
  commitProfiler: vi.fn(),
  runProfiler: vi.fn(),
}))

import { computeArchivist, commitArchivist, runArchivist } from '../../archivist'
import { computeProfiler, commitProfiler, runProfiler } from '../../profiler'
import { runRoleGraph } from '../index'

const mockComputeArch = vi.mocked(computeArchivist)
const mockCommitArch = vi.mocked(commitArchivist)
const mockRunArch = vi.mocked(runArchivist)
const mockComputeProf = vi.mocked(computeProfiler)
const mockCommitProf = vi.mocked(commitProfiler)
const mockRunProf = vi.mocked(runProfiler)

const input = { userId: 'u1', workspaceId: 'ws1', mode: 'scheduled' as const }

const lastCounts = (
  log: { node: string; counts?: Record<string, number> }[]
): Record<string, number> => log[log.length - 1]?.counts ?? {}

// Deterministic seeded fixture: the Archivist committed these counts.
const ARCH_RESULT = {
  promoted: 2,
  demoted: 1,
  superseded: 1,
  keptTentative: 3,
  skipped: 0,
}
const PROF_RESULT = {
  runId: 'run-abc',
  patternsWritten: 4,
  edgePriorsWritten: 2,
  workStyleNarrative: 'focused',
  skipped: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.DATABASE_URL // force the no-checkpointer path (tests / PGlite)

  mockComputeArch.mockResolvedValue({
    input,
    tentatives: [{}, {}, {}, {}],
    decisions: [],
  } as never)
  mockCommitArch.mockResolvedValue({ ...ARCH_RESULT } as never)
  // Legacy direct path = commit ∘ compute.
  mockRunArch.mockImplementation(async (i) => commitArchivist(await computeArchivist(i)) as never)

  mockComputeProf.mockResolvedValue({
    input,
    records: [{}, {}, {}, {}],
    llmResponse: { workStyleNarrative: 'focused', patterns: [{}, {}, {}, {}] },
    ran: true,
  } as never)
  mockCommitProf.mockResolvedValue({ ...PROF_RESULT } as never)
  mockRunProf.mockImplementation(async (i) => commitProfiler(await computeProfiler(i)) as never)
})

describe('GRAPH-WIRE-1 · single-role graph parity (no checkpointer)', () => {
  it('archivist-via-graph commits and reports the same promoted/demoted/superseded as runArchivist', async () => {
    const state = await runRoleGraph({ role: 'archivist', ...input })

    // The graph ran exactly the archivist role and committed (persist=true).
    expect(mockComputeArch).toHaveBeenCalledTimes(1)
    expect(mockCommitArch).toHaveBeenCalledTimes(1)
    expect(state.nodeLog.map((n) => n.node)).toEqual(['archivist'])

    const graphCounts = lastCounts(state.nodeLog)
    const direct = await runArchivist(input)

    // Parity: graph nodeLog counts === direct runArchivist result.
    expect(graphCounts.promoted).toBe(direct.promoted)
    expect(graphCounts.demoted).toBe(direct.demoted)
    expect(graphCounts.superseded).toBe(direct.superseded)
    expect(graphCounts.keptTentative).toBe(direct.keptTentative)
    expect(graphCounts.skipped).toBe(direct.skipped)
    expect(graphCounts.promoted).toBe(ARCH_RESULT.promoted)
  })

  it('profiler-via-graph commits and reports the same patterns/edgePriors as runProfiler', async () => {
    const state = await runRoleGraph({ role: 'profiler', ...input })

    expect(mockComputeProf).toHaveBeenCalledTimes(1)
    expect(mockCommitProf).toHaveBeenCalledTimes(1)
    expect(state.nodeLog.map((n) => n.node)).toEqual(['profiler'])

    const graphCounts = lastCounts(state.nodeLog)
    const direct = await runProfiler(input)

    expect(graphCounts.patternsWritten).toBe(direct.patternsWritten)
    expect(graphCounts.edgePriorsWritten).toBe(direct.edgePriorsWritten)
    expect(graphCounts.skipped).toBe(direct.skipped ? 1 : 0)
  })

  it('runs with no DATABASE_URL (no checkpointer) and persists', async () => {
    expect(process.env.DATABASE_URL).toBeUndefined()
    const state = await runRoleGraph({ role: 'archivist', ...input })
    // persist=true ⇒ commit ran (this is the live path, not shadow).
    expect(mockCommitArch).toHaveBeenCalledTimes(1)
    expect(state.meta.persist).toBe(true)
  })
})
