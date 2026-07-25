/**
 * API client hook — fetch wrapper with auth headers, base URL from storage.
 */

import { useCallback } from 'react'
import { useExtensionStore } from '@/stores/extension-store'
import { STORAGE_KEYS, DEFAULT_API_BASE_URL } from '@/lib/constants'

interface ApiResponse<T = unknown> {
  data?: T
  error?: { message: string; status?: number }
}

async function getStoredAuth(): Promise<{
  token: string | null
  userId: string | null
  workspaceId: string | null
  apiBaseUrl: string
}> {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.AUTH_TOKEN,
    STORAGE_KEYS.USER_ID,
    STORAGE_KEYS.WORKSPACE_ID,
    STORAGE_KEYS.API_BASE_URL,
  ])
  return {
    token: (data[STORAGE_KEYS.AUTH_TOKEN] as string) ?? null,
    userId: (data[STORAGE_KEYS.USER_ID] as string) ?? null,
    workspaceId: (data[STORAGE_KEYS.WORKSPACE_ID] as string) ?? null,
    apiBaseUrl: (data[STORAGE_KEYS.API_BASE_URL] as string) ?? DEFAULT_API_BASE_URL,
  }
}

function buildHeaders(auth: { token: string | null; userId: string | null; workspaceId: string | null }): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`
  if (auth.userId) headers['x-user-id'] = auth.userId
  if (auth.workspaceId) headers['x-workspace-id'] = auth.workspaceId
  return headers
}

export function useApi() {
  const apiBaseUrl = useExtensionStore((s) => s.apiBaseUrl)

  const get = useCallback(
    async <T = unknown>(path: string): Promise<ApiResponse<T>> => {
      try {
        const auth = await getStoredAuth()
        const baseUrl = auth.apiBaseUrl || apiBaseUrl
        // Auto-inject workspaceId as query param if not already present
        const separator = path.includes('?') ? '&' : '?'
        const urlPath = auth.workspaceId && !path.includes('workspaceId')
          ? `${path}${separator}workspaceId=${auth.workspaceId}`
          : path
        const res = await fetch(`${baseUrl}${urlPath}`, {
          headers: buildHeaders(auth),
        })
        if (!res.ok) {
          return { error: { message: `HTTP ${res.status}`, status: res.status } }
        }
        const data = await res.json()
        return { data: data.data ?? data }
      } catch (err) {
        return { error: { message: (err as Error).message } }
      }
    },
    [apiBaseUrl]
  )

  const post = useCallback(
    async <T = unknown>(path: string, body: unknown): Promise<ApiResponse<T>> => {
      try {
        const auth = await getStoredAuth()
        const baseUrl = auth.apiBaseUrl || apiBaseUrl
        // Auto-inject workspaceId into POST body if not already present
        const enrichedBody = auth.workspaceId && typeof body === 'object' && body !== null && !('workspaceId' in body)
          ? { ...body, workspaceId: auth.workspaceId }
          : body
        const res = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: buildHeaders(auth),
          body: JSON.stringify(enrichedBody),
        })
        if (!res.ok) {
          const text = await res.text()
          return { error: { message: text || `HTTP ${res.status}`, status: res.status } }
        }
        const data = await res.json()
        return { data: data.data ?? data }
      } catch (err) {
        return { error: { message: (err as Error).message } }
      }
    },
    [apiBaseUrl]
  )

  const del = useCallback(
    async <T = unknown>(path: string): Promise<ApiResponse<T>> => {
      try {
        const auth = await getStoredAuth()
        const baseUrl = auth.apiBaseUrl || apiBaseUrl
        const res = await fetch(`${baseUrl}${path}`, {
          method: 'DELETE',
          headers: buildHeaders(auth),
        })
        if (!res.ok) {
          return { error: { message: `HTTP ${res.status}`, status: res.status } }
        }
        const data = await res.json()
        return { data: data.data ?? data }
      } catch (err) {
        return { error: { message: (err as Error).message } }
      }
    },
    [apiBaseUrl]
  )

  return { get, post, del }
}
