'use client'

/**
 * HomeSidebar — left navigation for the docs home page.
 *
 * Four sections: All, Recent, Shared, Starred.
 * Compact 200px width, white background, subtle right border.
 */

export type DocFilter = 'all' | 'recent' | 'shared' | 'starred'

interface HomeSidebarProps {
  activeFilter: DocFilter
  onFilterChange: (filter: DocFilter) => void
  counts?: {
    all: number
    recent: number
    shared: number
    starred: number
  }
}

const NAV_ITEMS: { key: DocFilter; label: string; icon: string }[] = [
  { key: 'all', label: 'All Documents', icon: '📄' },
  { key: 'recent', label: 'Recent', icon: '🕐' },
  { key: 'shared', label: 'Shared with Me', icon: '👥' },
  { key: 'starred', label: 'Starred', icon: '⭐' },
]

export function HomeSidebar({ activeFilter, onFilterChange, counts }: HomeSidebarProps) {
  return (
    <nav
      className="flex h-full flex-col bg-white py-4"
      style={{
        width: 200,
        borderRight: '1px solid var(--n150)',
      }}
      data-testid="home-sidebar"
    >
      <div
        className="mb-3 px-4 text-xs font-semibold uppercase tracking-wider"
        style={{ color: 'var(--n400)' }}
      >
        Documents
      </div>

      {NAV_ITEMS.map((item) => {
        const isActive = activeFilter === item.key
        const count = counts?.[item.key]

        return (
          <button
            key={item.key}
            onClick={() => onFilterChange(item.key)}
            className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm transition-colors"
            style={{
              background: isActive ? 'var(--n100)' : undefined,
              color: isActive ? 'var(--n900)' : 'var(--n600)',
              fontWeight: isActive ? 600 : 400,
            }}
            data-testid={`filter-${item.key}`}
          >
            <span className="text-sm">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {count !== undefined && count > 0 && (
              <span className="text-xs tabular-nums" style={{ color: 'var(--n400)' }}>
                {count}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
