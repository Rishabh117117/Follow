/* eslint-disable @typescript-eslint/no-explicit-any -- mock-heavy test file */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Index Query Route — unit tests
 *
 * Tests the POST /api/index/query endpoint.
 */

// ─── Mock Setup ──────────────────────────────────────────────────────────────

const { mockDbSelect, mockDbInsert } = vi.hoisted(() => {
  function _makeSelectChain(value: unknown[] = []) {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve(value)),
      groupBy: vi.fn(() => chain),
      then: (resolve: any, reject: any) => Promise.resolve(value).then(resolve, reject),
    }
    return chain
  }

  return {
    mockDbSelect: vi.fn(() => _makeSelectChain([])),
    mockDbInsert: vi.fn(),
  }
})

vi.mock('../../db/index', () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}))

vi.mock('../../db/schema/index', () => ({
  indexRecords: {
    workspaceId: 'workspaceId',
    threadEventId: 'threadEventId',
    threadType: 'threadType',
    eventTime: 'eventTime',
    episodeId: 'episodeId',
    documentId: 'documentId',
    isAIInvolved: 'isAIInvolved',
    indexMagnitude: 'indexMagnitude',
  },
  evidenceRecords: { indexRecordId: 'indexRecordId' },
  episodes: { id: 'id' },
  strandCollaborators: { strandId: 'strandId', userId: 'userId' },
}))

vi.mock('../../db/schema/threads', () => ({
  strandCollaborators: { strandId: 'strandId', userId: 'userId' },
}))

vi.mock('../../services/embedding', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
  hasEmbeddingSupport: vi.fn().mockReturnValue(true),
}))

vi.mock('../../services/semantic-index/weighted-referencing', async () => {
  const actual = await vi.importActual('../../services/semantic-index/weighted-referencing')
  return {
    ...actual,
    scoreResults: vi.fn().mockReturnValue([]),
  }
})

vi.mock('../../services/semantic-index/permission-filter', async () => {
  const actual = await vi.importActual('../../services/semantic-index/permission-filter')
  return {
    ...actual,
    applyPermissions: vi.fn().mockReturnValue([]),
  }
})

vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set('userId', 'test-user-id')
    await next()
  }),
}))

// security-gate-1: membership enforcement has its own tests (services/__tests__/
// workspace-access.test.ts + __tests__/security-gate.test.ts); unit tests mock
// it permissive so route logic stays the subject under the flat db fake.
vi.mock('../../services/workspace-access', () => ({
  assertWorkspaceAccess: vi.fn().mockResolvedValue(null),
  checkWorkspaceAccess: vi.fn().mockResolvedValue({ ok: true, role: 'owner' }),
}))

import { indexQueryRouter } from '../index-query'
import { Hono } from 'hono'

describe('IndexQueryRoute', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.route('/api/index', indexQueryRouter)
  })

  it('returns 200 with valid query', async () => {
    const res = await app.request('/api/index/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'test query',
        workspaceId: '00000000-0000-0000-0000-000000000001',
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body).toHaveProperty('data')
    expect(body).toHaveProperty('error', null)
    expect(body.data).toHaveProperty('results')
    expect(body.data).toHaveProperty('totalCandidates')
    expect(body.data).toHaveProperty('profile')
  })

  it('validates workspaceId is UUID', async () => {
    const res = await app.request('/api/index/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'test',
        workspaceId: 'not-a-uuid',
      }),
    })

    expect(res.status).toBe(400)
  })

  it('accepts all weight profiles', async () => {
    for (const profile of ['history', 'focused', 'realtime', 'ai_usage', 'proactive', 'evidence']) {
      const res = await app.request('/api/index/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: '00000000-0000-0000-0000-000000000001',
          weightProfile: profile,
        }),
      })

      expect(res.status).toBe(200)
    }
  })

  it('rejects invalid weight profile', async () => {
    const res = await app.request('/api/index/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'test',
        workspaceId: '00000000-0000-0000-0000-000000000001',
        weightProfile: 'invalid_profile',
      }),
    })

    expect(res.status).toBe(400)
  })

  it('defaults to history profile when not specified', async () => {
    const res = await app.request('/api/index/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: '00000000-0000-0000-0000-000000000001',
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.data.profile).toBe('history')
  })

  it('enforces limit maximum of 200', async () => {
    const res = await app.request('/api/index/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: '00000000-0000-0000-0000-000000000001',
        limit: 500,
      }),
    })

    expect(res.status).toBe(400) // fails Zod validation
  })

  it('accepts optional filters', async () => {
    const res = await app.request('/api/index/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: '00000000-0000-0000-0000-000000000001',
        documentId: '00000000-0000-0000-0000-000000000002',
        threadTypes: ['doc', 'ai'],
        aiOnly: true,
        magnitudeMin: 'medium',
        timeRangeMinutes: 60,
        includeEvidence: true,
        includeEpisodes: true,
        limit: 25,
      }),
    })

    expect(res.status).toBe(200)
  })
})
