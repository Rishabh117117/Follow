import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * AUTH-FIX-1: the web api-client must authenticate with a minted bearer token
 * and must NOT send the forgeable x-user-id header on the real (non-dev) path.
 */
describe('api-client getAuthHeaders (AUTH-FIX-1, non-dev path)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    vi.stubEnv('NEXT_PUBLIC_DEV_BYPASS_AUTH', '') // ensure non-dev path
  })

  it('mints a token and sends Authorization: Bearer (no x-user-id)', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = []
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url)
      const headers = Object.fromEntries(
        new Headers((init?.headers ?? {}) as HeadersInit).entries()
      )
      seen.push({ url: u, headers })
      if (u.includes('/api/auth/api-token')) {
        return new Response(
          JSON.stringify({
            token: 'tok-123',
            expiresAt: Date.now() + 30 * 60 * 1000,
            activeWorkspaceId: 'ws-9',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({ data: { ok: true }, error: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const { api } = await import('../api-client')
    await api.get('/some/endpoint')

    const minted = seen.find((c) => c.url.includes('/api/auth/api-token'))
    const apiCall = seen.find((c) => c.url.includes('/some/endpoint'))
    expect(minted).toBeTruthy()
    expect(apiCall).toBeTruthy()
    expect(apiCall!.headers['authorization']).toBe('Bearer tok-123')
    expect(apiCall!.headers['x-user-id']).toBeUndefined()
    expect(apiCall!.headers['x-workspace-id']).toBe('ws-9')
  })

  it('sends no auth headers when the mint route returns 401 (no dev-user fallback)', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = []
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url)
      seen.push({
        url: u,
        headers: Object.fromEntries(new Headers((init?.headers ?? {}) as HeadersInit).entries()),
      })
      if (u.includes('/api/auth/api-token')) {
        return new Response(JSON.stringify({ error: 'no session' }), { status: 401 })
      }
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const { api } = await import('../api-client')
    await api.get('/some/endpoint')

    const apiCall = seen.find((c) => c.url.includes('/some/endpoint'))
    expect(apiCall).toBeTruthy()
    expect(apiCall!.headers['authorization']).toBeUndefined()
    expect(apiCall!.headers['x-user-id']).toBeUndefined()
  })
})
