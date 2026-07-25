import { describe, it, expect } from 'vitest'
import {
  evaluateBoundaryAgainstItem,
  postFilterItems,
} from '../boundary-hook'
import type { RetrievedItem } from '../retriever'
import type { Boundary } from '../../scope/types'

function item(partial: Partial<RetrievedItem> = {}): RetrievedItem {
  return {
    source: 'index_records',
    content: 'content',
    citation: { label: 'label', ...partial.citation },
    metadata: partial.metadata,
    relevanceScore: partial.relevanceScore,
  }
}

describe('evaluateBoundaryAgainstItem', () => {
  it('confidence gte passes when score >= threshold', () => {
    const r = evaluateBoundaryAgainstItem(
      item({ metadata: { confidence: 0.9 } }),
      { dimension: 'confidence', op: 'gte', value: 0.8 }
    )
    expect(r).toBe('pass')
  })

  it('confidence gte fails when score < threshold', () => {
    const r = evaluateBoundaryAgainstItem(
      item({ metadata: { confidence: 0.5 } }),
      { dimension: 'confidence', op: 'gte', value: 0.8 }
    )
    expect(r).toBe('fail')
  })

  it('confidence on item without attribute → unknown (fail-closed trigger)', () => {
    const r = evaluateBoundaryAgainstItem(
      item({ metadata: {} }),
      { dimension: 'confidence', op: 'gte', value: 0.8 }
    )
    expect(r).toBe('unknown')
  })

  it('time within relative window passes for recent items', () => {
    const now = new Date()
    const r = evaluateBoundaryAgainstItem(
      item({ citation: { label: 'x', timestamp: now.toISOString() } }),
      { dimension: 'time', op: 'within', window: { type: 'relative', days: 7 } }
    )
    expect(r).toBe('pass')
  })

  it('time within relative window fails for old items', () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const r = evaluateBoundaryAgainstItem(
      item({ citation: { label: 'x', timestamp: old.toISOString() } }),
      { dimension: 'time', op: 'within', window: { type: 'relative', days: 7 } }
    )
    expect(r).toBe('fail')
  })

  it('time on item without timestamp → unknown', () => {
    const r = evaluateBoundaryAgainstItem(
      item({ citation: { label: 'x' } }),
      { dimension: 'time', op: 'within', window: { type: 'relative', days: 7 } }
    )
    expect(r).toBe('unknown')
  })

  it('contributor include passes when id matches', () => {
    const r = evaluateBoundaryAgainstItem(
      item({ metadata: { contributorId: 'user-1' } }),
      { dimension: 'contributor', op: 'include', values: ['user-1', 'user-2'] }
    )
    expect(r).toBe('pass')
  })

  it('contributor include fails when id not in list', () => {
    const r = evaluateBoundaryAgainstItem(
      item({ metadata: { contributorId: 'user-3' } }),
      { dimension: 'contributor', op: 'include', values: ['user-1'] }
    )
    expect(r).toBe('fail')
  })

  it('contributor on item without contributorId → unknown', () => {
    const r = evaluateBoundaryAgainstItem(
      item({ metadata: {} }),
      { dimension: 'contributor', op: 'include', values: ['user-1'] }
    )
    expect(r).toBe('unknown')
  })

  it('privacy dimension passes through (enforced upstream)', () => {
    const r = evaluateBoundaryAgainstItem(item({}), {
      dimension: 'privacy',
      op: 'include',
      values: ['open'],
    })
    expect(r).toBe('pass')
  })

  it('custom dimension always returns unknown (fail-closed)', () => {
    const r = evaluateBoundaryAgainstItem(item({}), {
      dimension: 'custom',
      op: 'matches',
      name: 'x',
    } as Boundary)
    expect(r).toBe('unknown')
  })
})

describe('postFilterItems (fail-closed)', () => {
  it('no boundaries → passes everything unchanged', () => {
    const items = [item(), item(), item()]
    const r = postFilterItems(items, [])
    expect(r.items).toHaveLength(3)
    expect(r.stats.droppedFailed).toBe(0)
    expect(r.stats.droppedUnknown).toBe(0)
  })

  it('drops items that fail a boundary', () => {
    const items = [
      item({ metadata: { confidence: 0.9 } }),
      item({ metadata: { confidence: 0.5 } }),
    ]
    const r = postFilterItems(items, [
      { dimension: 'confidence', op: 'gte', value: 0.8 },
    ])
    expect(r.items).toHaveLength(1)
    expect(r.stats.droppedFailed).toBe(1)
    expect(r.stats.droppedUnknown).toBe(0)
  })

  it('fail-closed: drops items where the boundary cannot be verified', () => {
    const items = [
      item({ metadata: { confidence: 0.9 } }),
      item({ metadata: {} }), // unknown confidence
    ]
    const r = postFilterItems(items, [
      { dimension: 'confidence', op: 'gte', value: 0.8 },
    ])
    expect(r.items).toHaveLength(1)
    expect(r.stats.droppedUnknown).toBe(1)
  })

  it('fail-closed can be disabled (diagnostics only)', () => {
    const items = [item({ metadata: {} })]
    const r = postFilterItems(
      items,
      [{ dimension: 'confidence', op: 'gte', value: 0.8 }],
      { failClosed: false }
    )
    // With failClosed off, 'unknown' treated as pass (items kept).
    expect(r.items).toHaveLength(1)
  })

  it('multiple boundaries — ANY failure drops the item', () => {
    const items = [
      item({
        metadata: { confidence: 0.9, contributorId: 'u1' },
      }),
    ]
    const r = postFilterItems(items, [
      { dimension: 'confidence', op: 'gte', value: 0.8 },
      { dimension: 'contributor', op: 'include', values: ['u2'] },
    ])
    expect(r.items).toHaveLength(0)
    expect(r.stats.droppedFailed).toBe(1)
  })
})
