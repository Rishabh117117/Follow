import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '@/lib/api-client'

export interface FollowIndex {
  id: string
  name: string
  type: 'personal' | 'project'
  facts: number
  files: number
  chats: number
  members?: number
  locked?: boolean
}

export interface IndexStoreState {
  activeIndexId: string
  indexes: FollowIndex[]
  dropdownOpen: boolean
  createFormOpen: boolean
  isLoading: boolean
  setActiveIndex: (id: string) => void
  toggleDropdown: () => void
  toggleCreateForm: () => void
  addIndex: (index: FollowIndex) => void
  setIndexes: (indexes: FollowIndex[]) => void
  fetchIndexes: () => Promise<void>
  createIndex: (
    name: string,
    type: 'personal' | 'project',
    workspaceId?: string
  ) => Promise<FollowIndex | null>
  deleteIndex: (id: string) => Promise<boolean>
  lockIndex: (id: string, passcode: string) => Promise<boolean>
  unlockIndex: (
    id: string,
    passcode: string
  ) => Promise<
    { ok: true } | { ok: false; error: string; attemptsRemaining?: number; secondsLeft?: number }
  >
  recoverIndex: (id: string) => Promise<boolean>
  getActiveIndex: () => FollowIndex | undefined
}

export const useIndexStore = create<IndexStoreState>()(
  persist(
    (set, get) => ({
      activeIndexId: 'personal',
      indexes: [],
      dropdownOpen: false,
      createFormOpen: false,
      isLoading: false,
      setActiveIndex: (id) => set({ activeIndexId: id, dropdownOpen: false }),
      toggleDropdown: () => set((s) => ({ dropdownOpen: !s.dropdownOpen, createFormOpen: false })),
      toggleCreateForm: () => set((s) => ({ createFormOpen: !s.createFormOpen })),
      addIndex: (index) =>
        set((s) => ({
          indexes: [...s.indexes, index],
          createFormOpen: false,
        })),
      setIndexes: (indexes) => set({ indexes }),
      fetchIndexes: async () => {
        // STABILIZE-2: route through api-client so x-user-id + x-workspace-id
        // headers are injected from the NextAuth session. Direct fetch() here
        // used to rely on `credentials: 'include'` + server cookie lookup,
        // which no longer works now that API auth is pure-header and web auth
        // is JWT-only.
        set({ isLoading: true })
        try {
          const body = await api.get<FollowIndex[]>('/api/indexes')
          set({ indexes: body.data ?? [], isLoading: false })
        } catch {
          set({ isLoading: false })
        }
      },
      createIndex: async (name, type, workspaceId) => {
        try {
          const body = await api.post<FollowIndex>('/api/indexes', { name, type, workspaceId })
          if (body.data) {
            set((s) => ({
              indexes: [...s.indexes, body.data!],
              createFormOpen: false,
            }))
            return body.data
          }
          return null
        } catch {
          return null
        }
      },
      deleteIndex: async (id) => {
        try {
          const res = await api.delete<{ id: string; deleted: boolean }>(`/api/indexes/${id}`)
          if (!res.data?.deleted) return false
          set((s) => {
            const next = s.indexes.filter((i) => i.id !== id)
            const active = s.activeIndexId === id ? 'personal' : s.activeIndexId
            return { indexes: next, activeIndexId: active, dropdownOpen: false }
          })
          return true
        } catch {
          return false
        }
      },
      lockIndex: async (id, passcode) => {
        try {
          const res = await api.post<{ id: string; locked: boolean }>(`/api/indexes/${id}/lock`, {
            passcode,
          })
          if (res.data?.locked) {
            set((s) => ({
              indexes: s.indexes.map((i) => (i.id === id ? { ...i, locked: true } : i)),
            }))
            return true
          }
          return false
        } catch {
          return false
        }
      },
      unlockIndex: async (id, passcode) => {
        try {
          const res = await api.post<{ id: string; locked: boolean }>(`/api/indexes/${id}/unlock`, {
            passcode,
          })
          if (res.data && !res.data.locked) {
            set((s) => ({
              indexes: s.indexes.map((i) => (i.id === id ? { ...i, locked: false } : i)),
            }))
            return { ok: true }
          }
          const err = res.error as {
            code?: string
            message?: string
            attemptsRemaining?: number
            secondsLeft?: number
          } | null
          return {
            ok: false,
            error: err?.message ?? 'Unlock failed',
            attemptsRemaining: err?.attemptsRemaining,
            secondsLeft: err?.secondsLeft,
          }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : 'Unlock failed' }
        }
      },
      recoverIndex: async (id) => {
        try {
          const res = await api.post<{ id: string; locked: boolean }>(
            `/api/indexes/${id}/recover`,
            {}
          )
          if (res.data && !res.data.locked) {
            set((s) => ({
              indexes: s.indexes.map((i) => (i.id === id ? { ...i, locked: false } : i)),
            }))
            return true
          }
          return false
        } catch {
          return false
        }
      },
      getActiveIndex: () => {
        const s = get()
        return s.indexes.find((i) => i.id === s.activeIndexId)
      },
    }),
    {
      name: 'follow-index',
      partialize: (state) => ({ activeIndexId: state.activeIndexId }),
    }
  )
)
