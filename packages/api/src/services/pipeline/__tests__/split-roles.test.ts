import { describe, it, expect, vi, beforeEach } from 'vitest'

// SPLIT-1: prove computeArchivist/computeProfiler perform NO db writes and
// commitArchivist/commitProfiler do, with the db + LLM mocked.

const m = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  select: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('../../../db/index', () => ({ db: m }))
vi.mock('../llm-call', () => ({ pipelineLLMCall: vi.fn() }))

import { pipelineLLMCall } from '../llm-call'
import { computeArchivist, commitArchivist, runArchivist } from '../archivist'
import { computeProfiler, commitProfiler, runProfiler } from '../profiler'

const llm = vi.mocked(pipelineLLMCall)

/** A drizzle query-builder stub: every builder method returns the same chain,
 *  and the chain awaits to `result`. */
function chain(result: unknown): unknown {
  const p = Promise.resolve(result)
  return new Proxy(p, {
    get(target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return (Reflect.get(target, prop) as (...a: unknown[]) => unknown).bind(target)
      }
      return () => chain(result)
    },
  })
}

const writeCount = () =>
  m.insert.mock.calls.length + m.update.mock.calls.length + m.delete.mock.calls.length

beforeEach(() => {
  vi.clearAllMocks()
  m.insert.mockReturnValue(chain([{ id: 'state-1' }]))
  m.update.mockReturnValue(chain([]))
  m.delete.mockReturnValue(chain([]))
  m.select.mockReturnValue(chain([]))
})

// ─── Archivist ───────────────────────────────────────────────────────────────

const archInput = { userId: 'u1', workspaceId: 'ws1', mode: 'scheduled' as const }
const tentativeRow = {
  id: 'rec-1',
  workspace_id: 'ws1',
  embedding_text: 'shipped the pricing change',
  document_id: null, // keeps documentIds empty → no second execute() read
  document_title: 'Pricing',
  section_alias: null,
  indexed_at: '2026-06-02T00:00:00.000Z',
  metadata: {},
}

describe('SPLIT-1 · Archivist compute/commit', () => {
  beforeEach(() => {
    m.execute.mockResolvedValue([tentativeRow])
    llm.mockResolvedValue({
      decisions: [
        { tentativeRecordId: 'rec-1', action: 'promote', confidence: 0.7, reason: 'ship' },
      ],
    } as never)
  })

  it('computeArchivist performs reads + decision but NO db writes', async () => {
    const c = await computeArchivist(archInput)
    expect(writeCount()).toBe(0)
    expect(c.decisions).toHaveLength(1)
    expect(c.tentatives).toHaveLength(1)
  })

  it('commitArchivist performs the writes', async () => {
    const c = await computeArchivist(archInput)
    const r = await commitArchivist(c)
    expect(m.insert).toHaveBeenCalled()
    expect(r.promoted).toBe(1)
  })

  it('runArchivist === compute then commit (same result)', async () => {
    const r = await runArchivist(archInput)
    expect(r.promoted).toBe(1)
  })
})

// ─── Profiler ────────────────────────────────────────────────────────────────

const profInput = { userId: 'u1', workspaceId: 'ws1', mode: 'scheduled' as const }
const confirmedRows = Array.from({ length: 5 }, (_, i) => ({
  record_id: `p${i + 1}`,
  text: 'morning deep work',
  document_id: null,
  document_title: 'X',
  section_alias: null,
  metadata: { topics: ['pricing'] },
  captured_at: '2026-06-02T08:00:00.000Z',
  confidence: 0.6,
}))
const profResponse = {
  patterns: [
    {
      kind: 'temporal',
      description: 'works mornings',
      confidence: 0.7,
      supportingRecordIds: ['p1'],
    },
  ],
  workStyleNarrative: 'Methodical morning worker.',
  edgePriors: [{ topicHint: 'pricing', edgeType: 'supports', weight: 0.5 }],
}

describe('SPLIT-1 · Profiler compute/commit', () => {
  beforeEach(() => {
    m.execute.mockResolvedValue(confirmedRows)
    llm.mockResolvedValue(profResponse as never)
  })

  it('computeProfiler performs reads + decision but NO db writes', async () => {
    const c = await computeProfiler(profInput)
    expect(writeCount()).toBe(0)
    expect(c.ran).toBe(true)
    expect(c.records).toHaveLength(5)
  })

  it('commitProfiler performs the writes', async () => {
    const c = await computeProfiler(profInput)
    const r = await commitProfiler(c)
    expect(m.insert).toHaveBeenCalled()
    expect(r.patternsWritten).toBe(1)
    expect(r.edgePriorsWritten).toBe(1)
  })

  it('runProfiler === compute then commit (same result)', async () => {
    const r = await runProfiler(profInput)
    expect(r.patternsWritten).toBe(1)
    expect(r.edgePriorsWritten).toBe(1)
  })
})
