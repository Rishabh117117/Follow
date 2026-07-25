/* eslint-disable @typescript-eslint/no-explicit-any -- mock-heavy test file */
import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeSelectChain(value: unknown[] = []) {
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(value)),
    then: (resolve: any, reject: any) => Promise.resolve(value).then(resolve, reject),
  }
  return chain
}

vi.mock('../../db/index', () => ({
  db: {
    select: vi.fn(() => makeSelectChain([])),
    selectDistinct: vi.fn(() => makeSelectChain([])),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}))

vi.mock('../../db/schema/semantic-index', () => ({
  indexRecords: {
    userId: 'userId',
    workspaceId: 'workspaceId',
    documentId: 'documentId',
    userName: 'userName',
  },
  evidenceRecords: {
    id: 'id',
    documentId: 'documentId',
    evidenceType: 'evidenceType',
    userId: 'userId',
    ownershipTier: 'ownershipTier',
    retentionPolicy: 'retentionPolicy',
    createdAt: 'createdAt',
    recordHash: 'recordHash',
  },
}))

vi.mock('../../db/schema/workspaces', () => ({
  workspaces: { id: 'id', metadata: 'metadata' },
}))

vi.mock('../../services/semantic-index/hash-chain', () => ({
  computeRecordHash: vi.fn().mockReturnValue('hash123'),
  getLastEvidenceHash: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set('userId', 'admin-user')
    c.set('workspaceId', '00000000-0000-0000-0000-000000000001')
    await next()
  }),
}))

vi.mock('../../middleware/permissions', () => ({
  requirePermission: vi.fn(() => async (_c: any, next: any) => await next()),
}))

// security-gate-1: assertWorkspaceAdmin now checks the BODY workspace via
// checkWorkspaceAccess; membership itself is covered by the guard's own tests.
vi.mock('../../services/workspace-access', () => ({
  assertWorkspaceAccess: vi.fn().mockResolvedValue(null),
  checkWorkspaceAccess: vi.fn().mockResolvedValue({ ok: true, role: 'admin' }),
}))

import { adminRouter } from '../admin'
import { Hono } from 'hono'

describe('Admin Routes', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.route('/api/admin', adminRouter)
  })

  describe('POST /gdpr-redact', () => {
    it('returns 200 on successful redaction', async () => {
      const res = await app.request('/api/admin/gdpr-redact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: '00000000-0000-0000-0000-000000000002',
          workspaceId: '00000000-0000-0000-0000-000000000001',
        }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.data).toHaveProperty('redactedEvidenceRecords')
      expect(body.data).toHaveProperty('anonymizedIndexRecords')
    })

    it('validates required fields', async () => {
      const res = await app.request('/api/admin/gdpr-redact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
    })
  })

  describe('POST /legal-hold', () => {
    it('creates a legal hold', async () => {
      const res = await app.request('/api/admin/legal-hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: '00000000-0000-0000-0000-000000000003',
          workspaceId: '00000000-0000-0000-0000-000000000001',
          reason: 'Pending litigation',
        }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.data.status).toBe('legal_hold_active')
    })
  })

  describe('DELETE /legal-hold', () => {
    it('returns 404 when no active hold exists', async () => {
      const res = await app.request('/api/admin/legal-hold', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: '00000000-0000-0000-0000-000000000003',
          reason: 'Litigation resolved',
        }),
      })

      expect(res.status).toBe(404)
    })
  })

  describe('POST /retention-policy', () => {
    it('sets retention policy', async () => {
      const res = await app.request('/api/admin/retention-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: '00000000-0000-0000-0000-000000000001',
          policy: 'sox_7yr',
          retentionYears: 7,
        }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.data.policy).toBe('sox_7yr')
    })

    it('validates policy enum', async () => {
      const res = await app.request('/api/admin/retention-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: '00000000-0000-0000-0000-000000000001',
          policy: 'invalid_policy',
        }),
      })

      expect(res.status).toBe(400)
    })
  })
})
