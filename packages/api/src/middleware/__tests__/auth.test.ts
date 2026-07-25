import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { API_TOKEN_ISSUER, API_TOKEN_AUDIENCE } from '../../lib/api-token'
import { DEV_USER } from '@workspace/shared/constants'

// Mock the DB: authMiddleware does `const [user] = await db.select().from(users).where(...)`
const mockWhere = vi.fn()
vi.mock('../../db/index', () => ({
  db: { select: () => ({ from: () => ({ where: mockWhere }) }) },
}))

const SECRET = 'test-auth-api-secret-0123456789-abcdef'
const USER_ROW = { id: 'user-from-token', email: 'u@example.com', name: 'U', avatarUrl: null }

async function mint(
  sub: string,
  opts: { secret?: string; iss?: string; aud?: string; expSeconds?: number } = {}
): Promise<string> {
  const {
    secret = SECRET,
    iss = API_TOKEN_ISSUER,
    aud = API_TOKEN_AUDIENCE,
    expSeconds = 1800,
  } = opts
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setIssuer(iss)
    .setAudience(aud)
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSeconds)
    .sign(new TextEncoder().encode(secret))
}

async function buildApp() {
  const { authMiddleware } = await import('../auth')
  const app = new Hono()
  app.use('*', authMiddleware)
  app.get('/test', (c) => c.json({ userId: c.get('userId') }))
  return app
}

describe('authMiddleware — Phase 3 (verified credentials only)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DEV_BYPASS_AUTH = 'false'
    process.env.AUTH_API_SECRET = SECRET
    delete process.env.AUTH_ACCEPT_LEGACY_USER_HEADER
  })

  it('valid bearer JWT → identity from the verified sub claim', async () => {
    mockWhere.mockResolvedValueOnce([USER_ROW])
    const token = await mint('user-from-token')
    const res = await (
      await buildApp()
    ).request('http://localhost/test', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { userId: string }).userId).toBe('user-from-token')
  })

  it('valid bearer JWT takes precedence over a (forged) x-user-id header', async () => {
    mockWhere.mockResolvedValueOnce([USER_ROW])
    const token = await mint('user-from-token')
    const res = await (
      await buildApp()
    ).request('http://localhost/test', {
      headers: { Authorization: `Bearer ${token}`, 'x-user-id': 'forged-victim-id' },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { userId: string }).userId).toBe('user-from-token')
  })

  it('expired bearer JWT → 401', async () => {
    const token = await mint('user-from-token', { expSeconds: -10 })
    const res = await (
      await buildApp()
    ).request('http://localhost/test', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })

  it('tampered/wrong-secret bearer JWT → 401', async () => {
    const token = await mint('user-from-token', { secret: 'a-totally-different-secret-999999' })
    const res = await (
      await buildApp()
    ).request('http://localhost/test', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })

  it('IMPERSONATION CLOSED: x-user-id header alone → 401, identity never resolved', async () => {
    const res = await (
      await buildApp()
    ).request('http://localhost/test', {
      headers: { 'x-user-id': 'victim-user-id' },
    })
    expect(res.status).toBe(401)
    expect(mockWhere).not.toHaveBeenCalled()
  })

  it('IMPERSONATION CLOSED: invalid bearer + x-user-id header → 401 (no fallthrough)', async () => {
    const badToken = await mint('someone', { secret: 'wrong-secret-aaaaaaaaaaaaaaaa' })
    const res = await (
      await buildApp()
    ).request('http://localhost/test', {
      headers: { Authorization: `Bearer ${badToken}`, 'x-user-id': 'victim-user-id' },
    })
    expect(res.status).toBe(401)
    expect(mockWhere).not.toHaveBeenCalled()
  })

  it('no credentials at all → 401', async () => {
    const res = await (await buildApp()).request('http://localhost/test')
    expect(res.status).toBe(401)
  })

  it('break-glass flag re-enables the legacy header path (emergency rollback)', async () => {
    process.env.AUTH_ACCEPT_LEGACY_USER_HEADER = 'true'
    mockWhere.mockResolvedValueOnce([{ ...USER_ROW, id: 'header-user' }])
    const res = await (
      await buildApp()
    ).request('http://localhost/test', {
      headers: { 'x-user-id': 'header-user' },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { userId: string }).userId).toBe('header-user')
  })

  it('DEV_BYPASS_AUTH keeps header identity for local dev clients', async () => {
    process.env.DEV_BYPASS_AUTH = 'true'
    mockWhere.mockResolvedValueOnce([{ ...USER_ROW, id: 'ext-user' }])
    const res = await (
      await buildApp()
    ).request('http://localhost/test', {
      headers: { 'x-user-id': 'ext-user' },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { userId: string }).userId).toBe('ext-user')
  })

  it('DEV_BYPASS_AUTH with no header falls back to the seeded dev user', async () => {
    process.env.DEV_BYPASS_AUTH = 'true'
    const res = await (await buildApp()).request('http://localhost/test')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { userId: string }).userId).toBe(DEV_USER.id)
  })
})
