import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * CONTRADICT-1 read-side bridge — unit tests.
 * Mocks the db so we assert the join/fallback/filter logic without a real DB.
 */

const { edgesMock, recordsMock } = vi.hoisted(() => ({
  edgesMock: vi.fn(),
  recordsMock: vi.fn(),
}))

vi.mock('../../../db/index', () => ({
  db: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: vi.fn((_cols?: unknown) => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: vi.fn((table: any) => {
        const tname = String(table?.[Symbol.for('drizzle:Name')] ?? '')
        const isEdges = tname.includes('semantic_links')
        const data = () => (isEdges ? edgesMock() : recordsMock())
        const thenable = {
          orderBy: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve(data())) })),
          // the records query ends at .where(); make it awaitable
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(data()).then(res, rej),
        }
        return { where: vi.fn(() => thenable) }
      }),
    })),
  },
}))

import { getContradictionEdges, formatContradictionEdges } from '../edges'

const EDGE = {
  id: 'link-1',
  workspaceId: 'ws-1',
  sourceRecordId: 'rec-A',
  targetRecordId: 'rec-B',
  similarity: 0.78,
  linkType: 'contradicts',
  crossUser: false,
  reason: null,
  metadata: {
    analyst: { reason: 'A says Postgres, B says Redis for the same cache.', confidence: 0.9 },
  },
  createdAt: new Date('2026-06-19T00:00:00Z'),
  deletedAt: null,
}
const RECS = [
  {
    id: 'rec-A',
    embeddingText: 'We decided to use Postgres for the session cache.',
    userName: 'Ada',
    documentTitle: 'Cache decision',
  },
  {
    id: 'rec-B',
    embeddingText: "We're going with Redis for the session cache.",
    userName: 'Ada',
    documentTitle: 'Cache decision',
  },
]

beforeEach(() => {
  edgesMock.mockReset()
  recordsMock.mockReset()
})

describe('getContradictionEdges', () => {
  it('resolves both sides + the analyst reason for a contradicts edge', async () => {
    edgesMock.mockReturnValue([EDGE])
    recordsMock.mockReturnValue(RECS)

    const out = await getContradictionEdges({ workspaceId: 'ws-1' })
    expect(out).toHaveLength(1)
    expect(out[0]!.source.text).toContain('Postgres')
    expect(out[0]!.target.text).toContain('Redis')
    expect(out[0]!.reason).toBe('A says Postgres, B says Redis for the same cache.')
    expect(out[0]!.confidence).toBe(0.9)
    expect(out[0]!.similarity).toBe(0.78)
  })

  it('returns [] when there are no contradicts edges', async () => {
    edgesMock.mockReturnValue([])
    const out = await getContradictionEdges({ workspaceId: 'ws-1' })
    expect(out).toEqual([])
  })

  it('applies the topic substring filter (case-insensitive)', async () => {
    edgesMock.mockReturnValue([EDGE])
    recordsMock.mockReturnValue(RECS)
    expect(await getContradictionEdges({ workspaceId: 'ws-1', topic: 'REDIS' })).toHaveLength(1)
    expect(await getContradictionEdges({ workspaceId: 'ws-1', topic: 'kubernetes' })).toHaveLength(
      0
    )
  })

  it('skips an edge whose record was hard-deleted (missing side)', async () => {
    edgesMock.mockReturnValue([EDGE])
    recordsMock.mockReturnValue([RECS[0]]) // only rec-A resolves; rec-B gone
    const out = await getContradictionEdges({ workspaceId: 'ws-1' })
    expect(out).toEqual([])
  })

  it('falls back to the top-level reason column when metadata has none', async () => {
    edgesMock.mockReturnValue([{ ...EDGE, reason: 'top-level reason', metadata: {} }])
    recordsMock.mockReturnValue(RECS)
    const out = await getContradictionEdges({ workspaceId: 'ws-1' })
    expect(out[0]!.reason).toBe('top-level reason')
  })
})

describe('formatContradictionEdges', () => {
  it('renders both sides + the reason + confidence', () => {
    const text = formatContradictionEdges([
      {
        linkId: 'l1',
        similarity: 0.78,
        crossUser: true,
        confidence: 0.9,
        reason: 'opposite cache choice',
        createdAt: '2026-06-19T00:00:00Z',
        source: { recordId: 'a', text: 'use Postgres', contributor: 'Ada', documentTitle: null },
        target: { recordId: 'b', text: 'use Redis', contributor: 'Lin', documentTitle: null },
      },
    ])
    expect(text).toContain('use Postgres')
    expect(text).toContain('use Redis')
    expect(text).toContain('opposite cache choice')
    expect(text).toContain('90% confidence')
    expect(text).toContain('cross-contributor')
  })
})
