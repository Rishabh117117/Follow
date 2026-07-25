'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api-client'

interface AIStateTension {
  id: string
  description: string
  severity: 'low' | 'medium' | 'high'
  sections: string[]
  tentative: boolean
  resolvedAt: string | null
}

interface TeamUpdate {
  fromUserName: string
  memory: string
  relevantSection: string | null
  surfaced: boolean
}

interface AIStateData {
  tensions: AIStateTension[]
  newFromTeam: TeamUpdate[]
  activeTensionCount: number
  hasUnsurfacedTeamUpdates: boolean
}

export function useAIState(
  workspaceId: string | undefined,
  documentId: string | undefined
): AIStateData & { markTeamUpdateSurfaced: () => void } {
  const [data, setData] = useState<AIStateData>({
    tensions: [],
    newFromTeam: [],
    activeTensionCount: 0,
    hasUnsurfacedTeamUpdates: false,
  })

  const fetchState = useCallback(async () => {
    if (!workspaceId) return

    try {
      const result = await api.get<{
        event?: { activeTensions?: AIStateTension[] }
        session?: { newFromTeam?: TeamUpdate[] }
      }>(
        `/api/ai-state?workspaceId=${workspaceId}${documentId ? `&documentId=${documentId}` : ''}`
      )

      if (!result.data) return

      const state = result.data
      const tensions = state.event?.activeTensions || []
      const newFromTeam = state.session?.newFromTeam || []

      setData({
        tensions: tensions.filter((t) => !t.resolvedAt),
        newFromTeam,
        activeTensionCount: tensions.filter(
          (t) => !t.resolvedAt && (t.severity === 'medium' || t.severity === 'high')
        ).length,
        hasUnsurfacedTeamUpdates: newFromTeam.some((m) => !m.surfaced),
      })
    } catch {
      // Silently fail — ambient indicators degrade gracefully
    }
  }, [workspaceId, documentId])

  useEffect(() => {
    fetchState()
    const interval = setInterval(fetchState, 30_000)
    return () => clearInterval(interval)
  }, [fetchState])

  const markTeamUpdateSurfaced = useCallback(() => {
    setData((prev) => ({
      ...prev,
      newFromTeam: prev.newFromTeam.map((m) => ({ ...m, surfaced: true })),
      hasUnsurfacedTeamUpdates: false,
    }))
    api.post('/api/ai-state/mark-surfaced', { workspaceId }).catch(() => {})
  }, [workspaceId])

  return { ...data, markTeamUpdateSurfaced }
}
