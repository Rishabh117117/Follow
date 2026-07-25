import { describe, it, expect } from 'vitest'
import {
  selectSalientChunks,
  docChunkContentHash,
  DOC_FACT_IMPORTANCE_THRESHOLD,
  type DocChunkForIndex,
} from '../doc-salience'

// DOC-FACTS-B0 Phase 2 — the salience gate is pure: importance threshold →
// content-hash dedup → per-doc cap. These tests exercise it without a DB.

function chunk(
  partial: Partial<DocChunkForIndex> & { chunkIndex: number; text: string }
): DocChunkForIndex {
  return { ...partial }
}

describe('DOC-FACTS-B0 · selectSalientChunks', () => {
  it('drops chunks below the importance threshold (boilerplate)', () => {
    const chunks: DocChunkForIndex[] = [
      chunk({ chunkIndex: 0, text: 'key decision: ship on Friday', importance: 0.9 }),
      chunk({ chunkIndex: 1, text: 'page 1 of 1 — footer boilerplate', importance: 0.1 }),
      chunk({
        chunkIndex: 2,
        text: 'exactly at threshold',
        importance: DOC_FACT_IMPORTANCE_THRESHOLD,
      }),
    ]
    const res = selectSalientChunks(chunks, new Set())
    expect(res.selected.map((s) => s.chunk.chunkIndex)).toEqual([0, 2])
    expect(res.droppedLowSalience).toBe(1)
  })

  it('treats unset importance as the default (kept, not silently dropped)', () => {
    // enrichment 429-fallback leaves importance undefined — must not nuke facts.
    const chunks: DocChunkForIndex[] = [
      chunk({ chunkIndex: 0, text: 'enrichment failed, importance unset' }),
    ]
    const res = selectSalientChunks(chunks, new Set())
    expect(res.selected).toHaveLength(1)
    expect(res.droppedLowSalience).toBe(0)
  })

  it('drops chunks whose content is already indexed for this file (identical re-index → 0 new)', () => {
    const text = 'Higher hydration yields a more open crumb.'
    const chunks: DocChunkForIndex[] = [
      chunk({ chunkIndex: 0, text, importance: 0.8 }),
      chunk({ chunkIndex: 1, text: 'a genuinely new paragraph', importance: 0.8 }),
    ]
    const alreadyIndexed = new Set([docChunkContentHash(text)])
    const res = selectSalientChunks(chunks, alreadyIndexed)
    expect(res.selected.map((s) => s.chunk.chunkIndex)).toEqual([1])
    expect(res.droppedDuplicate).toBe(1)
  })

  it('re-running the SAME chunks against their own hashes yields zero new facts', () => {
    const chunks: DocChunkForIndex[] = [
      chunk({ chunkIndex: 0, text: 'alpha content', importance: 0.8 }),
      chunk({ chunkIndex: 1, text: 'beta content', importance: 0.8 }),
    ]
    const firstPass = selectSalientChunks(chunks, new Set())
    expect(firstPass.selected).toHaveLength(2)
    const seen = new Set(firstPass.selected.map((s) => s.contentHash))
    const secondPass = selectSalientChunks(chunks, seen)
    expect(secondPass.selected).toHaveLength(0)
    expect(secondPass.droppedDuplicate).toBe(2)
  })

  it('dedups intra-batch duplicates (a repeated paragraph yields one fact)', () => {
    const repeated = 'the same paragraph twice'
    const chunks: DocChunkForIndex[] = [
      chunk({ chunkIndex: 0, text: repeated, importance: 0.8 }),
      chunk({ chunkIndex: 1, text: repeated, importance: 0.8 }),
    ]
    const res = selectSalientChunks(chunks, new Set())
    expect(res.selected).toHaveLength(1)
    expect(res.droppedDuplicate).toBe(1)
  })

  it('ignores leading/trailing whitespace when hashing (trim-stable dedup)', () => {
    const a = chunk({ chunkIndex: 0, text: 'content', importance: 0.8 })
    const b = chunk({ chunkIndex: 1, text: '   content  ', importance: 0.8 })
    const res = selectSalientChunks([a, b], new Set())
    expect(res.selected).toHaveLength(1)
  })

  it('bounds a pathological doc to the per-doc cap, keeping the most important', () => {
    const chunks: DocChunkForIndex[] = Array.from({ length: 60 }, (_, i) =>
      // importance ascends with index; the cap should keep the top-importance ones
      chunk({ chunkIndex: i, text: `chunk ${i}`, importance: 0.5 + i / 1000 })
    )
    const res = selectSalientChunks(chunks, new Set(), { perDocCap: 10 })
    expect(res.selected).toHaveLength(10)
    expect(res.droppedOverCap).toBe(50)
    // the 10 kept are the highest-importance (indices 50..59), emitted in order
    expect(res.selected.map((s) => s.chunk.chunkIndex)).toEqual([
      50, 51, 52, 53, 54, 55, 56, 57, 58, 59,
    ])
  })

  it('respects a custom importance threshold', () => {
    const chunks: DocChunkForIndex[] = [
      chunk({ chunkIndex: 0, text: 'mid', importance: 0.6 }),
      chunk({ chunkIndex: 1, text: 'high', importance: 0.85 }),
    ]
    const res = selectSalientChunks(chunks, new Set(), { importanceThreshold: 0.8 })
    expect(res.selected.map((s) => s.chunk.chunkIndex)).toEqual([1])
  })
})
