'use client'

import { DocList } from '@/components/follow/items/doc-list'
import { FloatingUnit } from '@/components/follow/shell/floating-unit'
import { useDevModeStore } from '@/stores/dev-mode-store'
import { useWorkspaceId } from '@/hooks/use-workspace-id'

export default function DocsPage() {
  const workspaceId = useWorkspaceId()
  const { devMode } = useDevModeStore()

  return (
    <div className="h-full bg-white">
      <DocList workspaceId={workspaceId} />
      {!devMode && <FloatingUnit workspaceId={workspaceId} />}
    </div>
  )
}
