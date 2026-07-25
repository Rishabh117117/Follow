/**
 * Storage — typed chrome.storage.local helpers.
 */

import { STORAGE_KEYS } from '@/lib/constants'

export interface AuthData {
  token: string | null
  userId: string | null
  workspaceId: string | null
  apiBaseUrl: string
  email: string | null
  name: string | null
  avatarUrl: string | null
}

/**
 * Read auth credentials from chrome.storage.local.
 */
export async function getAuth(): Promise<AuthData> {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.AUTH_TOKEN,
    STORAGE_KEYS.USER_ID,
    STORAGE_KEYS.WORKSPACE_ID,
    STORAGE_KEYS.API_BASE_URL,
    STORAGE_KEYS.USER_EMAIL,
    STORAGE_KEYS.USER_NAME,
    STORAGE_KEYS.USER_AVATAR,
  ])

  return {
    token: (data[STORAGE_KEYS.AUTH_TOKEN] as string) || null,
    userId: (data[STORAGE_KEYS.USER_ID] as string) || null,
    workspaceId: (data[STORAGE_KEYS.WORKSPACE_ID] as string) || null,
    apiBaseUrl: (data[STORAGE_KEYS.API_BASE_URL] as string) || 'http://localhost:3001',
    email: (data[STORAGE_KEYS.USER_EMAIL] as string) || null,
    name: (data[STORAGE_KEYS.USER_NAME] as string) || null,
    avatarUrl: (data[STORAGE_KEYS.USER_AVATAR] as string) || null,
  }
}

/**
 * Write auth credentials to chrome.storage.local.
 */
export async function setAuth(auth: Partial<AuthData>): Promise<void> {
  const updates: Record<string, unknown> = {}
  if (auth.token !== undefined) updates[STORAGE_KEYS.AUTH_TOKEN] = auth.token
  if (auth.userId !== undefined) updates[STORAGE_KEYS.USER_ID] = auth.userId
  if (auth.workspaceId !== undefined) updates[STORAGE_KEYS.WORKSPACE_ID] = auth.workspaceId
  if (auth.apiBaseUrl !== undefined) updates[STORAGE_KEYS.API_BASE_URL] = auth.apiBaseUrl
  if (auth.email !== undefined) updates[STORAGE_KEYS.USER_EMAIL] = auth.email
  if (auth.name !== undefined) updates[STORAGE_KEYS.USER_NAME] = auth.name
  if (auth.avatarUrl !== undefined) updates[STORAGE_KEYS.USER_AVATAR] = auth.avatarUrl
  await chrome.storage.local.set(updates)
}

/**
 * Clear all auth data.
 */
export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove([
    STORAGE_KEYS.AUTH_TOKEN,
    STORAGE_KEYS.USER_ID,
    STORAGE_KEYS.WORKSPACE_ID,
    STORAGE_KEYS.USER_EMAIL,
    STORAGE_KEYS.USER_NAME,
    STORAGE_KEYS.USER_AVATAR,
    STORAGE_KEYS.ACTIVE_SMART_DOCS,
  ])
}

/**
 * Read feature toggles from chrome.storage.local.
 */
export async function getFeatureToggles(): Promise<Record<string, boolean>> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.FEATURE_TOGGLES)
  return (data[STORAGE_KEYS.FEATURE_TOGGLES] as Record<string, boolean>) || {}
}

/**
 * Write feature toggles to chrome.storage.local.
 */
export async function setFeatureToggles(toggles: Record<string, boolean>): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.FEATURE_TOGGLES]: toggles })
}

/**
 * Read/write active smart docs cache.
 */
export async function getActiveSmartDocs(): Promise<Record<string, unknown>> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_SMART_DOCS)
  return (data[STORAGE_KEYS.ACTIVE_SMART_DOCS] as Record<string, unknown>) || {}
}

export async function setActiveSmartDocs(docs: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_SMART_DOCS]: docs })
}
