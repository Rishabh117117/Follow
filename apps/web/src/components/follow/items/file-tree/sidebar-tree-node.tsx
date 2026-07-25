'use client'

import { useEffect, useState } from 'react'
import type { FolderSkeleton } from './build-file-tree'
import { normalizePath } from '../_shared'

export function SidebarTreeNode({
  node,
  currentPath,
  onNavigate,
  depth,
  isRoot,
  watchedPaths,
}: {
  node: FolderSkeleton
  currentPath: string
  onNavigate: (p: string) => void
  depth: number
  isRoot?: boolean
  watchedPaths?: Set<string>
}) {
  const isWatched = !isRoot && watchedPaths?.has(normalizePath(node.path)) === true
  // Auto-expand ancestors of the current path so the user can see where
  // they are. A closed sidebar is useless when you've drilled 4 levels deep.
  const isAncestor =
    isRoot ||
    (node.path && (currentPath === node.path || currentPath.startsWith(node.path + '/')))
  const [expanded, setExpanded] = useState<boolean>(!!isAncestor || depth === 0)
  useEffect(() => {
    if (isAncestor) setExpanded(true)
  }, [isAncestor])

  const active = currentPath === node.path || (isRoot && currentPath === '')
  const hasChildren = node.children.length > 0

  return (
    <div>
      <div
        onClick={() => onNavigate(node.path)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          paddingLeft: 6 + depth * 12,
          cursor: 'pointer',
          background: active ? 'rgba(108,99,255,0.08)' : 'transparent',
          color: active ? '#6C63FF' : 'var(--n700,#494339)',
          fontWeight: active ? 500 : 400,
          fontSize: 12,
        }}
        data-testid={`side-tree-${node.path || 'root'}`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--n400,#9c968d)',
              width: 14,
              padding: 0,
              fontSize: 10,
            }}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span style={{ width: 14, display: 'inline-block' }} />
        )}
        <span style={{ fontSize: 13 }} aria-hidden>
          {isRoot ? '🗂' : '📁'}
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.name}
        </span>
        {isWatched && (
          <span
            title="Auto-update on"
            aria-label="auto-update"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#2d8a4e',
              boxShadow: '0 0 0 2px rgba(45,138,78,0.15)',
              flexShrink: 0,
            }}
          />
        )}
        {!isRoot && node.fileCount > 0 && (
          <span style={{ fontSize: 10, color: 'var(--n400,#9c968d)' }}>{node.fileCount}</span>
        )}
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <SidebarTreeNode
              key={child.path}
              node={child}
              currentPath={currentPath}
              onNavigate={onNavigate}
              depth={depth + 1}
              watchedPaths={watchedPaths}
            />
          ))}
        </div>
      )}
    </div>
  )
}
