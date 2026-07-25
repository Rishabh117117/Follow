/**
 * Query Store (Sprint V41-QUERY-1)
 *
 * Composes + runs + saves StructuredQueries. Wegner invariant: mutations
 * are user-initiated only. The store never widens boundaries; never
 * fuzzy-matches a precise query.
 */

import { create } from 'zustand'
import { api } from '@/lib/api-client'
import type { Boundary } from './scope-store'

export type { Boundary } from './scope-store'

// ─── Types (wire-compatible with packages/api/src/services/query/types.ts) ──

export type SelectField =
  | 'id'
  | 'content'
  | 'contributor'
  | 'confidence'
  | 'createdAt'
  | 'sourceTool'
  | 'edgeType'
  | 'supersedes'
  | 'topic'

export interface SelectSpec {
  fields: SelectField[]
  limit?: number
  offset?: number
  orderBy?: { field: string; direction: 'asc' | 'desc' }
  groupBy?: string
}

export interface Aggregation {
  kind: 'count' | 'group_count' | 'distinct'
  field?: string
}

export interface StructuredQuery {
  query_id: string
  name?: string
  description?: string
  boundaries: Boundary[]
  select: SelectSpec
  aggregations?: Aggregation[]
  createdAt: string
  createdBy: string
  workspaceId: string
}

export interface QueryResultFact {
  id: string
  content: string
  contributor: { id: string; name: string }
  confidence: number
  createdAt: string
  sourceTool: string
  edgeType?: string
  supersedes?: string
  topic?: string[]
}

export interface QueryResult {
  query: StructuredQuery
  facts: QueryResultFact[]
  totalCount: number
  aggregations?: Record<string, unknown>
  conflicts: unknown[]
  truncated: boolean
  runtimeMs: number
}

export interface SavedQueryRow {
  id: string
  userId: string
  workspaceId: string
  name: string
  description: string | null
  boundaries: Boundary[]
  selectSpec: SelectSpec
  aggregations: Aggregation[] | null
  isPinned: boolean
  lastRunAt: string | null
  runCount: number
  createdAt: string
  updatedAt: string
}

// ─── Store ───────────────────────────────────────────────────────────────────

const defaultSelect = (): SelectSpec => ({
  fields: ['id', 'content', 'contributor', 'confidence', 'createdAt'],
  limit: 100,
  orderBy: { field: 'createdAt', direction: 'desc' },
})

interface QueryStoreState {
  isComposerOpen: boolean
  draftBoundaries: Boundary[]
  draftSelect: SelectSpec
  draftName: string

  lastResult: QueryResult | null
  lastNlInput: string
  parseWarnings: string[]
  loading: boolean

  savedQueries: SavedQueryRow[]

  composerOpen: () => void
  composerClose: () => void

  setBoundaries: (b: Boundary[]) => void
  setSelect: (s: SelectSpec) => void
  setName: (name: string) => void
  addBoundary: (b: Boundary) => void
  removeBoundary: (idx: number) => void
  updateBoundary: (idx: number, b: Boundary) => void

  parseNL: (nl: string) => Promise<void>
  runAdHoc: () => Promise<QueryResult | null>

  fetchSaved: () => Promise<void>
  save: (name: string, description?: string) => Promise<string | null>
  loadSaved: (id: string) => Promise<void>
  runSaved: (id: string) => Promise<QueryResult | null>
  togglePin: (id: string) => Promise<void>
  deleteSaved: (id: string) => Promise<void>
  reset: () => void
}

export const useQueryStore = create<QueryStoreState>((set, get) => ({
  isComposerOpen: false,
  draftBoundaries: [],
  draftSelect: defaultSelect(),
  draftName: '',
  lastResult: null,
  lastNlInput: '',
  parseWarnings: [],
  loading: false,
  savedQueries: [],

  composerOpen: () => set({ isComposerOpen: true }),
  composerClose: () => set({ isComposerOpen: false }),

  setBoundaries: (b) => set({ draftBoundaries: b }),
  setSelect: (s) => set({ draftSelect: s }),
  setName: (name) => set({ draftName: name }),
  addBoundary: (b) => set((s) => ({ draftBoundaries: [...s.draftBoundaries, b] })),
  removeBoundary: (idx) =>
    set((s) => ({ draftBoundaries: s.draftBoundaries.filter((_, i) => i !== idx) })),
  updateBoundary: (idx, b) =>
    set((s) => ({
      draftBoundaries: s.draftBoundaries.map((x, i) => (i === idx ? b : x)),
    })),

  parseNL: async (nl) => {
    try {
      set({ loading: true, lastNlInput: nl })
      const res = await api.post<{ query: StructuredQuery; warnings: string[] }>(
        '/api/queries/parse',
        { nl }
      )
      const data = res.data
      if (data) {
        set({
          draftBoundaries: data.query.boundaries,
          draftSelect: data.query.select,
          parseWarnings: data.warnings ?? [],
        })
      }
    } catch (err) {
      console.warn('[query-store] parseNL failed:', err)
    } finally {
      set({ loading: false })
    }
  },

  runAdHoc: async () => {
    try {
      set({ loading: true })
      const res = await api.post<{ result: QueryResult }>('/api/queries/run', {
        structured: {
          boundaries: get().draftBoundaries,
          select: get().draftSelect,
          name: get().draftName || undefined,
        },
      })
      const result = res.data?.result ?? null
      set({ lastResult: result })
      return result
    } catch (err) {
      console.warn('[query-store] runAdHoc failed:', err)
      return null
    } finally {
      set({ loading: false })
    }
  },

  fetchSaved: async () => {
    try {
      const res = await api.get<{ queries: SavedQueryRow[] }>('/api/queries')
      set({ savedQueries: res.data?.queries ?? [] })
    } catch (err) {
      console.warn('[query-store] fetchSaved failed:', err)
    }
  },

  save: async (name, description) => {
    try {
      const res = await api.post<{ id: string }>('/api/queries', {
        name,
        description,
        structured: {
          boundaries: get().draftBoundaries,
          select: get().draftSelect,
        },
      })
      const id = res.data?.id ?? null
      if (id) await get().fetchSaved()
      return id
    } catch (err) {
      console.warn('[query-store] save failed:', err)
      return null
    }
  },

  loadSaved: async (id) => {
    try {
      const res = await api.get<{ query: SavedQueryRow }>(`/api/queries/${id}`)
      const q = res.data?.query
      if (q) {
        set({
          draftBoundaries: q.boundaries,
          draftSelect: q.selectSpec,
          draftName: q.name,
        })
      }
    } catch (err) {
      console.warn('[query-store] loadSaved failed:', err)
    }
  },

  runSaved: async (id) => {
    try {
      set({ loading: true })
      const res = await api.post<{ result: QueryResult }>(`/api/queries/${id}/run`, {})
      const result = res.data?.result ?? null
      set({ lastResult: result })
      return result
    } catch (err) {
      console.warn('[query-store] runSaved failed:', err)
      return null
    } finally {
      set({ loading: false })
    }
  },

  togglePin: async (id) => {
    const current = get().savedQueries.find((q) => q.id === id)
    const next = !(current?.isPinned ?? false)
    await api.patch<unknown>(`/api/queries/${id}`, { isPinned: next })
    await get().fetchSaved()
  },

  deleteSaved: async (id) => {
    await api.delete<unknown>(`/api/queries/${id}`)
    await get().fetchSaved()
  },

  reset: () =>
    set({
      isComposerOpen: false,
      draftBoundaries: [],
      draftSelect: defaultSelect(),
      draftName: '',
      lastResult: null,
      lastNlInput: '',
      parseWarnings: [],
    }),
}))
