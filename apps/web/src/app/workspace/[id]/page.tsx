'use client'

import { useWorkspaceId } from '@/hooks/use-workspace-id'
import { FollowDashboard } from '@/components/follow/dashboard/follow-dashboard'

export default function WorkspacePage() {
  const workspaceId = useWorkspaceId()
  return <FollowDashboard workspaceId={workspaceId} />
}
