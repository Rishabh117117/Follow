import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createHmac } from 'crypto'

// Mock the DB module
const mockFrom = vi.fn()
const mockWhere = vi.fn()
const mockLimit = vi.fn()
const mockSet = vi.fn()

vi.mock('../../db/index', () => ({
  db: {
    select: () => ({ from: mockFrom }),
    update: () => ({ set: mockSet }),
  },
}))

vi.mock('../../db/schema/collaboration', () => ({
  apiKeys: { keyHash: 'key_hash', id: 'id' },
}))

// Set up the chain for select().from().where().limit()
mockFrom.mockReturnValue({ where: mockWhere })
mockWhere.mockReturnValue({ limit: mockLimit })
mockSet.mockReturnValue({ where: vi.fn().mockReturnValue({ catch: vi.fn() }) })

describe('API Key Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects requests without Bearer token', async () => {
    const { apiKeyAuthMiddleware } = await import('../api-key-auth')

    const app = new Hono()
    app.use('*', apiKeyAuthMiddleware)
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('http://localhost/test')
    expect(res.status).toBe(401)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json()) as any
    expect(json.error.code).toBe('UNAUTHORIZED')
  })

  it('rejects requests with non-wsp Bearer token', async () => {
    const { apiKeyAuthMiddleware } = await import('../api-key-auth')

    const app = new Hono()
    app.use('*', apiKeyAuthMiddleware)
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('http://localhost/test', {
      headers: { Authorization: 'Bearer sk_regular_token' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects invalid API key', async () => {
    mockLimit.mockResolvedValueOnce([]) // No matching key

    const { apiKeyAuthMiddleware } = await import('../api-key-auth')

    const app = new Hono()
    app.use('*', apiKeyAuthMiddleware)
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('http://localhost/test', {
      headers: { Authorization: 'Bearer wsp_invalid_key_12345' },
    })
    expect(res.status).toBe(401)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json()) as any
    expect(json.error.message).toContain('Invalid API key')
  })

  it('rejects expired API key', async () => {
    const pastDate = new Date(Date.now() - 86400000) // 1 day ago
    mockLimit.mockResolvedValueOnce([
      {
        id: 'key-1',
        keyHash: 'somehash',
        createdBy: 'user-1',
        workspaceId: 'ws-1',
        expiresAt: pastDate,
      },
    ])

    const { apiKeyAuthMiddleware } = await import('../api-key-auth')

    const app = new Hono()
    app.use('*', apiKeyAuthMiddleware)
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('http://localhost/test', {
      headers: { Authorization: 'Bearer wsp_some_valid_looking_key' },
    })
    expect(res.status).toBe(401)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json()) as any
    expect(json.error.message).toContain('expired')
  })

  it('accepts valid API key and sets context', async () => {
    const rawKey = 'wsp_test_valid_key_1234567890'
    const keyHash = createHmac('sha256', 'workspace-api-keys').update(rawKey).digest('hex')

    mockLimit.mockResolvedValueOnce([
      {
        id: 'key-1',
        keyHash,
        createdBy: 'user-123',
        workspaceId: 'ws-456',
        expiresAt: null,
      },
    ])

    const { apiKeyAuthMiddleware } = await import('../api-key-auth')

    const app = new Hono()
    app.use('*', apiKeyAuthMiddleware)
    app.get('/test', (c) =>
      c.json({
        userId: c.get('userId'),
        workspaceId: c.get('workspaceId'),
      })
    )

    const res = await app.request('http://localhost/test', {
      headers: { Authorization: `Bearer ${rawKey}` },
    })
    expect(res.status).toBe(200)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json()) as any
    expect(json.userId).toBe('user-123')
    expect(json.workspaceId).toBe('ws-456')
  })

  it('flex auth falls through to regular auth when no wsp token', async () => {
    const { createFlexAuthMiddleware } = await import('../api-key-auth')

    let regularAuthCalled = false
    const mockRegularAuth = vi.fn(async (_c: unknown, next: () => Promise<void>) => {
      regularAuthCalled = true
      await next()
    })

    const app = new Hono()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use('*', createFlexAuthMiddleware(mockRegularAuth as unknown as any))
    app.get('/test', (c) => c.json({ ok: true }))

    await app.request('http://localhost/test', {
      headers: { 'x-user-id': 'user-1' },
    })
    expect(regularAuthCalled).toBe(true)
  })
})
