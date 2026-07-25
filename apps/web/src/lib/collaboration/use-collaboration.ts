'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import {
  getCollaborationProvider,
  releaseCollaborationProvider,
  userIdToColor,
} from './yjs-provider'

export interface CollaboratorInfo {
  name: string
  color: string
  userId: string
  cursor?: { anchor: number; head: number }
}

export interface UseCollaborationReturn {
  doc: Y.Doc | null
  provider: WebsocketProvider | null
  connected: boolean
  collaborators: CollaboratorInfo[]
  synced: boolean
}

/**
 * React hook for Yjs collaboration on a document.
 * Manages connection lifecycle and awareness tracking.
 */
export function useCollaboration(
  fileId: string | null,
  workspaceId: string | null
): UseCollaborationReturn {
  const { data: session } = useSession()
  const [connected, setConnected] = useState(false)
  const [synced, setSynced] = useState(false)
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([])
  const docRef = useRef<Y.Doc | null>(null)
  const providerRef = useRef<WebsocketProvider | null>(null)
  const docNameRef = useRef<string | null>(null)

  const userId = session?.user?.id
  const userName = session?.user?.name ?? 'Anonymous'

  const userColor = useMemo(() => (userId ? userIdToColor(userId) : '#60a5fa'), [userId])

  useEffect(() => {
    if (!fileId || !workspaceId || !userId) return

    const docName = `${workspaceId}:${fileId}`
    docNameRef.current = docName

    const { doc, provider } = getCollaborationProvider({
      docName,
      userId,
      userName,
      userColor,
    })

    docRef.current = doc
    providerRef.current = provider

    // Track connection status
    const handleStatus = ({ status }: { status: string }) => {
      setConnected(status === 'connected')
    }
    provider.on('status', handleStatus)

    // Track sync status
    const handleSync = (isSynced: boolean) => {
      setSynced(isSynced)
    }
    provider.on('sync', handleSync)

    // Track awareness (collaborators)
    const handleAwarenessChange = () => {
      const states = provider.awareness.getStates() as Map<number, { user?: CollaboratorInfo }>
      const collabs: CollaboratorInfo[] = []
      states.forEach((state, clientId) => {
        if (clientId !== doc.clientID && state.user) {
          collabs.push(state.user)
        }
      })
      setCollaborators(collabs)
    }
    provider.awareness.on('change', handleAwarenessChange)

    // Initial awareness state
    handleAwarenessChange()

    return () => {
      provider.off('status', handleStatus)
      provider.off('sync', handleSync)
      provider.awareness.off('change', handleAwarenessChange)
      releaseCollaborationProvider(docName)
      docRef.current = null
      providerRef.current = null
      docNameRef.current = null
      setConnected(false)
      setSynced(false)
      setCollaborators([])
    }
  }, [fileId, workspaceId, userId, userName, userColor])

  return {
    doc: docRef.current,
    provider: providerRef.current,
    connected,
    collaborators,
    synced,
  }
}

/**
 * Hook for auto-saving Yjs document content to the API.
 */
export function useAutoSave(
  doc: Y.Doc | null,
  fileId: string | null,
  options: { debounceMs?: number; onSave?: () => void } = {}
) {
  const { debounceMs = 2000, onSave } = options
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef<Uint8Array | null>(null)

  const save = useCallback(async () => {
    if (!doc || !fileId) return

    try {
      const { encodeStateAsUpdate } = await import('yjs')
      const state = encodeStateAsUpdate(doc)

      // Skip if nothing changed
      if (lastSavedRef.current && arraysEqual(state, lastSavedRef.current)) {
        return
      }

      const { api } = await import('@/lib/api-client')
      await api.patch(`/api/files/${fileId}`, {
        metadata: {
          yjsState: Buffer.from(state).toString('base64'),
          lastSavedAt: new Date().toISOString(),
        },
      })

      lastSavedRef.current = state
      onSave?.()
    } catch (err) {
      console.error('[AutoSave] Failed to save:', err)
    }
  }, [doc, fileId, onSave])

  useEffect(() => {
    if (!doc) return

    const handleUpdate = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(save, debounceMs)
    }

    doc.on('update', handleUpdate)

    return () => {
      doc.off('update', handleUpdate)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        // Save on unmount
        save()
      }
    }
  }, [doc, save, debounceMs])

  return { save }
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
