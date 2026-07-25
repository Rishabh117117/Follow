import { describe, it, expect } from 'vitest'
import {
  buildStructuredQuery,
  validateStructuredQuery,
  serializeQueryToJson,
} from '../query-builder'
import type { Boundary } from '../../scope/types'

describe('query-builder', () => {
  describe('buildStructuredQuery', () => {
    it('produces a query_id derived from the name', () => {
      const q = buildStructuredQuery({
        userId: 'u',
        workspaceId: 'w',
        boundaries: [{ dimension: 'confidence', op: 'gte', value: 0.8 }],
        select: { fields: ['id', 'content'] },
        name: 'Priya recent',
      })
      expect(q.query_id.startsWith('priya_recent')).toBe(true)
      expect(q.createdBy).toBe('u')
      expect(q.workspaceId).toBe('w')
    })

    it('rejects limit above 1000 (no silent clamping — Wegner invariant)', () => {
      expect(() =>
        buildStructuredQuery({
          userId: 'u',
          workspaceId: 'w',
          boundaries: [],
          select: { fields: ['id'], limit: 9999 },
        })
      ).toThrow(/Limit must be within/)
    })

    it('defaults orderBy to createdAt desc when absent', () => {
      const q = buildStructuredQuery({
        userId: 'u',
        workspaceId: 'w',
        boundaries: [],
        select: { fields: ['id'] },
      })
      expect(q.select.orderBy).toEqual({ field: 'createdAt', direction: 'desc' })
    })

    it('throws with structured errors on invalid input', () => {
      expect(() =>
        buildStructuredQuery({
          userId: 'u',
          workspaceId: 'w',
          boundaries: [
            { dimension: 'confidence', op: 'gte', value: 0.95 },
            { dimension: 'confidence', op: 'lte', value: 0.8 },
          ],
          select: { fields: ['id'] },
        })
      ).toThrow(/Invalid structured query/)
    })
  })

  describe('validateStructuredQuery', () => {
    it('accepts a minimal valid query', () => {
      const r = validateStructuredQuery({
        boundaries: [],
        select: { fields: ['id'] },
      })
      expect(r.valid).toBe(true)
    })

    it('rejects limit above 1000', () => {
      const r = validateStructuredQuery({
        boundaries: [],
        select: { fields: ['id'], limit: 1001 },
      })
      expect(r.valid).toBe(false)
      expect(r.errors.some((e) => e.field === 'select.limit')).toBe(true)
    })

    it('rejects unknown select field', () => {
      const r = validateStructuredQuery({
        boundaries: [],
        select: { fields: ['wat' as never, 'id'] },
      })
      expect(r.valid).toBe(false)
      expect(r.errors.some((e) => e.field === 'select.fields')).toBe(true)
    })

    it('rejects invalid groupBy target', () => {
      const r = validateStructuredQuery({
        boundaries: [],
        select: { fields: ['id'], groupBy: 'unknown_field' },
      })
      expect(r.valid).toBe(false)
      expect(r.errors.some((e) => e.field === 'select.groupBy')).toBe(true)
    })

    it('rejects aggregation kinds that require a field when missing', () => {
      const r = validateStructuredQuery({
        boundaries: [],
        select: { fields: ['id'] },
        aggregations: [{ kind: 'distinct' }],
      })
      expect(r.valid).toBe(false)
      expect(r.errors.some((e) => e.field === 'aggregations')).toBe(true)
    })

    it('propagates boundary coherence errors from scope-builder', () => {
      const boundaries: Boundary[] = [
        { dimension: 'confidence', op: 'gte', value: 0.95 },
        { dimension: 'confidence', op: 'lte', value: 0.8 },
      ]
      const r = validateStructuredQuery({
        boundaries,
        select: { fields: ['id'] },
      })
      expect(r.valid).toBe(false)
      expect(r.errors.some((e) => e.field === 'boundaries')).toBe(true)
    })
  })

  describe('serializeQueryToJson', () => {
    it('produces pretty JSON containing query_id + boundaries', () => {
      const q = buildStructuredQuery({
        userId: 'u',
        workspaceId: 'w',
        boundaries: [{ dimension: 'topic', op: 'include', values: ['capstone'] }],
        select: { fields: ['id', 'content'] },
        name: 'x',
      })
      const json = serializeQueryToJson(q)
      expect(json).toContain('"query_id"')
      expect(json).toContain('capstone')
    })
  })
})
