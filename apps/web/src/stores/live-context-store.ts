/**
 * Live Context Store (Sprint SCOPE-LIVECTX-1)
 *
 * Tracks the live-context self-slice that mirrors the active scope into
 * in-chat "live block" form. Activation/pause/resume/end go through the
 * scope-store + /api/scope lifecycle; this store just reads slice state
 * and exposes convenience actions.
 */

import { create } from 'zustand'
import { api } from '@/lib/api-client'

export interface LiveContextSlice {
  id: string
  content: string
  itemCount: number
  redactionCount: number
  lastSyncedAt: string
  syncStatus: 'shared' | 'live' | 'paused'
}

interface LiveContextStoreState {
  slice: LiveContextSlice | null
  loading: boolean
  refreshing: boolean

  fetchSlice: () => Promise<void>
  activate: () => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  end: () => Promise<void>

  get isActive(): boolean
  get isPaused(): boolean
}

export const useLiveContextStore = create<LiveContextStoreState>((set, get) => ({
  slice: null,
  loading: false,
  refreshing: false,

  get isActive() {
    const s = get().slice
    return !!s && s.syncStatus !== 'shared'
  },
  get isPaused() {
    return get().slice?.syncStatus === 'paused'
  },

  fetchSlice: async () => {
    try {
      set({ loading: true })
      const res = await api.get<{ slice: LiveContextSlice | null }>('/api/scope/live-slice')
      set({ slice: res.data?.slice ?? null })
    } catch (err) {
      console.warn('[live-context-store] fetchSlice failed:', err)
    } finally {
      set({ loading: false })
    }
  },

  // Activation happens via scope-store.setActiveScope with mode='live'.
  // This method exists for callers who already have an active scope and
  // want to upgrade it without rebuilding the boundary list.
  activate: async () => {
    try {
      const { useScopeStore } = await import('./scope-store')
      const scope = useScopeStore.getState().activeScope
      if (!scope) return
      await useScopeStore.getState().setActiveScope(scope.boundaries, 'live')
      await get().fetchSlice()
    } catch (err) {
      console.warn('[live-context-store] activate failed:', err)
    }
  },

  pause: async () => {
    await api.post('/api/scope/pause', {})
    await get().fetchSlice()
  },

  resume: async () => {
    await api.post('/api/scope/resume', {})
    await get().fetchSlice()
  },

  end: async () => {
    await api.post('/api/scope/end', {})
    set({ slice: null })
  },
}))
