// @vitest-environment node
// (server-side route: matches its `runtime='nodejs'`; avoids jsdom's cross-realm
//  TextEncoder/Uint8Array quirk that breaks jose signing under the default env.)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { jwtVerify } from 'jose'

const mockAuth = vi.fn()
vi.mock('@/lib/auth', () => ({ auth: () => mockAuth() }))

const SECRET = 'test-auth-api-secret-0123456789-abcdef'

describe('GET /api/auth/api-token (AUTH-FIX-1 mint route)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AUTH_API_SECRET = SECRET
  })

  it('mints a verifiable HS256 token (sub=user.id, iss/aud pinned) for a valid session', async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: 'user-1', email: 'a@b.c', activeWorkspaceId: 'ws-1' },
    })
    const { GET } = await import('../route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      token: string
      expiresAt: number
      activeWorkspaceId: string | null
    }
    expect(typeof body.token).toBe('string')
    expect(body.activeWorkspaceId).toBe('ws-1')
    expect(body.expiresAt).toBeGreaterThan(Date.now())
    const { payload } = await jwtVerify(body.token, new TextEncoder().encode(SECRET), {
      issuer: 'workspace-web',
      audience: 'workspace-api',
      algorithms: ['HS256'],
    })
    expect(payload.sub).toBe('user-1')
  })

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const { GET } = await import('../route')
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns 500 when AUTH_API_SECRET is not configured', async () => {
    delete process.env.AUTH_API_SECRET
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } })
    const { GET } = await import('../route')
    const res = await GET()
    expect(res.status).toBe(500)
  })
})
