/**
 * SCOPE-A-1 — author attribution + contested (cross-author contradiction)
 * surfacing in the assembled context. Pure assembler tests (no DB), so they
 * run without the pgvector extension the integration suite needs.
 */
import { describe, it, expect } from 'vitest'
import { assembleContext } from '../assembler'
import type { ClassificationResult } from '../classifier'
import type { RetrievalResult, RetrievedItem } from '../retriever'

const classification: ClassificationResult = {
  intent: 'multi_layer',
  confidence: 0.9,
  reasoning: 'test',
  bypassAgent: false,
}

function item(over: Partial<RetrievedItem> & { recordId: string; author: string }): RetrievedItem {
  return {
    source: 'index_records',
    recordId: over.recordId,
    content: over.content ?? 'a fact',
    citation: {
      sourceFileId: over.recordId,
      sourceVersion: null,
      sourceContentHash: null,
      timestamp: '2026-06-22T00:00:00.000Z',
      label: `Index record (${over.recordId})`,
      author: over.author,
    },
    metadata: { contributorId: `u-${over.author}` },
  }
}

function result(items: RetrievedItem[]): RetrievalResult {
  return { items, errors: [], totalLatencyMs: 1 }
}

describe('SCOPE-A-1 author attribution (Phase 2)', () => {
  it('renders each fact attributed to its author inline', () => {
    const ctx = assembleContext(
      classification,
      result([
        item({ recordId: 'r-A', author: 'Alice', content: 'The launch date is March 15.' }),
        item({ recordId: 'r-B', author: 'Bob', content: 'The launch date is April 20.' }),
      ])
    )
    expect(ctx.contextBlock).toContain('— by Alice')
    expect(ctx.contextBlock).toContain('— by Bob')
    expect(ctx.contextBlock).toContain('The launch date is March 15.')
    expect(ctx.contextBlock).toContain('The launch date is April 20.')
  })

  it('carries author through versionCitations', () => {
    const ctx = assembleContext(
      classification,
      result([
        item({ recordId: 'r-A', author: 'Alice', content: 'Alice fact' }),
        item({ recordId: 'r-B', author: 'Bob', content: 'Bob fact' }),
      ])
    )
    const authors = ctx.versionCitations.map((c) => c.author).sort()
    expect(authors).toEqual(['Alice', 'Bob'])
  })

  it('omits the author suffix when no author is resolved', () => {
    const noAuthor: RetrievedItem = {
      source: 'index_records',
      recordId: 'r-X',
      content: 'orphan fact',
      citation: {
        sourceFileId: 'r-X',
        timestamp: '2026-06-22T00:00:00.000Z',
        label: 'Index record (r-X)',
      },
    }
    const ctx = assembleContext(classification, result([noAuthor]))
    expect(ctx.contextBlock).toContain('[Index record (r-X)]')
    expect(ctx.contextBlock).not.toContain('— by')
  })
})

describe('SCOPE-A-1 contested surfacing (Phase 3)', () => {
  const twoAuthors = () =>
    result([
      item({ recordId: 'r-A', author: 'Alice', content: 'The launch date is March 15.' }),
      item({ recordId: 'r-B', author: 'Bob', content: 'The launch date is April 20.' }),
    ])

  it('surfaces a cross-author contradiction with both authors + reason + contested block', () => {
    const ctx = assembleContext(classification, twoAuthors(), {
      contradictsEdges: [
        {
          sourceRecordId: 'r-A',
          targetRecordId: 'r-B',
          reason: 'A says March 15, B says April 20 — direct conflict on the launch date.',
          confidence: 0.8,
          crossUser: true,
        },
      ],
    })
    expect(ctx.contextBlock).toContain('[CONTESTED — teammates disagree]')
    expect(ctx.contextBlock).toContain('cross-author')
    expect(ctx.contextBlock).toContain('Alice')
    expect(ctx.contextBlock).toContain('Bob')
    expect(ctx.contextBlock).toContain('direct conflict on the launch date')
    // both facts marked contested inline
    expect(ctx.contextBlock).toMatch(/⚠ CONTESTED/)
    // structured output for a UI
    expect(ctx.contested).toHaveLength(1)
    expect(ctx.contested![0]!.crossUser).toBe(true)
    expect([ctx.contested![0]!.a.author, ctx.contested![0]!.b.author].sort()).toEqual([
      'Alice',
      'Bob',
    ])
  })

  it('still surfaces same-author contradictions (regression), marked same-author', () => {
    const ctx = assembleContext(
      classification,
      result([
        item({ recordId: 'r-A', author: 'Alice', content: 'Cache uses Redis.' }),
        item({ recordId: 'r-B', author: 'Alice', content: 'Cache uses Postgres.' }),
      ]),
      {
        contradictsEdges: [
          {
            sourceRecordId: 'r-A',
            targetRecordId: 'r-B',
            reason: 'Redis vs Postgres for cache.',
            confidence: 0.7,
            crossUser: false,
          },
        ],
      }
    )
    expect(ctx.contextBlock).toContain('[CONTESTED — teammates disagree]')
    expect(ctx.contextBlock).toContain('same-author')
    expect(ctx.contested).toHaveLength(1)
    expect(ctx.contested![0]!.crossUser).toBe(false)
  })

  it('does not surface an edge whose endpoint is not in the retrieved set', () => {
    const ctx = assembleContext(classification, twoAuthors(), {
      contradictsEdges: [
        {
          sourceRecordId: 'r-A',
          targetRecordId: 'r-ABSENT',
          reason: 'partner missing',
          confidence: 0.9,
          crossUser: true,
        },
      ],
    })
    expect(ctx.contested ?? []).toHaveLength(0)
    expect(ctx.contextBlock).not.toContain('[CONTESTED')
    expect(ctx.contextBlock).not.toContain('⚠ CONTESTED')
  })

  it('emits no contested block when no edges are supplied', () => {
    const ctx = assembleContext(classification, twoAuthors())
    expect(ctx.contested ?? []).toHaveLength(0)
    expect(ctx.contextBlock).not.toContain('[CONTESTED')
  })
})
