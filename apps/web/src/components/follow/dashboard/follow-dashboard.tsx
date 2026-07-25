'use client'

/**
 * FollowDashboard — v3 layout (Sprint WIRE-2)
 *
 * Minimal shell: sidebar + FollowMain. All legacy dashboard grid/list/activity
 * rendering has been moved into `legacy-dashboard.tsx` for reference and is no
 * longer rendered. The new UI routes all content through `follow-main.tsx`,
 * which picks the right view based on the store's `sidebarView`.
 */

import { DashSidebar } from './dash-sidebar'
import { FollowMain } from '@/components/follow/shell/follow-main'
import { AgentNudge } from '@/components/follow/notifications/agent-nudge'
import { IndexingBanner } from '@/components/follow/notifications/indexing-banner'
import { PreviewPane } from '@/components/follow/common/preview-pane'

interface FollowDashboardProps {
  workspaceId: string
}

export function FollowDashboard({ workspaceId }: FollowDashboardProps) {
  return (
    <div className="flex h-full" style={{ background: '#faf9f7' }} data-testid="follow-dashboard">
      <DashSidebar workspaceId={workspaceId} />
      <FollowMain />
      <AgentNudge />
      <IndexingBanner />
      <PreviewPane />
    </div>
  )
}
