import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type DashFilterType =
  | 'recent'
  | 'all'
  | 'shared'
  | 'starred'
  | 'smart-docs'
  | 'project'
  | 'search'

export interface DashFilter {
  type: DashFilterType
  // Project filter only
  spaceId?: string
  spaceName?: string
  spaceColor?: string | null
  // Search filter only
  query?: string
}

export type DashViewMode = 'grid' | 'list' | 'activity'
export type SidebarView = 'overview' | 'items' | 'notebooks' | 'memory' | 'vault' | 'profile'
export type SectionFilter = 'all' | 'conversation' | 'file' | 'fact'
export type ItemType = 'conv' | 'file' | 'fact'
export type DetailViewMode = 'original' | 'intelligence' | 'both'

export interface SelectedItem {
  id: string
  type: ItemType
}

interface FollowDashboardState {
  filter: DashFilter
  viewMode: DashViewMode
  searchQuery: string
  sidebarView: SidebarView
  sectionFilter: SectionFilter
  selectedItem: SelectedItem | null
  detailViewMode: DetailViewMode
  setFilter: (filter: DashFilter | DashFilterType) => void
  setViewMode: (mode: DashViewMode) => void
  setSearchQuery: (query: string) => void
  setSidebarView: (view: SidebarView) => void
  setSectionFilter: (filter: SectionFilter) => void
  setSelectedItem: (item: SelectedItem | null) => void
  setDetailViewMode: (mode: DetailViewMode) => void
}

function normalizeFilter(filter: DashFilter | DashFilterType): DashFilter {
  if (typeof filter === 'string') return { type: filter }
  return filter
}

export const useFollowDashboardStore = create<FollowDashboardState>()(
  persist(
    (set) => ({
      filter: { type: 'recent' },
      viewMode: 'grid',
      searchQuery: '',
      sidebarView: 'overview',
      sectionFilter: 'all',
      selectedItem: null,
      detailViewMode: 'original',
      setFilter: (filter) => set({ filter: normalizeFilter(filter) }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setSidebarView: (view) => set({ sidebarView: view, selectedItem: null }),
      setSectionFilter: (filter) => set({ sectionFilter: filter, selectedItem: null }),
      setSelectedItem: (item) => set({ selectedItem: item, detailViewMode: 'original' }),
      setDetailViewMode: (mode) => set({ detailViewMode: mode }),
    }),
    {
      name: 'follow-dashboard',
      partialize: (state) => ({ viewMode: state.viewMode, filter: state.filter }),
      migrate: (persisted: unknown, _version: number) => {
        const p = persisted as { filter?: unknown; viewMode?: DashViewMode } | null
        if (!p) return p as unknown
        if (typeof p.filter === 'string') {
          return { ...p, filter: { type: p.filter as DashFilterType } } as unknown
        }
        return p as unknown
      },
    }
  )
)
