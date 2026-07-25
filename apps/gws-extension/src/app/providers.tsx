/**
 * Extension providers — auth context, feature toggles, stores.
 * Wraps the extension React app with necessary context providers.
 */

import React, { useEffect, type ReactNode } from 'react'
import { useExtensionStore } from '@/stores/extension-store'
import { useFeatureToggleStore } from '@/stores/feature-toggle-store'
import { sendToBackground } from '@/lib/message-passing'

interface ProvidersProps {
  children: ReactNode
  googleDocId: string
  docType: string
}

export function Providers({ children, googleDocId, docType }: ProvidersProps) {
  const setAuth = useExtensionStore((s) => s.setAuth)
  const setConnected = useExtensionStore((s) => s.setConnected)

  // Load auth state from chrome.storage on mount
  useEffect(() => {
    const loadAuth = async () => {
      const result = await sendToBackground({ type: 'AUTH_TOKEN_GET' })
      if (result.success && result.data) {
        const { token, userId, workspaceId, apiBaseUrl } = result.data as {
          token?: string
          userId?: string
          workspaceId?: string
          apiBaseUrl?: string
        }
        if (token && userId && workspaceId) {
          setAuth({
            userId,
            workspaceId,
            apiBaseUrl: apiBaseUrl || 'http://localhost:3001',
          })
          setConnected(true)
        }
      }
    }
    loadAuth()
  }, [setAuth, setConnected])

  // Load feature toggle state from chrome.storage on mount
  useEffect(() => {
    useFeatureToggleStore.getState().loadFromStorage()
  }, [])

  return <>{children}</>
}
