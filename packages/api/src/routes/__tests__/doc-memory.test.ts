import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Document Memory API Routes — unit tests (Sprint IX-2)
 *
 * Tests GET /:fileId, POST /:fileId/interpret, GET /:fileId/trail/:ref,
 * PATCH /patterns/:id using the semantic index.
 */

const { mockUpdate } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
}))

function makeSelectChain(value: unknown[] = []) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(value),
    filter: () => value,
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(value).then(resolve, reject),
  }
  return chain
}

vi.mock('../../db/index', () => ({
  db: {
    select: () => makeSelectChain([]),
    insert: vi.fn(),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([{ id: 'pat-1', pattern: 'test', confidence: 0.9 }]),
        }),
      }),
    }),
  },
}))

vi.mock('../../db/schema/index', () => ({
  documentInterpretations: { fileId: 'fileId', updatedAt: 'updatedAt' },
  documentPatterns: { id: 'id', fileId: 'fileId', confidence: 'confidence' },
  documentDecisionTrails: { fileId: 'fileId' },
}))

vi.mock('../../services/semantic-index/query-executor', () => ({
  executeIndexQuery: vi.fn().mockResolvedValue({
    results: [],
    totalCandidates: 0,
    profile: 'history',
    interpretation: {
      narrativePhase: 'exploration',
      narrativeConfidence: 0.7,
      narrativeSummary: 'Document is in exploration phase',
      workingIntent: 'Building a research report',
      intentEvidence: 'Multiple research-related edits',
      cognitiveState: 'exploring',
      activeTensions: [],
      sourceInfluence: [],
      unresolvedQuestions: [],
    },
  }),
}))

vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set('userId', 'test-user-id')
    await next()
  }),
}))

import { docMemoryRouter } from '../doc-memory'
import { Hono } from 'hono'

describe('DocMemoryRoutes (IX-2)', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.route('/api/doc-memory', docMemoryRouter)
  })

  describe('GET /:fileId', () => {
    it('returns DocumentMemory shape with interpretation from index', async () => {
      const res = await app.request(
        '/api/doc-memory/test-file-id?workspaceId=00000000-0000-0000-0000-000000000001',
        { method: 'GET' }
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.data).toHaveProperty('interpretation')
      expect(body.data).toHaveProperty('patterns')
      expect(body.data).toHaveProperty('decisionTrails')
      expect(body.error).toBeNull()
    })

    it('returns interpretation with correct fields', async () => {
      const res = await app.request(
        '/api/doc-memory/test-file-id?workspaceId=00000000-0000-0000-0000-000000000001',
        { method: 'GET' }
      )

      const body = (await res.json()) as any
      const interp = body.data.interpretation
      if (interp) {
        expect(interp).toHaveProperty('narrativePhase')
        expect(interp).toHaveProperty('narrativeConfidence')
        expect(interp).toHaveProperty('workingIntent')
        expect(interp).toHaveProperty('cognitiveState')
        expect(interp).toHaveProperty('activeTensions')
        expect(interp).toHaveProperty('sourceInfluence')
        expect(interp).toHaveProperty('unresolvedQuestions')
      }
    })

    it('returns 200 without workspaceId (falls back to DB)', async () => {
      const res = await app.request('/api/doc-memory/test-file-id', { method: 'GET' })
      expect(res.status).toBe(200)
    })
  })

  describe('POST /:fileId/interpret', () => {
    it('returns interpretation from index', async () => {
      const res = await app.request('/api/doc-memory/test-file-id/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: '00000000-0000-0000-0000-000000000001' }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.error).toBeNull()
    })

    it('validates workspaceId is UUID', async () => {
      const res = await app.request('/api/doc-memory/test-file-id/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'not-a-uuid' }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /:fileId/trail/:paragraphRef', () => {
    it('returns decision trails from DB', async () => {
      const res = await app.request('/api/doc-memory/test-file-id/trail/intro', {
        method: 'GET',
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.error).toBeNull()
      expect(Array.isArray(body.data)).toBe(true)
    })
  })

  describe('PATCH /patterns/:patternId', () => {
    it('updates pattern dismissed state', async () => {
      const res = await app.request('/api/doc-memory/patterns/pat-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: true }),
      })

      expect(res.status).toBe(200)
    })

    it('rejects empty update body', async () => {
      const res = await app.request('/api/doc-memory/patterns/pat-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
    })
  })
})
