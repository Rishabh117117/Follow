import { describe, it, expect } from 'vitest'
import { buildDocFactEvents } from '../doc-fact-extractor'
import { docChunkContentHash, type SelectedDocChunk, type DocChunkForIndex } from '../doc-salience'

// DOC-FACTS-B0 Phase 1 — buildDocFactEvents is the pure chunk→DistilledEvent
// mapping (1 fact per chunk). The DB-bound flow (thread/session creation,
// version stamping, indexDistilledEvents routing) is verified in Phase 4.

function select(chunk: DocChunkForIndex): SelectedDocChunk {
  return { chunk, contentHash: docChunkContentHash(chunk.text) }
}

const FILE_ID = '11111111-1111-1111-1111-111111111111'

describe('DOC-FACTS-B0 · buildDocFactEvents', () => {
  it('produces exactly one fact event per chunk (1:1)', () => {
    const selected = [
      select({ chunkIndex: 0, text: 'first', importance: 0.8 }),
      select({ chunkIndex: 1, text: 'second', importance: 0.8 }),
      select({ chunkIndex: 2, text: 'third', importance: 0.8 }),
    ]
    const events = buildDocFactEvents(selected, FILE_ID)
    expect(events).toHaveLength(3)
  })

  it('stamps doc-shaped events: type edit, distilledFrom document (NOT ai_interaction)', () => {
    const [e] = buildDocFactEvents([select({ chunkIndex: 0, text: 'x', importance: 0.8 })], FILE_ID)
    expect(e!.type).toBe('edit')
    expect(e!.distilledFrom).toEqual(['document'])
  })

  it('carries the dedup hash, fileId, content, topics, and entities into metadata', () => {
    const chunk: DocChunkForIndex = {
      chunkIndex: 4,
      text: 'Higher hydration yields a more open crumb.',
      topics: ['sourdough', 'hydration'],
      entities: { decisions: ['use 70% hydration'] },
      sectionTitle: 'Crumb',
      importance: 0.9,
    }
    const sel = select(chunk)
    const [e] = buildDocFactEvents([sel], FILE_ID)
    expect(e!.metadata.fileId).toBe(FILE_ID)
    expect(e!.metadata.chunkIndex).toBe(4)
    expect(e!.metadata.sectionTitle).toBe('Crumb')
    expect(e!.metadata.docChunkHash).toBe(sel.contentHash)
    expect(e!.metadata.chunkContent).toContain('Higher hydration')
    expect(e!.metadata.topics).toEqual(['sourdough', 'hydration'])
    expect((e!.metadata.entities as { decisions: string[] }).decisions).toEqual([
      'use 70% hydration',
    ])
  })

  it('derives magnitude from importance', () => {
    const mk = (importance: number | undefined) =>
      buildDocFactEvents([select({ chunkIndex: 0, text: 't', importance })], FILE_ID)[0]!
    expect(mk(0.9).magnitude).toBe('high')
    expect(mk(0.6).magnitude).toBe('medium')
    expect(mk(0.2).magnitude).toBe('low')
    expect(mk(undefined).magnitude).toBe('low')
  })

  it('flags keyChange only for high-importance chunks (>= 0.7)', () => {
    const mk = (importance: number) =>
      buildDocFactEvents([select({ chunkIndex: 0, text: 't', importance })], FILE_ID)[0]!
    expect(mk(0.7).keyChange).toBe(true)
    expect(mk(0.69).keyChange).toBe(false)
  })

  it('labels from summary when present, else a slice of the text', () => {
    const withSummary = buildDocFactEvents(
      [
        select({
          chunkIndex: 0,
          text: 'long body text',
          summary: 'A concise summary',
          importance: 0.8,
        }),
      ],
      FILE_ID
    )[0]!
    expect(withSummary.label).toBe('A concise summary')

    const noSummary = buildDocFactEvents(
      [select({ chunkIndex: 0, text: '  collapse   the    whitespace  ', importance: 0.8 })],
      FILE_ID
    )[0]!
    expect(noSummary.label).toBe('collapse the whitespace')
  })

  it('caps embedded chunk content at 4000 chars', () => {
    const big = 'a'.repeat(9000)
    const [e] = buildDocFactEvents([select({ chunkIndex: 0, text: big, importance: 0.8 })], FILE_ID)
    expect((e!.metadata.chunkContent as string).length).toBe(4000)
  })
})
