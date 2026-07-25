/**
 * Extension auth hook — reads token from chrome.storage, connects to Follow backend.
 */

import { useEffect, useCallback } from 'react'
import { useExtensionStore } from '@/stores/extension-store'
import { sendToBackground } from '@/lib/message-passing'

export function useAuth() {
  const { isAuthenticated, userId, workspaceId, apiBaseUrl, setAuth, clearAuth } =
    useExtensionStore()

  // Load auth state from chrome.storage on mount
  useEffect(() => {
    const loadAuth = async () => {
      const result = await sendToBackground({ type: 'AUTH_TOKEN_GET' })
      if (result.success && result.data) {
        const { token, userId: uid, workspaceId: wid, apiBaseUrl: url } = result.data as {
          token?: string
          userId?: string
          workspaceId?: string
          apiBaseUrl?: string
        }
        if (token && uid && wid) {
          setAuth({
            userId: uid,
            workspaceId: wid,
            apiBaseUrl: url || 'http://localhost:3001',
          })
        }
      }
    }
    loadAuth()
  }, [setAuth])

  const login = useCallback(
    async (token: string, uid: string, wid: string, baseUrl?: string) => {
      await sendToBackground({
        type: 'AUTH_TOKEN_SET',
        payload: {
          token,
          userId: uid,
          workspaceId: wid,
          apiBaseUrl: baseUrl,
        },
      })
      setAuth({
        userId: uid,
        workspaceId: wid,
        apiBaseUrl: baseUrl || 'http://localhost:3001',
      })
    },
    [setAuth]
  )

  const logout = useCallback(async () => {
    await sendToBackground({ type: 'AUTH_TOKEN_CLEAR' })
    clearAuth()
  }, [clearAuth])

  return {
    isAuthenticated,
    userId,
    workspaceId,
    apiBaseUrl,
    login,
    logout,
  }
}
