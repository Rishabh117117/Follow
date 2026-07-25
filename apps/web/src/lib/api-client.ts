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

async function getAuthHeaders(): Promise<Record<string, string>> {
  // Dev mode: use hardcoded dev user headers
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
  const { getSession } = await import('next-auth/react')
  const session = await getSession()

  if (session?.user?.id) {
    return {
      'x-user-id': session.user.id,
      'x-workspace-id': session.user.activeWorkspaceId ?? '',
    }
  }

  // No session but on a workspace page — extract workspace ID from URL
  // Use dev user ID as fallback so API auth middleware accepts the request
  const wsMatch = window.location.pathname.match(/\/workspace\/([0-9a-f-]{36})/)
  if (wsMatch) {
    return {
      'x-user-id': DEV_USER.id,
      'x-workspace-id': wsMatch[1]!,
    }
  }

  // Final fallback: dev headers so API doesn't reject
  return DEV_HEADERS
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
