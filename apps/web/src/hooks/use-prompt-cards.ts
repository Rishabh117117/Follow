'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { api } from '@/lib/api-client'
import type { PromptCardData } from '@/components/chat/prompt-card'

interface UsePromptCardsOptions {
  workspaceId: string
  enabled?: boolean
  pollIntervalMs?: number
}

interface UsePromptCardsReturn {
  cards: PromptCardData[]
  dismissCard: (cardId: string) => void
  dismissAll: () => void
}

/**
 * Hook to poll for proactive prompt cards and manage their display.
 * In the future, this will use WebSocket for real-time delivery.
 */
export function usePromptCards({
  workspaceId,
  enabled = true,
  pollIntervalMs = 30000, // Poll every 30s
}: UsePromptCardsOptions): UsePromptCardsReturn {
  const { data: session } = useSession()
  const [cards, setCards] = useState<PromptCardData[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchCards = useCallback(async () => {
    if (!workspaceId || !session?.user?.id) return

    try {
      const res = await api.get<PromptCardData[]>(`/api/prompting/cards?workspaceId=${workspaceId}`)
      if (res.data && res.data.length > 0) {
        setCards((prev) => {
          // Merge new cards, avoiding duplicates
          const existingIds = new Set(prev.map((c) => c.id))
          const newCards = res.data!.filter((c) => !existingIds.has(c.id))
          return [...prev, ...newCards]
        })
      }
    } catch {
      // Silently fail — polling is best-effort
    }
  }, [workspaceId, session?.user?.id])

  useEffect(() => {
    if (!enabled) return

    // Initial fetch
    fetchCards()

    // Set up polling
    intervalRef.current = setInterval(fetchCards, pollIntervalMs)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [enabled, fetchCards, pollIntervalMs])

  const dismissCard = useCallback((cardId: string) => {
    setCards((prev) => prev.filter((c) => c.id !== cardId))
  }, [])

  const dismissAll = useCallback(() => {
    setCards([])
    if (workspaceId) {
      api.post(`/api/prompting/cards/dismiss-all?workspaceId=${workspaceId}`, {}).catch(() => {
        // Best-effort
      })
    }
  }, [workspaceId])

  return { cards, dismissCard, dismissAll }
}
