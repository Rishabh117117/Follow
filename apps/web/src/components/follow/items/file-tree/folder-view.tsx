'use client'

import { useEffect, useMemo } from 'react'
import type React from 'react'
import {
  type FileTreeNode,
  findFolderByPath,
  folderSkeleton,
} from './build-file-tree'
import {
  useQueueControl,
  useWatchedFolders,
  classifyWatchedPath,
  normalizePath,
  type UnifiedItem,
} from '../_shared'
import { BreadcrumbBar } from './breadcrumb-bar'
import { SidebarTreeNode } from './sidebar-tree-node'
import { FolderCard } from './folder-card'

// ─── Folder view (Google-Docs-style) ──────────────────────────────────────
//
// Rendered when `fileViewMode === 'folder'`. Layout:
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │ Breadcrumb · [⏹ Stop following] · [⛔ Stop indexing] · [☰ Sidebar]│
//   ├──────────────┬───────────────────────────────────────────────────┤
//   │ folders-only │  current folder contents (folders then files)     │
//   │ tree (opt)   │                                                    │
//   └──────────────┴───────────────────────────────────────────────────┘
//
// Rationale:
//   - Breadcrumb is the anchor: clicking any segment jumps up the chain.
//   - Stop following vs Stop indexing are separate buttons by explicit user
//     request — following is the Desktop Agent watch; indexing is the
//     queue-side processing of already-uploaded files. Both can apply to
//     the same folder independently.
//   - Sidebar tree is an *optional* nav, togglable — users who prefer a
//     pure breadcrumb flow can hide it.
export function FolderView({
  tree,
  currentPath,
  setCurrentPath,
  showSideTree,
  setShowSideTree,
  renderItemRow,
  onInvalidateItems,
}: {
  tree: FileTreeNode[]
  currentPath: string
  setCurrentPath: (p: string) => void
  showSideTree: boolean
  setShowSideTree: (v: boolean) => void
  renderItemRow: (item: UnifiedItem, indent?: number) => React.ReactNode
  onInvalidateItems: () => void
}) {
  // Break the rule — we need the queue-control state here to pass down to
  // BreadcrumbBar so it can warn when the global queue is stopped.
  const queueControl = useQueueControl()
  // Resolve the current folder. If the persisted path no longer exists in
  // the tree (e.g. the folder was removed / renamed) fall back to root and
  // clear the stale pointer lazily — otherwise the view is stuck on nothing.
  const resolved = findFolderByPath(tree, currentPath)
  useEffect(() => {
    if (currentPath && resolved === undefined) setCurrentPath('')
  }, [currentPath, resolved, setCurrentPath])

  const activeChildren: FileTreeNode[] = resolved === null
    ? tree
    : resolved?.children ?? tree

  const segments = currentPath ? currentPath.split('/').filter(Boolean) : []
  const skeleton = useMemo(() => folderSkeleton(tree), [tree])

  // Single source of truth for which folders the Desktop Agent is following.
  // Passed down so the sidebar, folder cards, and breadcrumb all agree.
  const watched = useWatchedFolders()
  const watchedFolders = watched.data?.folders ?? []
  const launcherReachable = watched.data?.reachable !== false
  const watchedLoading = watched.isLoading || watched.isFetching && !watched.data
  const watchedPaths = useMemo(
    () => new Set(watchedFolders.map((f) => normalizePath(f.path))),
    [watchedFolders]
  )
  const classification = classifyWatchedPath(watchedFolders, currentPath)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <BreadcrumbBar
        segments={segments}
        currentPath={currentPath}
        onNavigate={setCurrentPath}
        showSideTree={showSideTree}
        onToggleSideTree={() => setShowSideTree(!showSideTree)}
        classification={classification}
        classificationLoading={watchedLoading}
        launcherReachable={launcherReachable}
        queueStopped={queueControl.data?.stopped === true}
        queuePaused={queueControl.data?.paused === true}
        onUnwatched={() => {
          watched.refetch()
          onInvalidateItems()
        }}
      />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {showSideTree && (
          <div
            style={{
              width: 220,
              borderRight: '1px solid var(--n150, #e5e2de)',
              overflow: 'auto',
              flexShrink: 0,
              padding: '8px 0',
              fontSize: 12,
            }}
            data-testid="folder-sidebar"
          >
            <SidebarTreeNode
              node={{ name: 'All files', path: '', fileCount: 0, children: skeleton }}
              currentPath={currentPath}
              onNavigate={setCurrentPath}
              depth={0}
              isRoot
              watchedPaths={watchedPaths}
            />
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {activeChildren.length === 0 ? (
            <div
              style={{
                padding: 24,
                color: 'var(--n400, #9c968d)',
                fontSize: 12,
                fontStyle: 'italic',
              }}
            >
              This folder is empty.
            </div>
          ) : (
            activeChildren.map((node) =>
              node.kind === 'folder' ? (
                <FolderCard
                  key={`folder:${node.path}`}
                  folder={node}
                  onOpen={() => setCurrentPath(node.path)}
                  isWatched={watchedPaths.has(normalizePath(node.path))}
                />
              ) : (
                <div key={`file:${node.item.id}`}>{renderItemRow(node.item)}</div>
              )
            )
          )}
        </div>
      </div>
    </div>
  )
}
