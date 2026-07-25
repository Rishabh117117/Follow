'use client'

import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useDiscoverStore } from '@/stores/discover-store'
import { IndexCard } from './index-card'

interface IndexRecentActivityProps {
  workspaceId?: string
  className?: string
}

export function IndexRecentActivity({ workspaceId, className }: IndexRecentActivityProps) {
  const recent = useDiscoverStore((s) => s.recent)
  const loadRecent = useDiscoverStore((s) => s.loadRecent)
  const setSource = useDiscoverStore((s) => s.setSource)

  useEffect(() => {
    void loadRecent(workspaceId)
  }, [workspaceId, loadRecent])

  if (recent.length === 0) {
    return (
      <div
        className={cn('rounded-lg border border-dashed p-4 text-center', className)}
        style={{ borderColor: 'var(--n300, #d4d4d4)' }}
        data-testid="recent-activity-empty"
      >
        <p className="text-[12px]" style={{ color: 'var(--n500, #737373)' }}>
          No discoverable indexes yet.
        </p>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--n400, #a3a3a3)' }}>
          Indexes are invisible to Discover by default. Owners opt in per-index.
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn('grid grid-cols-1 gap-3 md:grid-cols-2', className)}
      data-testid="recent-activity-grid"
    >
      {recent.map((r) => (
        <IndexCard
          key={r.indexId}
          indexId={r.indexId}
          indexName={r.indexName}
          ownerName={r.ownerName ?? undefined}
          recordCount={r.recordCount}
          lastActivityAt={r.lastActivityAt}
          topics={r.topicalFingerprint?.map((t) => t.topic) ?? []}
          onOpen={(id) => setSource(id)}
        />
      ))}
    </div>
  )
}
