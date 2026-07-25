import * as SecureStore from 'expo-secure-store'

const USER_ID_KEY = 'follow.auth.userId'
const WORKSPACE_ID_KEY = 'follow.auth.workspaceId'
const USER_KEY = 'follow.auth.user'

export type StoredUser = {
  id: string
  name: string
  email: string
  avatarUrl?: string | null
  workspaceId: string
}

export async function getUserId(): Promise<string | null> {
  return SecureStore.getItemAsync(USER_ID_KEY)
}

export async function getWorkspaceId(): Promise<string | null> {
  return SecureStore.getItemAsync(WORKSPACE_ID_KEY)
}

export async function setSession(user: StoredUser): Promise<void> {
  await SecureStore.setItemAsync(USER_ID_KEY, user.id)
  await SecureStore.setItemAsync(WORKSPACE_ID_KEY, user.workspaceId)
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user))
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(USER_ID_KEY)
  await SecureStore.deleteItemAsync(WORKSPACE_ID_KEY)
  await SecureStore.deleteItemAsync(USER_KEY)
}

export async function getStoredUser(): Promise<StoredUser | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredUser
  } catch {
    return null
  }
}

/** Back-compat convenience — returns userId as "token" for layouts that still check presence. */
export async function hasSession(): Promise<boolean> {
  return (await getUserId()) !== null
}
