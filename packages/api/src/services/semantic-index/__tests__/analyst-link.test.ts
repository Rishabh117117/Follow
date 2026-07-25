import { describe, it, expect, vi, beforeEach } from 'vitest'

// ANALYST-ON-1: prove the indexer's link detection hands the ANALYST BOTH
// texts (FIX-1) and classifies qualifying pairs with bounded concurrency
// (FIX-2a). db + the ANALYST LLM are mocked; the flag is forced on.

const m = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
}))
const flags = vi.hoisted(() => ({ analystOn: true }))

vi.mock('../../../db/index', () => ({ db: m }))
vi.mock('../../../config/server-vault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return {
    ...actual,
    isServerFeatureActive: (id: string) =>
      id === 'pipeline-analyst-llm' ? flags.analystOn : false,
  }
})
vi.mock('../../pipeline/analyst', () => ({ classifyEdge: vi.fn() }))

import { classifyEdge } from '../../pipeline/analyst'
import { detectAndInsertLinks } from '../indexer'

const mockClassify = vi.mocked(classifyEdge)

/** Drizzle query-builder stub: every builder method returns the same chain,
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

// A minimal index_records candidate row (only the fields link detection reads).
function candidateRow(id: string, emb: number[]) {
  return {
    id,
    threadId: 'thread-1',
    userId: 'user-1',
    threadType: 'document',
    embedding: emb,
    embeddingContent: emb,
    embeddingCausal: emb,
    embeddingContext: emb,
    embeddingText: `candidate text ${id}`,
    documentTitle: 'Doc A',
    userName: 'Alice',
    eventTime: new Date('2026-06-16T00:00:00.000Z'),
    metadata: { topics: ['pricing'] },
    deletedAt: null,
  }
}

const EMB = [1, 0, 0]

function newRecordValue() {
  return {
    threadId: 'thread-1', // same thread ⇒ SAME threshold (0.55)
    userId: 'user-2',
    threadType: 'document',
    embedding: EMB,
    embeddingContent: EMB,
    embeddingCausal: EMB,
    embeddingContext: EMB,
    embeddingText: 'the NEW record text',
    documentTitle: 'Doc B',
    userName: 'Bob',
    eventTime: new Date('2026-06-16T01:00:00.000Z'),
    metadata: { topics: ['pricing'] },
  }
}

let capturedLinks: unknown[] | null = null

beforeEach(() => {
  vi.clearAllMocks()
  flags.analystOn = true
  capturedLinks = null
  const valuesMock = vi.fn((links: unknown[]) => {
    capturedLinks = links
    return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }
  })
  m.insert.mockReturnValue({ values: valuesMock })
})

describe('ANALYST-ON-1 · detectAndInsertLinks (flag on)', () => {
  it('FIX-1: classifyEdge receives BOTH texts non-empty for a normal pair', async () => {
    m.select.mockReturnValue(chain([candidateRow('cand-1', EMB)]))
    mockClassify.mockResolvedValue({
      edgeType: 'references',
      confidence: 0.7,
      reason: 'b references a',
      directionality: 'a_to_b',
    })

    await detectAndInsertLinks(
      [{ id: 'new-1', threadEventId: 'te-1' }],
      [newRecordValue()],
      [EMB],
      'ws-1'
    )

    expect(mockClassify).toHaveBeenCalledTimes(1)
    const arg = mockClassify.mock.calls[0]![0]
    expect(arg.a.text).toBe('candidate text cand-1')
    expect(arg.b.text).toBe('the NEW record text')
    expect(arg.a.text.length).toBeGreaterThan(0)
    expect(arg.b.text.length).toBeGreaterThan(0)
    // symmetry: the new side carries identity too, not just the candidate.
    expect(arg.b.documentTitle).toBe('Doc B')
    expect(arg.b.contributor).toBe('Bob')
    expect(arg.b.topics).toEqual(['pricing'])

    // The verdict persisted as a typed edge with the analyst reason.
    expect(capturedLinks).toHaveLength(1)
    const link = (capturedLinks as Record<string, unknown>[])[0]!
    expect(link.linkType).toBe('references')
    expect((link.metadata as { analyst: { reason: string } }).analyst.reason).toBe('b references a')
  })

  it('FIX-2a: classification runs with bounded concurrency (>1 parallel, ≤5)', async () => {
    const candidates = Array.from({ length: 12 }, (_, i) => candidateRow(`cand-${i}`, EMB))
    m.select.mockReturnValue(chain(candidates))

    let inFlight = 0
    let maxInFlight = 0
    mockClassify.mockImplementation(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return {
        edgeType: 'references' as const,
        confidence: 0.7,
        reason: 'r',
        directionality: 'a_to_b' as const,
      }
    })

    await detectAndInsertLinks(
      [{ id: 'new-1', threadEventId: 'te-1' }],
      [newRecordValue()],
      [EMB],
      'ws-1'
    )

    expect(mockClassify).toHaveBeenCalledTimes(12)
    expect(maxInFlight).toBeGreaterThan(1) // actually parallel, not sequential
    expect(maxInFlight).toBeLessThanOrEqual(5) // bounded
    expect(capturedLinks).toHaveLength(12)
  })

  it('rollback: flag off ⇒ heuristic path, ANALYST never called', async () => {
    flags.analystOn = false
    m.select.mockReturnValue(chain([candidateRow('cand-1', EMB)]))

    await detectAndInsertLinks(
      [{ id: 'new-1', threadEventId: 'te-1' }],
      [newRecordValue()],
      [EMB],
      'ws-1'
    )

    expect(mockClassify).not.toHaveBeenCalled()
    expect(capturedLinks).toHaveLength(1)
    const link = (capturedLinks as Record<string, unknown>[])[0]!
    // Heuristic linkType (not an analyst verdict); no analyst metadata.
    expect(typeof link.linkType).toBe('string')
    expect(link.metadata).toBeUndefined()
  })
})
