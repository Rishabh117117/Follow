import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface PinnedItem {
  id: string
  type: 'file' | 'fact' | 'conversation'
  name: string
  source: string
}

export interface ChatContextState {
  scope: 'all' | 'doc' | 'pinned'
  followWeb: boolean
  seeing: string[]
  pinnedItems: PinnedItem[]
  contextExpanded: boolean
  setScope: (scope: 'all' | 'doc' | 'pinned') => void
  toggleFollowWeb: () => void
  setSeeing: (items: string[]) => void
  pinItem: (item: PinnedItem) => void
  unpinItem: (id: string) => void
  toggleContextExpanded: () => void
}

export const useChatContextStore = create<ChatContextState>()(
  persist(
    (set) => ({
      scope: 'all',
      followWeb: false,
      seeing: [],
      pinnedItems: [],
      contextExpanded: false,
      setScope: (scope) => set({ scope }),
      toggleFollowWeb: () => set((s) => ({ followWeb: !s.followWeb })),
      setSeeing: (items) => set({ seeing: items }),
      pinItem: (item) =>
        set((s) => ({
          pinnedItems: s.pinnedItems.some((p) => p.id === item.id)
            ? s.pinnedItems
            : [...s.pinnedItems, item],
        })),
      unpinItem: (id) =>
        set((s) => ({ pinnedItems: s.pinnedItems.filter((p) => p.id !== id) })),
      toggleContextExpanded: () => set((s) => ({ contextExpanded: !s.contextExpanded })),
    }),
    {
      name: 'follow-chat-context',
      partialize: (state) => ({
        scope: state.scope,
        followWeb: state.followWeb,
        pinnedItems: state.pinnedItems,
      }),
    }
  )
)
