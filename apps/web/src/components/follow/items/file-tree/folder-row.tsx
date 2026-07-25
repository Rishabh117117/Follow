'use client'

import type { FileTreeFolder } from './build-file-tree'

/**
 * Folder row in the Files tree view. Clicking toggles expand/collapse.
 * Rolls up child-file index statuses into a compact health pill so you can
 * see at a glance which folders still have unindexed content.
 */
export function FolderRow({
  folder,
  depth,
  expanded,
  onToggle,
}: {
  folder: FileTreeFolder
  depth: number
  expanded: boolean
  onToggle: () => void
}) {
  const { indexed, queued, notIndexed, failed } = folder.statusSummary
  return (
    <div
      className="items-view-row"
      onClick={onToggle}
      data-testid={`folder-row-${folder.path}`}
      style={{
        padding: '10px 18px',
        paddingLeft: 18 + depth * 18,
        borderBottom: '1px solid var(--n100, #f0eeeb)',
        cursor: 'pointer',
        background: 'transparent',
        borderLeft: '3px solid transparent',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        userSelect: 'none',
      }}
    >
      <span
        data-testid={`folder-caret-${folder.path}`}
        style={{
          fontSize: 10,
          width: 12,
          display: 'inline-block',
          color: 'var(--n500, #807a70)',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 120ms ease',
        }}
      >
        ▶
      </span>
      <span style={{ fontSize: 14 }}>{expanded ? '📂' : '📁'}</span>
      <span
        style={{
          fontSize: 13,
          color: 'var(--n800, #332e25)',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
        }}
        title={folder.path}
      >
        {folder.name}
      </span>
      <span
        style={{
          fontSize: 10,
          color: 'var(--n400, #9c968d)',
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
        }}
        data-testid={`folder-count-${folder.path}`}
      >
        {folder.fileCount} file{folder.fileCount === 1 ? '' : 's'}
      </span>
      {(indexed > 0 || queued > 0 || failed > 0) && (
        <span
          data-testid={`folder-status-${folder.path}`}
          style={{
            display: 'inline-flex',
            gap: 4,
            fontSize: 9,
            fontFamily: 'monospace',
          }}
        >
          {indexed > 0 && (
            <span
              title={`${indexed} indexed`}
              style={{
                color: '#2d8a4e',
                background: 'rgba(45,138,78,0.12)',
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              {indexed}✓
            </span>
          )}
          {queued > 0 && (
            <span
              title={`${queued} queued or indexing`}
              style={{
                color: '#b7791f',
                background: 'rgba(183,121,31,0.12)',
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              {queued}⏳
            </span>
          )}
          {failed > 0 && (
            <span
              title={`${failed} failed`}
              style={{
                color: '#c53030',
                background: 'rgba(197,48,48,0.12)',
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              {failed}✗
            </span>
          )}
          {notIndexed > 0 && (
            <span
              title={`${notIndexed} not indexed`}
              style={{
                color: 'var(--n500, #807a70)',
                background: 'var(--n100, #f0eeeb)',
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              {notIndexed}·
            </span>
          )}
        </span>
      )}
    </div>
  )
}
