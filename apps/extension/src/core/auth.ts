/**
 * Auth — shared auth header construction for API calls.
 */

import { getAuth } from './storage'

/**
 * Build auth headers for backend API calls.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const auth = await getAuth()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`
  if (auth.userId) headers['x-user-id'] = auth.userId
  if (auth.workspaceId) headers['x-workspace-id'] = auth.workspaceId

  return headers
}

/**
 * Get the API base URL from storage.
 */
export async function getApiBaseUrl(): Promise<string> {
  const auth = await getAuth()
  return auth.apiBaseUrl
}

/**
 * Check if the user is authenticated (has userId and workspaceId stored).
 */
export async function isAuthenticated(): Promise<boolean> {
  const auth = await getAuth()
  return !!(auth.userId && auth.workspaceId)
}
