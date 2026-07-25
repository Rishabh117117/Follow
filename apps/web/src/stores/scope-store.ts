/**
 * Scope Store (Sprint SCOPE-LIVECTX-1)
 *
 * Client-side mirror of the active scope + presets. All mutations are
 * user-initiated through the Scope Builder panel. This store does NOT
 * auto-open or auto-modify the scope — the Wegner invariant lives here too.
 */

import { create } from 'zustand'
import { api } from '@/lib/api-client'

// ─── Types (wire-compatible with packages/api/src/services/scope/types.ts) ──

export type BoundaryDimension =
  | 'index'
  | 'contributor'
  | 'confidence'
  | 'time'
  | 'topic'
  | 'edge_type'
  | 'privacy'
  | 'freshness'
  | 'source_tool'
  | 'provenance'
  | 'custom'

export type BoundaryOp =
  | 'include'
  | 'exclude'
  | 'gte'
  | 'lte'
  | 'within'
  | 'not_within'
  | 'matches'

export interface BoundaryTimeWindow {
  type: 'relative' | 'absolute'
  days?: number
  from?: string
  to?: string
}

export interface Boundary {
  dimension: BoundaryDimension
  op: BoundaryOp
  value?: unknown
  values?: unknown[]
  window?: BoundaryTimeWindow
  name?: string
  description?: string
  rule?: Record<string, unknown>
}

export interface Scope {
  scope_id: string
  name: string
  mode: 'live' | 'static'
  persists_until: string
  boundaries: Boundary[]
  ownerId: string
  workspaceId: string
  createdAt: string
  updatedAt: string
}

export interface ScopeConflict {
  type: 'within_scope' | 'vs_governance' | 'cross_user'
  boundaries: Boundary[]
  governance?: { rule: string; severity: 'hard' | 'soft' }
  resolution: {
    action: 'reject' | 'downgrade' | 'request_access' | 'apply_receiver_scope'
    reason: string
    next_step?: string
  }
}

export interface ScopePreset extends Scope {
  definitionId: string
}

export interface ScopeLifecycle {
  active: boolean
  paused: boolean
  ended: boolean
  mode: 'live' | 'static'
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface ScopeStoreState {
  activeScope: Scope | null
  lifecycle: ScopeLifecycle
  presets: ScopePreset[]
  conflicts: ScopeConflict[]
  estimatedFactCount: number | null
  editorOpen: boolean
  draftBoundaries: Boundary[]
  loading: boolean

  openEditor: (seed?: Boundary[]) => void
  closeEditor: () => void
  setDraftBoundaries: (bs: Boundary[]) => void
  addDraftBoundary: (b: Boundary) => void
  removeDraftBoundary: (idx: number) => void
  updateDraftBoundary: (idx: number, b: Boundary) => void

  fetchActive: () => Promise<void>
  fetchPresets: () => Promise<void>
  setActiveScope: (boundaries: Boundary[], mode?: 'live' | 'static') => Promise<void>
  adjustBoundary: (boundary: Boundary, action: 'add' | 'remove' | 'update', idx?: number) => Promise<void>
  pauseScope: () => Promise<void>
  resumeScope: () => Promise<void>
  endScope: () => Promise<void>
  savePreset: (name: string, boundaries?: Boundary[]) => Promise<void>
  applyPreset: (presetId: string) => Promise<void>
  validatePreview: (
    boundaries: Boundary[]
  ) => Promise<{ valid: boolean; conflicts: ScopeConflict[]; estimatedFactCount: number }>
  previewCount: (boundaries: Boundary[]) => Promise<number>
  reset: () => void
}

const initialLifecycle: ScopeLifecycle = {
  active: false,
  paused: false,
  ended: false,
  mode: 'static',
}

export const useScopeStore = create<ScopeStoreState>((set, get) => ({
  activeScope: null,
  lifecycle: initialLifecycle,
  presets: [],
  conflicts: [],
  estimatedFactCount: null,
  editorOpen: false,
  draftBoundaries: [],
  loading: false,

  openEditor: (seed) =>
    set({
      editorOpen: true,
      draftBoundaries: seed ?? get().activeScope?.boundaries ?? [],
    }),
  closeEditor: () => set({ editorOpen: false }),
  setDraftBoundaries: (bs) => set({ draftBoundaries: bs }),
  addDraftBoundary: (b) => set((s) => ({ draftBoundaries: [...s.draftBoundaries, b] })),
  removeDraftBoundary: (idx) =>
    set((s) => ({ draftBoundaries: s.draftBoundaries.filter((_, i) => i !== idx) })),
  updateDraftBoundary: (idx, b) =>
    set((s) => ({
      draftBoundaries: s.draftBoundaries.map((x, i) => (i === idx ? b : x)),
    })),

  fetchActive: async () => {
    try {
      set({ loading: true })
      const res = await api.get<{ scope: Scope | null; lifecycle: ScopeLifecycle }>(
        '/api/scope/active'
      )
      const data = res.data
      if (data) {
        set({
          activeScope: data.scope,
          lifecycle: data.lifecycle ?? initialLifecycle,
        })
      }
    } catch (err) {
      console.warn('[scope-store] fetchActive failed:', err)
    } finally {
      set({ loading: false })
    }
  },

  fetchPresets: async () => {
    try {
      const res = await api.get<{ presets: ScopePreset[] }>('/api/scope/presets')
      set({ presets: res.data?.presets ?? [] })
    } catch (err) {
      console.warn('[scope-store] fetchPresets failed:', err)
    }
  },

  setActiveScope: async (boundaries, mode = 'static') => {
    try {
      set({ loading: true })
      const res = await api.post<{
        scope: Scope | null
        conflicts: ScopeConflict[]
        valid: boolean
      }>('/api/scope', { action: 'set', boundaries, mode })
      const data = res.data
      if (data) {
        set({
          activeScope: data.scope,
          conflicts: data.conflicts ?? [],
          lifecycle: data.scope
            ? { active: true, paused: false, ended: false, mode: data.scope.mode }
            : initialLifecycle,
        })
      }
    } finally {
      set({ loading: false })
    }
  },

  adjustBoundary: async (boundary, action, idx) => {
    const current = get().activeScope?.boundaries ?? []
    let next: Boundary[]
    if (action === 'add') next = [...current, boundary]
    else if (action === 'remove' && typeof idx === 'number')
      next = current.filter((_, i) => i !== idx)
    else if (action === 'update' && typeof idx === 'number')
      next = current.map((b, i) => (i === idx ? boundary : b))
    else next = current

    await get().setActiveScope(next, get().activeScope?.mode ?? 'static')
  },

  pauseScope: async () => {
    await api.post('/api/scope/pause', {})
    set((s) => ({ lifecycle: { ...s.lifecycle, paused: true } }))
  },

  resumeScope: async () => {
    await api.post('/api/scope/resume', {})
    set((s) => ({ lifecycle: { ...s.lifecycle, paused: false } }))
  },

  endScope: async () => {
    await api.post('/api/scope/end', {})
    set({ activeScope: null, lifecycle: { ...initialLifecycle, ended: true } })
  },

  savePreset: async (name, boundaries) => {
    const bs = boundaries ?? get().draftBoundaries
    await api.post('/api/scope/presets', { name, boundaries: bs })
    await get().fetchPresets()
  },

  applyPreset: async (presetId) => {
    const res = await api.post<{ scope: Scope; conflicts: ScopeConflict[] }>(
      `/api/scope/presets/${presetId}/apply`,
      {}
    )
    const data = res.data
    if (data) {
      set({
        activeScope: data.scope,
        conflicts: data.conflicts ?? [],
        lifecycle: data.scope
          ? { active: true, paused: false, ended: false, mode: data.scope.mode }
          : initialLifecycle,
      })
    }
  },

  validatePreview: async (boundaries) => {
    try {
      const res = await api.post<{
        valid: boolean
        conflicts: ScopeConflict[]
        estimatedFactCount: number
      }>('/api/scope/validate', { boundaries })
      const data = res.data ?? { valid: false, conflicts: [], estimatedFactCount: 0 }
      set({ estimatedFactCount: data.estimatedFactCount })
      return data
    } catch (err) {
      console.warn('[scope-store] validatePreview failed:', err)
      return { valid: false, conflicts: [], estimatedFactCount: 0 }
    }
  },

  previewCount: async (boundaries) => {
    try {
      const qs = encodeURIComponent(JSON.stringify(boundaries))
      const res = await api.get<{ estimatedFactCount: number }>(
        `/api/scope/preview?boundaries=${qs}`
      )
      const count = res.data?.estimatedFactCount ?? 0
      set({ estimatedFactCount: count })
      return count
    } catch (err) {
      console.warn('[scope-store] previewCount failed:', err)
      return 0
    }
  },

  reset: () =>
    set({
      activeScope: null,
      lifecycle: initialLifecycle,
      conflicts: [],
      estimatedFactCount: null,
      editorOpen: false,
      draftBoundaries: [],
    }),
}))
