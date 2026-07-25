'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api-client'

// ─── Types ───

export interface DashboardEpisode {
  id: string
  title: string
  startTime: string
  endTime: string
  userNames: string[]
  surfaces: string[]
  hasKeyChange: boolean
  documentId: string
  documentTitle: string
  primarySection: string | null
}

export interface DocumentIntel {
  documentId: string
  phase: string | null
  editVelocity: string
  activeTensionCount: number
  activeContributors: number
  contributorAvatars: Array<{
    userId: string
    name: string
    isActive: boolean
  }>
  lastMajorChange: {
    description: string
    userName: string
    timestamp: string
  } | null
  aiInteractionCount: number
}

export interface WeekSummary {
  documentsWorkedOn: Array<{
    documentId: string
    title: string
    episodeCount: number
    eventCount: number
    timeSpentMinutes: number
  }>
  totalEpisodes: number
  totalAIInteractions: number
  aiAcceptanceRate: number | null
  workStyle: string | null
  productiveHours: [number, number] | null
  topSections: string[]
}

export interface DashboardData {
  recentEpisodes: DashboardEpisode[]
  documentIntel: Map<string, DocumentIntel>
  weekSummary: WeekSummary | null
  isLoading: boolean
  error: string | null
}

// ─── Hook ───

export function useDashboardData(workspaceId: string | undefined): DashboardData {
  const [data, setData] = useState<DashboardData>({
    recentEpisodes: [],
    documentIntel: new Map(),
    weekSummary: null,
    isLoading: true,
    error: null,
  })

  const fetchData = useCallback(async () => {
    if (!workspaceId) return

    try {
      const [episodesResult, stateResult] = await Promise.all([
        api.post<{
          results: any[]
          episodes: Record<string, any>
          totalCandidates: number
        }>('/api/index/query', {
          workspaceId,
          weightProfile: 'history',
          limit: 50,
          includeEpisodes: true,
          timeRangeMinutes: 7 * 24 * 60,
        }),

        api.get<any>(`/api/ai-state?workspaceId=${workspaceId}`),
      ])

      const episodes = processEpisodesForDashboard(
        episodesResult.data?.results || [],
        episodesResult.data?.episodes || {}
      )

      const weekSummary = buildWeekSummary(stateResult.data, episodes)

      setData({
        recentEpisodes: episodes,
        documentIntel: new Map(),
        weekSummary,
        isLoading: false,
        error: null,
      })
    } catch (err) {
      setData((prev) => ({
        ...prev,
        isLoading: false,
        error: (err as Error).message,
      }))
    }
  }, [workspaceId])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchData])

  return data
}

// ─── Per-document intel fetcher ───

export async function fetchDocumentIntel(
  workspaceId: string,
  documentId: string
): Promise<DocumentIntel | null> {
  try {
    const result = await api.get<any>(`/api/shared-state/${documentId}`)

    if (!result.data) return null
    const state = result.data

    return {
      documentId,
      phase: state.dynamics?.documentPhase || null,
      editVelocity: state.dynamics?.editVelocity || 'stalled',
      activeTensionCount: (state.tensions || []).filter(
        (t: any) => !t.resolvedAt && (t.severity === 'medium' || t.severity === 'high')
      ).length,
      activeContributors: state.dynamics?.activeContributors || 0,
      contributorAvatars: (state.contributions || [])
        .slice(0, 3)
        .map((c: any) => ({
          userId: c.userId,
          name: c.userName,
          isActive:
            Date.now() - new Date(c.lastActiveAt).getTime() < 60 * 60 * 1000,
        })),
      lastMajorChange: state.dynamics?.lastMajorChange || null,
      aiInteractionCount: state.aiUsage?.totalInteractions || 0,
    }
  } catch {
    return null
  }
}

// ─── Helpers (exported for testing) ───

export function processEpisodesForDashboard(
  results: any[],
  episodeMap: Record<string, any>
): DashboardEpisode[] {
  const grouped = new Map<string, any[]>()
  for (const result of results) {
    if (!result.episodeId) continue
    const list = grouped.get(result.episodeId) || []
    list.push(result)
    grouped.set(result.episodeId, list)
  }

  const episodes: DashboardEpisode[] = []
  for (const [epId, events] of grouped) {
    const epData = episodeMap[epId]
    const sorted = events.sort(
      (a: any, b: any) =>
        new Date(a.timestamp || a.eventTime).getTime() -
        new Date(b.timestamp || b.eventTime).getTime()
    )

    episodes.push({
      id: epId,
      title: epData?.title || 'Untitled episode',
      startTime: sorted[0]?.timestamp || sorted[0]?.eventTime || '',
      endTime:
        sorted[sorted.length - 1]?.timestamp ||
        sorted[sorted.length - 1]?.eventTime ||
        '',
      userNames: [
        ...new Set(events.map((e: any) => e.userName).filter(Boolean)),
      ] as string[],
      surfaces: [...new Set(events.map((e: any) => e.threadType))] as string[],
      hasKeyChange: events.some((e: any) => e.isKeyChange),
      documentId: events[0]?.documentId || '',
      documentTitle: events[0]?.documentTitle || 'Untitled',
      primarySection: epData?.primarySection || null,
    })
  }

  return episodes.sort(
    (a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime()
  )
}

export function buildWeekSummary(
  aiState: any,
  episodes: DashboardEpisode[]
): WeekSummary | null {
  if (!aiState && episodes.length === 0) return null

  const byDoc = new Map<string, DashboardEpisode[]>()
  for (const ep of episodes) {
    const list = byDoc.get(ep.documentId) || []
    list.push(ep)
    byDoc.set(ep.documentId, list)
  }

  const documentsWorkedOn = [...byDoc.entries()]
    .map(([docId, eps]) => ({
      documentId: docId,
      title: eps[0]?.documentTitle || 'Untitled',
      episodeCount: eps.length,
      eventCount: eps.reduce((sum, ep) => sum + (ep.surfaces?.length || 1), 0),
      timeSpentMinutes: eps.reduce((sum, ep) => {
        const start = new Date(ep.startTime).getTime()
        const end = new Date(ep.endTime).getTime()
        return sum + Math.max(0, Math.round((end - start) / 60000))
      }, 0),
    }))
    .sort((a, b) => b.episodeCount - a.episodeCount)

  const patterns = aiState?.persistent?.patterns || {}
  const session = aiState?.session?.currentSession || {}

  // Collect most frequent sections
  const sectionCounts = new Map<string, number>()
  for (const ep of episodes) {
    if (ep.primarySection) {
      sectionCounts.set(
        ep.primarySection,
        (sectionCounts.get(ep.primarySection) || 0) + 1
      )
    }
  }
  const topSections = [...sectionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([s]) => s)

  return {
    documentsWorkedOn,
    totalEpisodes: episodes.length,
    totalAIInteractions: session.aiInteractionCount || 0,
    aiAcceptanceRate: patterns.aiPreferences?.grammarAcceptRate || null,
    workStyle: patterns.workStyle || null,
    productiveHours: patterns.productiveHours || null,
    topSections,
  }
}
