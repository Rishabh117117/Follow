/**
 * Procedural Store (Sprint V41-PROCEDURAL-1 Phase 1)
 *
 * User-initiated reads of Profiler-written patterns. No background
 * polling — loads happen when the panel opens or the user refreshes.
 */

import { create } from 'zustand'
import { api } from '@/lib/api-client'

export interface PatternContributor {
  id: string
  name: string | null
  contributionCount: number
}

export interface Pattern {
  id: string
  type: 'cluster' | 'edge' | 'emerging_topic'
  label: string
  description: string | null
  contributors: PatternContributor[]
  edgeCount: number
  edgeTypes: string[]
  sampleEdgeIds: string[]
  confidence: number
  firstSeenAt: string
  lastUpdatedAt: string
  hasPrivateContributors: boolean
  droppedBecausePrivacy: boolean
}

export interface PatternSummary {
  totalPatterns: number
  droppedCount: number
  topContributors: Array<{ id: string; name: string | null; count: number }>
  topEdgeTypes: string[]
}

interface ProceduralStoreState {
  patterns: Pattern[]
  total: number
  filtered: number
  droppedByPrivacy: number
  summary: PatternSummary | null
  isLoading: boolean
  error: string | null

  timeWindowDays: number
  minConfidence: number
  topicContains: string | null

  lastWorkspaceId: string | null

  setTimeWindow: (days: number) => void
  setMinConfidence: (v: number) => void
  setTopicContains: (t: string | null) => void

  loadPatterns: (workspaceId: string) => Promise<void>
  loadSummary: (workspaceId: string) => Promise<void>
  refresh: () => Promise<void>
  reset: () => void
}

export const useProceduralStore = create<ProceduralStoreState>((set, get) => ({
  patterns: [],
  total: 0,
  filtered: 0,
  droppedByPrivacy: 0,
  summary: null,
  isLoading: false,
  error: null,

  timeWindowDays: 14,
  minConfidence: 0.3,
  topicContains: null,

  lastWorkspaceId: null,

  setTimeWindow: (days) => set({ timeWindowDays: days }),
  setMinConfidence: (v) => set({ minConfidence: v }),
  setTopicContains: (t) => set({ topicContains: t && t.length > 0 ? t : null }),

  loadPatterns: async (workspaceId) => {
    set({ isLoading: true, error: null, lastWorkspaceId: workspaceId })
    try {
      const { timeWindowDays, minConfidence, topicContains } = get()
      const params = new URLSearchParams({
        workspaceId,
        days: String(timeWindowDays),
        minConfidence: String(minConfidence),
      })
      if (topicContains) params.set('topic', topicContains)
      const res = await api.get<{
        result: {
          patterns: Pattern[]
          total: number
          filtered: number
          droppedByPrivacy: number
        }
        warning?: string
      }>(`/api/procedural/patterns?${params.toString()}`)
      const data = res.data
      if (data) {
        set({
          patterns: data.result.patterns,
          total: data.result.total,
          filtered: data.result.filtered,
          droppedByPrivacy: data.result.droppedByPrivacy,
          error: data.warning ?? null,
        })
      }
    } catch (err) {
      console.warn('[procedural-store] loadPatterns failed:', err)
      set({ patterns: [], error: 'Failed to load patterns.' })
    } finally {
      set({ isLoading: false })
    }
  },

  loadSummary: async (workspaceId) => {
    try {
      const { timeWindowDays } = get()
      const res = await api.get<{ summary: PatternSummary }>(
        `/api/procedural/summary?workspaceId=${workspaceId}&days=${timeWindowDays}`
      )
      set({ summary: res.data?.summary ?? null })
    } catch (err) {
      console.warn('[procedural-store] loadSummary failed:', err)
    }
  },

  refresh: async () => {
    const ws = get().lastWorkspaceId
    if (!ws) return
    await get().loadPatterns(ws)
    await get().loadSummary(ws)
  },

  reset: () =>
    set({
      patterns: [],
      total: 0,
      filtered: 0,
      droppedByPrivacy: 0,
      summary: null,
      isLoading: false,
      error: null,
      timeWindowDays: 14,
      minConfidence: 0.3,
      topicContains: null,
      lastWorkspaceId: null,
    }),
}))
