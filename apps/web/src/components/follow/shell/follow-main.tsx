'use client'

import { useFollowDashboardStore } from '@/stores/follow-dashboard-store'
import { MemoryView } from '@/components/follow/memory/memory-view'
import { VaultView } from '@/components/follow/shell/vault-view'
import { ProfileView } from '@/components/follow/memory/profile-view'
import { NotebooksGrid } from '@/components/follow/items/notebooks-grid'
import { ItemsView } from '@/components/follow/items/items-view'
import { ProjectOverview } from '@/components/follow/dashboard/project-overview'

export function FollowMain() {
  const { sidebarView } = useFollowDashboardStore()

  switch (sidebarView) {
    case 'overview':
      return <ProjectOverview />
    case 'notebooks':
      return <NotebooksGrid />
    case 'memory':
      return <MemoryView />
    case 'vault':
      return <VaultView />
    case 'profile':
      return <ProfileView />
    case 'items':
    default:
      return <ItemsView />
  }
}
