'use client'

import type { FileTreeFolder } from './build-file-tree'

export function FolderCard({
  folder,
  onOpen,
  isWatched,
}: {
  folder: FileTreeFolder
  onOpen: () => void
  isWatched?: boolean
}) {
  const { indexed, queued, notIndexed, failed } = folder.statusSummary
  return (
    <div
      className="items-view-row"
      onClick={onOpen}
      onDoubleClick={onOpen}
      data-testid={`folder-card-${folder.path}`}
      style={{
        padding: '12px 18px',
        borderBottom: '1px solid var(--n100, #f0eeeb)',
        borderLeft: isWatched ? '3px solid #2d8a4e' : '3px solid transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span style={{ fontSize: 16 }} aria-hidden>
        📁
      </span>
      <span style={{ fontSize: 13, color: 'var(--n800,#332e25)', fontWeight: 500, flex: 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {folder.name}
        {isWatched && (
          <span
            title="Auto-update is on for this folder"
            style={{
              fontSize: 9,
              color: '#2d8a4e',
              background: 'rgba(45,138,78,0.10)',
              border: '1px solid rgba(45,138,78,0.25)',
              borderRadius: 999,
              padding: '1px 6px',
              fontFamily: 'ui-monospace,monospace',
              fontWeight: 500,
            }}
          >
            ● auto-update
          </span>
        )}
      </span>
      <span
        style={{
          fontSize: 10,
          fontFamily: 'ui-monospace,monospace',
          color: 'var(--n500,#807a70)',
          display: 'flex',
          gap: 8,
        }}
      >
        <span>{folder.fileCount} files</span>
        {indexed > 0 && <span style={{ color: '#2d8a4e' }}>{indexed}✓</span>}
        {queued > 0 && <span style={{ color: '#b7791f' }}>{queued}⏳</span>}
        {failed > 0 && <span style={{ color: '#c53030' }}>{failed}✗</span>}
        {notIndexed > 0 && <span>{notIndexed}·</span>}
      </span>
    </div>
  )
}
