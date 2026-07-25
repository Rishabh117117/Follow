import { describe, it, expect } from 'vitest'
import {
  buildScopeFromBoundaries,
  validateScopeBoundaries,
  serializeScopeToJson,
} from '../scope-builder'
import type { Boundary } from '../types'

describe('scope-builder', () => {
  describe('buildScopeFromBoundaries', () => {
    it('produces a scope_id derived from the name', () => {
      const scope = buildScopeFromBoundaries({
        userId: 'u',
        workspaceId: 'w',
        boundaries: [],
        name: 'Capstone · high confidence',
      })
      expect(scope.scope_id.startsWith('capstone_high_confidence')).toBe(true)
      expect(scope.name).toBe('Capstone · high confidence')
      expect(scope.mode).toBe('static')
      expect(scope.persists_until).toBe('session_end')
    })

    it('defaults to session_end persistence and static mode', () => {
      const s = buildScopeFromBoundaries({
        userId: 'u',
        workspaceId: 'w',
        boundaries: [],
      })
      expect(s.persists_until).toBe('session_end')
      expect(s.mode).toBe('static')
    })
  })

  describe('validateScopeBoundaries', () => {
    it('passes an empty list', () => {
      expect(validateScopeBoundaries([]).valid).toBe(true)
    })

    it('rejects mutually exclusive confidence bounds', () => {
      const bs: Boundary[] = [
        { dimension: 'confidence', op: 'gte', value: 0.95 },
        { dimension: 'confidence', op: 'lte', value: 0.8 },
      ]
      const r = validateScopeBoundaries(bs)
      expect(r.valid).toBe(false)
      const first = r.conflicts[0]!
      expect(first.type).toBe('within_scope')
      expect(first.resolution.action).toBe('reject')
    })

    it('rejects custom boundaries without a name', () => {
      const bs: Boundary[] = [{ dimension: 'custom', op: 'matches', value: 'xyz' }]
      const r = validateScopeBoundaries(bs)
      expect(r.valid).toBe(false)
      expect(r.conflicts.some((c) => c.resolution.reason.includes('name'))).toBe(true)
    })

    it('rejects contradictory include/exclude on same dimension+value', () => {
      const bs: Boundary[] = [
        { dimension: 'index', op: 'include', values: ['idx-1'] },
        { dimension: 'index', op: 'exclude', values: ['idx-1'] },
      ]
      const r = validateScopeBoundaries(bs)
      expect(r.valid).toBe(false)
      expect(r.conflicts[0]!.resolution.reason).toMatch(/contradictory/)
    })

    it('rejects gte with no value', () => {
      const bs: Boundary[] = [{ dimension: 'confidence', op: 'gte' } as Boundary]
      const r = validateScopeBoundaries(bs)
      expect(r.valid).toBe(false)
    })

    it('accepts a valid composite scope', () => {
      const bs: Boundary[] = [
        { dimension: 'confidence', op: 'gte', value: 0.8 },
        { dimension: 'time', op: 'within', window: { type: 'relative', days: 14 } },
        { dimension: 'index', op: 'include', values: ['idx-capstone'] },
      ]
      const r = validateScopeBoundaries(bs)
      expect(r.valid).toBe(true)
    })
  })

  describe('serializeScopeToJson', () => {
    it('produces pretty JSON with scope_id, boundaries, mode', () => {
      const s = buildScopeFromBoundaries({
        userId: 'u',
        workspaceId: 'w',
        boundaries: [{ dimension: 'confidence', op: 'gte', value: 0.9 }],
        name: 'x',
      })
      const json = serializeScopeToJson(s)
      expect(json).toContain('"scope_id"')
      expect(json).toContain('"confidence"')
      expect(json).toContain('0.9')
    })
  })
})
