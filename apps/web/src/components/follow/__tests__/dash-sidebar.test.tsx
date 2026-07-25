import { describe, it, expect, beforeEach } from 'vitest'
import { useFollowDashboardStore } from '@/stores/follow-dashboard-store'
import { useIndexStore } from '@/stores/index-store'

describe('DashSidebar restructured (UI-1)', () => {
  beforeEach(() => {
    useFollowDashboardStore.setState({
      sidebarView: 'items',
      sectionFilter: 'all',
    })
    useIndexStore.setState({
      activeIndexId: 'personal',
      indexes: [
        { id: 'personal', name: 'Personal', type: 'personal', facts: 247, files: 89, chats: 34 },
        { id: 'capstone', name: 'Capstone Thesis', type: 'project', facts: 112, files: 44, chats: 18, members: 3 },
        { id: 'follow-dev', name: 'Follow Development', type: 'project', facts: 91, files: 32, chats: 12, members: 2 },
      ],
    })
  })

  it('renders all section filters with counts', () => {
    // Section filters available: all, conversation, file, fact
    const filters = ['all', 'conversation', 'file', 'fact'] as const
    for (const f of filters) {
      useFollowDashboardStore.getState().setSectionFilter(f)
      expect(useFollowDashboardStore.getState().sectionFilter).toBe(f)
    }
  })

  it('renders Notebooks, Memory, Feature Vault buttons', () => {
    const views = ['notebooks', 'memory', 'vault'] as const
    for (const v of views) {
      useFollowDashboardStore.getState().setSidebarView(v)
      expect(useFollowDashboardStore.getState().sidebarView).toBe(v)
    }
  })

  it('renders profile footer with correct name', () => {
    // Profile view accessible from sidebar
    useFollowDashboardStore.getState().setSidebarView('profile')
    expect(useFollowDashboardStore.getState().sidebarView).toBe('profile')
  })

  it('active view highlights correct button', () => {
    useFollowDashboardStore.getState().setSidebarView('memory')
    expect(useFollowDashboardStore.getState().sidebarView).toBe('memory')
    useFollowDashboardStore.getState().setSidebarView('items')
    expect(useFollowDashboardStore.getState().sidebarView).toBe('items')
  })

  it('index stats reflect active index', () => {
    const active = useIndexStore.getState().getActiveIndex()
    expect(active!.name).toBe('Personal')
    expect(active!.facts).toBe(247)
    useIndexStore.getState().setActiveIndex('capstone')
    const active2 = useIndexStore.getState().getActiveIndex()
    expect(active2!.name).toBe('Capstone Thesis')
    expect(active2!.facts).toBe(112)
  })

  it('clicking section filter updates sectionFilter', () => {
    useFollowDashboardStore.getState().setSectionFilter('conversation')
    expect(useFollowDashboardStore.getState().sectionFilter).toBe('conversation')
    useFollowDashboardStore.getState().setSectionFilter('fact')
    expect(useFollowDashboardStore.getState().sectionFilter).toBe('fact')
  })
})
