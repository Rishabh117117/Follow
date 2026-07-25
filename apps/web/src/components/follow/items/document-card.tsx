'use client'

/**
 * DocumentCard — card representation of a document in the grid view.
 *
 * Shows a preview thumbnail area (colored by type), title, relative time,
 * editor type badge, and a star toggle button.
 */

interface DocumentCardProps {
  id: string
  name: string
  editorType: string
  updatedAt: string
  starred: boolean
  onClick: () => void
  onToggleStar: (e: React.MouseEvent) => void
}

const TYPE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  document: { icon: '📝', label: 'Doc', color: 'var(--ai)' },
  note: { icon: '🗒️', label: 'Note', color: '#10B981' },
  spreadsheet: { icon: '📊', label: 'Sheet', color: '#F59E0B' },
  presentation: { icon: '📽️', label: 'Slides', color: '#EF4444' },
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.round(diffMs / 60000)
  const diffHours = Math.round(diffMs / 3600000)
  const diffDays = Math.round(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.round(diffDays / 7)}w ago`
  return date.toLocaleDateString()
}

export function DocumentCard({
  id,
  name,
  editorType,
  updatedAt,
  starred,
  onClick,
  onToggleStar,
}: DocumentCardProps) {
  const config = TYPE_CONFIG[editorType] ?? TYPE_CONFIG.document!

  return (
    <button
      onClick={onClick}
      className="group flex w-full flex-col overflow-hidden rounded-lg text-left transition-shadow hover:shadow-md"
      style={{
        border: '1px solid var(--n150)',
        background: '#FFFFFF',
      }}
      data-testid={`doc-card-${id}`}
    >
      {/* Thumbnail area */}
      <div
        className="relative flex h-28 items-center justify-center"
        style={{ background: 'var(--n50)' }}
      >
        <span className="text-3xl">{config.icon}</span>

        {/* Star button */}
        <button
          onClick={onToggleStar}
          className="absolute right-2 top-2 rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100"
          style={{
            opacity: starred ? 1 : undefined,
            color: starred ? '#F59E0B' : 'var(--n400)',
            background: 'rgba(255,255,255,0.9)',
          }}
          data-testid={`star-btn-${id}`}
          title={starred ? 'Unstar' : 'Star'}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill={starred ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        </button>
      </div>

      {/* Info area */}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="truncate text-sm font-medium" style={{ color: 'var(--n800)' }}>
          {name}
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
            style={{
              background: `${config.color}15`,
              color: config.color,
            }}
          >
            {config.label}
          </span>
          <span className="text-xs" style={{ color: 'var(--n400)' }}>
            {formatRelativeTime(updatedAt)}
          </span>
        </div>
      </div>
    </button>
  )
}
