import { describe, it, expect } from 'vitest'
import { applyPostFilters, summarizeConflictsForResponse } from '../boundary-applier'
import type { Boundary, ScopeConflict } from '../types'

describe('applyPostFilters', () => {
  it('returns items unchanged when no boundaries', () => {
    const items = [{ score: 0.5, text: 'a' }, { score: 0.9, text: 'b' }]
    expect(applyPostFilters(items, [])).toEqual(items)
  })

  it('filters by confidence gte', () => {
    const items = [{ score: 0.5 }, { score: 0.9 }, { score: 0.3 }]
    const bs: Boundary[] = [{ dimension: 'confidence', op: 'gte', value: 0.8 }]
    expect(applyPostFilters(items, bs)).toEqual([{ score: 0.9 }])
  })

  it('filters by relative time window', () => {
    const now = Date.now()
    const items = [
      { score: 1, createdAt: new Date(now - 1 * 86400 * 1000) },
      { score: 1, createdAt: new Date(now - 20 * 86400 * 1000) },
    ]
    const bs: Boundary[] = [
      { dimension: 'time', op: 'within', window: { type: 'relative', days: 7 } },
    ]
    const filtered = applyPostFilters(items, bs)
    expect(filtered).toHaveLength(1)
  })

  it('filters by topic include', () => {
    const items = [
      { score: 1, topic: 'alpha' },
      { score: 1, topic: 'beta' },
    ]
    const bs: Boundary[] = [{ dimension: 'topic', op: 'include', values: ['alpha'] }]
    expect(applyPostFilters(items, bs)).toEqual([{ score: 1, topic: 'alpha' }])
  })

  it('combines multiple boundaries with AND semantics', () => {
    const items = [
      { score: 0.9, topic: 'alpha' },
      { score: 0.5, topic: 'alpha' },
      { score: 0.9, topic: 'beta' },
    ]
    const bs: Boundary[] = [
      { dimension: 'confidence', op: 'gte', value: 0.8 },
      { dimension: 'topic', op: 'include', values: ['alpha'] },
    ]
    expect(applyPostFilters(items, bs)).toEqual([{ score: 0.9, topic: 'alpha' }])
  })
})

describe('summarizeConflictsForResponse', () => {
  it('returns empty string when there are no conflicts', () => {
    expect(summarizeConflictsForResponse([])).toBe('')
  })

  it('includes governance-wins messaging', () => {
    const conflicts: ScopeConflict[] = [
      {
        type: 'vs_governance',
        boundaries: [],
        governance: { rule: 'r', severity: 'hard' },
        resolution: { action: 'request_access', reason: 'blocked', next_step: 'ask' },
      },
    ]
    const text = summarizeConflictsForResponse(conflicts)
    expect(text).toContain('SCOPE CONFLICTS')
    expect(text).toContain('governance wins')
    expect(text).toContain('blocked')
    expect(text).toContain('ask')
  })
})
