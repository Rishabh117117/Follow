'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { EventTracker } from '@workspace/shared/events/tracker'
import { API_BASE } from '@/lib/api-client'

let globalTracker: EventTracker | null = null

function getTracker(userId: string, workspaceId: string): EventTracker {
  if (!globalTracker) {
    globalTracker = new EventTracker({
      apiUrl: API_BASE,
      flushIntervalMs: 2000,
      getHeaders: () => ({
        'x-user-id': userId,
        'x-workspace-id': workspaceId,
      }),
    })
    globalTracker.start()
  }
  return globalTracker
}

export function useTrackEvent() {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const workspaceId = (session?.user as { activeWorkspaceId?: string } | undefined)
    ?.activeWorkspaceId

  const track = useCallback(
    (event: {
      actionType: string
      objectType: string
      objectId: string
      objectName?: string
      payload?: Record<string, unknown>
      durationMs?: number | null
    }) => {
      if (!userId || !workspaceId) return
      const tracker = getTracker(userId, workspaceId)
      tracker.track(event)
    },
    [userId, workspaceId]
  )

  return track
}

export function useTrackView(objectType: string, objectId: string, objectName?: string) {
  const track = useTrackEvent()
  const startTimeRef = useRef<number>(0)

  useEffect(() => {
    startTimeRef.current = Date.now()

    return () => {
      const durationMs = Date.now() - startTimeRef.current
      if (durationMs > 1000) {
        track({
          actionType: 'view',
          objectType,
          objectId,
          objectName,
          durationMs,
        })
      }
    }
  }, [objectType, objectId, objectName, track])
}
