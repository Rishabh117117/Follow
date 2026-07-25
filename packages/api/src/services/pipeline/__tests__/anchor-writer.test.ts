import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../config/server-vault', () => ({
  isServerFeatureActive: vi.fn(),
}))

import { isServerFeatureActive } from '../../../config/server-vault'
import {
  buildAnchor,
  writeAnchorsForRecords,
  mapArtifactType,
  spanForArtifact,
  type BuildAnchorInput,
} from '../anchor-writer'

const flag = vi.mocked(isServerFeatureActive)

const baseInput = (over: Partial<BuildAnchorInput> = {}): BuildAnchorInput => ({
  id: 'anchor-1',
  workspaceId: 'ws-1',
  indexRecordId: 'rec-1',
  artifact: { id: 'doc-1', type: 'chat' },
  span: { kind: 'message_ref', messageId: 'evt-1', threadId: 'th-1' },
  meaningText: 'User decided to ship the pricing change on Friday.',
  addedAt: '2026-06-02T00:00:00.000Z',
  facets: { content: [0.1, 0.2], causal: [0.3], context: [0.4] },
  ...over,
})

type Row = Record<string, unknown>
type WriterDb = Parameters<typeof writeAnchorsForRecords>[0]

describe('buildAnchor (ANCHOR-1)', () => {
  it('produces a valid v1 anchor with non-empty meaning + valid span', () => {
    const a = buildAnchor(baseInput())
    expect(a.meaning.text.length).toBeGreaterThan(0)
    expect(a.meaning.version).toBe(1)
    expect(a.meaningHistory).toHaveLength(1)
    expect(a.span.kind).toBe('message_ref')
    expect(a.embeddingRef?.recordId).toBe('rec-1')
  })

  it('builds a doc text_range span', () => {
    const span = spanForArtifact('doc', { messageId: 'm', textLength: 120, sectionAlias: 'Intro' })
    expect(span).toMatchObject({ kind: 'text_range', start: 0, end: 120, sectionAlias: 'Intro' })
  })

  it('maps artifact types', () => {
    expect(mapArtifactType('doc')).toBe('doc')
    expect(mapArtifactType('ai')).toBe('chat')
    expect(mapArtifactType('browser')).toBe('note')
  })

  it('clamps the meaning gloss to a bounded length', () => {
    const a = buildAnchor(baseInput({ meaningText: 'x'.repeat(1000) }))
    expect(a.meaning.text.length).toBeLessThanOrEqual(280)
  })
})

describe('writeAnchorsForRecords (gated)', () => {
  beforeEach(() => flag.mockReset())

  it('flag OFF → no-op, db untouched (pipeline byte-identical)', async () => {
    flag.mockReturnValue(false)
    const values = vi.fn(async (_rows: Row[]) => {})
    const db = { insert: vi.fn(() => ({ values })) }
    const n = await writeAnchorsForRecords(db as unknown as WriterDb, [baseInput()])
    expect(n).toBe(0)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('flag ON → inserts an anchor row with non-empty meaning + valid span', async () => {
    flag.mockReturnValue(true)
    let captured: Row[] = []
    const values = vi.fn(async (rows: Row[]) => {
      captured = rows
    })
    const db = { insert: vi.fn(() => ({ values })) }
    const n = await writeAnchorsForRecords(db as unknown as WriterDb, [baseInput()])
    expect(n).toBe(1)
    expect(db.insert).toHaveBeenCalledOnce()
    expect((captured[0]!.meaningText as string).length).toBeGreaterThan(0)
    expect(captured[0]!.meaningVersion).toBe(1)
    expect((captured[0]!.span as { kind: string }).kind).toBe('message_ref')
  })
})
