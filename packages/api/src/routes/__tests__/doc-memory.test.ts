/* eslint-disable @typescript-eslint/no-explicit-any -- mock-heavy test file */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Document Memory API Routes — unit tests (Sprint IX-2; security-gate-1
 * updated: by-id endpoints now pre-load the owning resource and pass its
 * workspace through the membership guard, so the db fake is a seedable FIFO —
 * push one result array per expected `db.select(...)` call; unqueued selects
 * resolve empty.)
 */

const { selectQueue } = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
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
    select: () => makeSelectChain(selectQueue.length ? (selectQueue.shift() as unknown[]) : []),
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
  documentInterpretations: { fileId: 'fileId', workspaceId: 'workspaceId', updatedAt: 'updatedAt' },
  documentPatterns: {
    id: 'id',
    fileId: 'fileId',
    workspaceId: 'workspaceId',
    confidence: 'confidence',
  },
  documentDecisionTrails: { fileId: 'fileId', workspaceId: 'workspaceId' },
  files: { id: 'id', workspaceId: 'workspaceId' },
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

// security-gate-1: membership enforcement has its own tests (services/__tests__/
// workspace-access.test.ts + __tests__/security-gate.test.ts); mocked permissive
// here so route logic stays the subject.
vi.mock('../../services/workspace-access', () => ({
  assertWorkspaceAccess: vi.fn().mockResolvedValue(null),
  checkWorkspaceAccess: vi.fn().mockResolvedValue({ ok: true, role: 'owner' }),
}))

import { docMemoryRouter } from '../doc-memory'
import { assertWorkspaceAccess } from '../../services/workspace-access'
import { Hono } from 'hono'

const WS = '00000000-0000-0000-0000-000000000001'

describe('DocMemoryRoutes (IX-2)', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(assertWorkspaceAccess).mockResolvedValue(null)
    selectQueue.length = 0
    app = new Hono()
    app.route('/api/doc-memory', docMemoryRouter)
  })

  describe('GET /:fileId', () => {
    it('returns DocumentMemory shape with interpretation from index', async () => {
      const res = await app.request(`/api/doc-memory/test-file-id?workspaceId=${WS}`, {
        method: 'GET',
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.data).toHaveProperty('interpretation')
      expect(body.data).toHaveProperty('patterns')
      expect(body.data).toHaveProperty('decisionTrails')
      expect(body.error).toBeNull()
    })

    it('returns interpretation with correct fields', async () => {
      const res = await app.request(`/api/doc-memory/test-file-id?workspaceId=${WS}`, {
        method: 'GET',
      })

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

    it('passes the workspaceId (even when absent → empty) through the guard', async () => {
      // security-gate-1: workspaceId is guard-checked; in prod an empty value
      // is a 400 from the real assertWorkspaceAccess. Unit scope just proves
      // the handler routes the value into the guard before any read.
      const res = await app.request('/api/doc-memory/test-file-id', { method: 'GET' })
      expect(vi.mocked(assertWorkspaceAccess)).toHaveBeenCalledWith(expect.anything(), '')
      expect(res.status).toBe(200) // permissive mock lets the handler proceed
    })
  })

  describe('POST /:fileId/interpret', () => {
    it('returns interpretation from index', async () => {
      const res = await app.request('/api/doc-memory/test-file-id/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: WS }),
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
    it('returns decision trails from DB (file resolved → workspace guarded)', async () => {
      selectQueue.push([{ workspaceId: WS }]) // the file pre-load
      const res = await app.request('/api/doc-memory/test-file-id/trail/intro', {
        method: 'GET',
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.error).toBeNull()
      expect(Array.isArray(body.data)).toBe(true)
      expect(vi.mocked(assertWorkspaceAccess)).toHaveBeenCalledWith(expect.anything(), WS)
    })

    it('404s when the file does not exist', async () => {
      // queue empty → file pre-load resolves []
      const res = await app.request('/api/doc-memory/missing-file/trail/intro', {
        method: 'GET',
      })
      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /patterns/:patternId', () => {
    it('updates pattern dismissed state', async () => {
      selectQueue.push([{ workspaceId: WS }]) // the pattern pre-load
      const res = await app.request('/api/doc-memory/patterns/pat-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: true }),
      })

      expect(res.status).toBe(200)
      expect(vi.mocked(assertWorkspaceAccess)).toHaveBeenCalledWith(expect.anything(), WS)
    })

    it('rejects empty update body', async () => {
      selectQueue.push([{ workspaceId: WS }]) // the pattern pre-load
      const res = await app.request('/api/doc-memory/patterns/pat-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
    })

    it('404s when the pattern does not exist', async () => {
      const res = await app.request('/api/doc-memory/patterns/missing-pat', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: true }),
      })
      expect(res.status).toBe(404)
    })
  })
})
