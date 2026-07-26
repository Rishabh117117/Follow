import type { ApiResponse } from '@workspace/shared/types'
import { DEV_USER, DEV_WORKSPACE } from '@workspace/shared/constants'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''
const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true'

/**
 * Origin of the API server, for the few non-fetch consumers that need the raw
 * URL string: EventTracker's batched transport, `window.open` export downloads,
 * and bookmarklet embedding. For data calls use `authFetch` / `api` instead —
 * they add auth headers + credentials. Falls back to localhost:3001 in dev,
 * matching the pre-CLEAN-2 call sites (api-client's own fetches use a
 * same-origin '' fallback, which is correct for `authFetch`).
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

const DEV_HEADERS = {
  'x-user-id': DEV_USER.id,
  'x-workspace-id': DEV_WORKSPACE.id,
}

// AUTH-FIX-1: in-memory cache of the API bearer token minted by the same-origin
// /api/auth/api-token route (which reads the NextAuth session server-side and
// signs it with AUTH_API_SECRET). Re-minted silently when within REMINT_SKEW_MS
// of expiry — the mint is cookie-authed + same-origin, so it's invisible.
interface ApiTokenBundle {
  token: string
  expiresAt: number
  activeWorkspaceId: string | null
}
let tokenCache: ApiTokenBundle | null = null
const REMINT_SKEW_MS = 5 * 60 * 1000

async function getApiToken(): Promise<ApiTokenBundle | null> {
  if (tokenCache && tokenCache.expiresAt - Date.now() > REMINT_SKEW_MS) return tokenCache
  try {
    const res = await fetch('/api/auth/api-token', { credentials: 'include' })
    if (!res.ok) {
      tokenCache = null
      return null
    }
    tokenCache = (await res.json()) as ApiTokenBundle
    return tokenCache
  } catch {
    tokenCache = null
    return null
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  // Dev mode: hardcoded dev user headers (unchanged — preserves local ergonomics).
  if (DEV_BYPASS_AUTH) {
    // Even in dev mode, try to extract workspace ID from URL for correct routing
    if (typeof window !== 'undefined') {
      const wsMatch = window.location.pathname.match(/\/workspace\/([0-9a-f-]{36})/)
      if (wsMatch) {
        return { ...DEV_HEADERS, 'x-workspace-id': wsMatch[1]! }
      }
    }
    return DEV_HEADERS
  }

  if (typeof window === 'undefined') return {}

  // AUTH-FIX-1: authenticate with a VERIFIED bearer token — the API derives
  // identity from the token's signature, never from the forgeable x-user-id
  // header. If no token can be minted (not signed in / mint failed), send no
  // auth headers and let the API return 401. NO dev-user fallback here.
  const bundle = await getApiToken()
  if (!bundle) return {}

  const headers: Record<string, string> = { Authorization: `Bearer ${bundle.token}` }
  // teams-1: the URL is the source of truth for "which workspace am I in".
  // Prefer the `/workspace/<uuid>` in the path over the mint bundle's
  // activeWorkspaceId (the per-session default) — otherwise a workspace switch
  // wouldn't take effect until the cached bearer re-mints (~25 min). This is
  // safe post security-gate-1: the membership guard verifies whatever workspace
  // the header claims, so a non-member just gets a 403. Off a workspace route
  // (e.g. /settings/*), fall back to the default workspace.
  let ws = ''
  if (typeof window !== 'undefined') {
    const wsMatch = window.location.pathname.match(/\/workspace\/([0-9a-f-]{36})/)
    if (wsMatch) ws = wsMatch[1]!
  }
  if (!ws) ws = bundle.activeWorkspaceId ?? ''
  if (ws) headers['x-workspace-id'] = ws
  return headers
}

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...options.headers,
    },
    credentials: 'include',
  })
  return res.json() as Promise<ApiResponse<T>>
}

/**
 * authFetch — drop-in replacement for `fetch(url, { credentials: 'include', ...})`
 * in contexts where you can't use the typed `api` helpers (non-JSON responses,
 * query-param GETs with custom headers, streaming reads). Injects the same
 * x-user-id / x-workspace-id headers the `api` helpers do.
 *
 * STABILIZE-2: needed because API auth is header-based and web auth is JWT-only,
 * so `credentials: 'include'` alone gets you dev-bypass fallback — wrong user.
 */
export async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const authHeaders = await getAuthHeaders()
  const url = path.startsWith('http') ? path : `${API_URL}${path}`
  return fetch(url, {
    ...options,
    headers: {
      ...authHeaders,
      ...options.headers,
    },
    credentials: 'include',
  })
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: async <T>(path: string, formData: FormData): Promise<ApiResponse<T>> => {
    const authHeaders = await getAuthHeaders()
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: authHeaders,
      body: formData,
      credentials: 'include',
    })
    return res.json() as Promise<ApiResponse<T>>
  },
}
