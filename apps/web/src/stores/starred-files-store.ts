import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface StarredFilesState {
  /** Set of file IDs that are starred */
  starredIds: Set<string>
  /** Toggle star on a file — returns new starred state */
  toggleStar: (fileId: string) => boolean
  /** Check if a file is starred */
  isStarred: (fileId: string) => boolean
  /** Clear all stars */
  clearAll: () => void
}

export const useStarredFilesStore = create<StarredFilesState>()(
  persist(
    (set, get) => ({
      starredIds: new Set<string>(),

      toggleStar: (fileId: string) => {
        const current = get().starredIds
        const next = new Set(current)
        if (next.has(fileId)) {
          next.delete(fileId)
          set({ starredIds: next })
          return false
        } else {
          next.add(fileId)
          set({ starredIds: next })
          return true
        }
      },

      isStarred: (fileId: string) => {
        return get().starredIds.has(fileId)
      },

      clearAll: () => {
        set({ starredIds: new Set() })
      },
    }),
    {
      name: 'follow-starred-files',
      // Serialize Set to/from array for JSON storage
      storage: {
        getItem: (name) => {
          const raw = localStorage.getItem(name)
          if (!raw) return null
          const parsed = JSON.parse(raw)
          if (parsed?.state?.starredIds) {
            parsed.state.starredIds = new Set(parsed.state.starredIds)
          }
          return parsed
        },
        setItem: (name, value) => {
          const toStore = {
            ...value,
            state: {
              ...value.state,
              starredIds: Array.from(value.state.starredIds),
            },
          }
          localStorage.setItem(name, JSON.stringify(toStore))
        },
        removeItem: (name) => {
          localStorage.removeItem(name)
        },
      },
    }
  )
)
