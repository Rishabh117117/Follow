/**
 * Discover Store (Sprint V41-DISCOVER-1)
 *
 * User-initiated state for the Discover ability. No auto-run — every
 * similarity request is triggered by a user click.
 */

import { create } from 'zustand'
import { api } from '@/lib/api-client'

export type PrivacyFloor = 'fingerprint_only' | 'topics_only' | 'full_signature'

export interface SimilarityMatch {
  indexId: string
  indexName: string
  ownerId: string | null
  ownerName: string | null
  similarity: number
  topicalOverlap: string[]
  recordCount: number
  lastActivityAt: string | null
}

export interface SimilarityResult {
  sourceIndexId: string
  sourceIndexName: string
  matches: SimilarityMatch[]
  privacyFloor: PrivacyFloor
  scanned: number
  runtimeMs: number
  conflicts: Array<{
    type: string
    reason: string
    next_step?: string
  }>
}

export interface IndexSignatureRow {
  indexId: string
  indexName: string
  ownerId: string | null
  ownerName: string | null
  recordCount: number
  lastActivityAt: string | null
  contributorCount: number
  discoverable: boolean
  discoverableScope: 'workspace' | 'org' | 'public' | null
  topicalFingerprint: Array<{ topic: string; weight: number }> | null
}

interface DiscoverStoreState {
  sourceIndexId: string | null
  privacyFloor: PrivacyFloor
  suggestions: SimilarityResult | null
  recent: IndexSignatureRow[]
  isLoading: boolean
  error: string | null

  setSource: (id: string) => void
  setPrivacyFloor: (f: PrivacyFloor) => void
  runDiscover: () => Promise<void>
  loadRecent: (workspaceId?: string) => Promise<void>
  toggleDiscoverable: (
    indexId: string,
    discoverable: boolean,
    scope?: 'workspace' | 'org' | 'public'
  ) => Promise<void>
  reset: () => void
}

export const useDiscoverStore = create<DiscoverStoreState>((set, get) => ({
  sourceIndexId: null,
  privacyFloor: 'topics_only',
  suggestions: null,
  recent: [],
  isLoading: false,
  error: null,

  setSource: (id) => set({ sourceIndexId: id }),
  setPrivacyFloor: (f) => set({ privacyFloor: f }),

  runDiscover: async () => {
    const source = get().sourceIndexId
    const floor = get().privacyFloor
    if (!source) {
      set({ error: 'Pick a source index before running Discover.' })
      return
    }
    try {
      set({ isLoading: true, error: null })
      const res = await api.post<{ result: SimilarityResult }>('/api/discover/similar', {
        source: { kind: 'index', value: source },
        privacyFloor: floor,
      })
      set({ suggestions: res.data?.result ?? null })
    } catch (err) {
      console.warn('[discover-store] runDiscover failed:', err)
      set({ error: 'Discover failed. No fact content was returned (fail-closed).' })
    } finally {
      set({ isLoading: false })
    }
  },

  loadRecent: async (workspaceId) => {
    try {
      set({ isLoading: true, error: null })
      const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''
      const res = await api.get<{ signatures: IndexSignatureRow[] }>(
        `/api/discover/recent${qs}`
      )
      set({ recent: res.data?.signatures ?? [] })
    } catch (err) {
      console.warn('[discover-store] loadRecent failed:', err)
    } finally {
      set({ isLoading: false })
    }
  },

  toggleDiscoverable: async (indexId, discoverable, scope) => {
    try {
      await api.patch(`/api/discover/indexes/${indexId}/discoverable`, {
        discoverable,
        scope,
      })
      // Refresh recent after the toggle.
      await get().loadRecent()
    } catch (err) {
      console.warn('[discover-store] toggleDiscoverable failed:', err)
    }
  },

  reset: () =>
    set({
      sourceIndexId: null,
      privacyFloor: 'topics_only',
      suggestions: null,
      recent: [],
      isLoading: false,
      error: null,
    }),
}))
