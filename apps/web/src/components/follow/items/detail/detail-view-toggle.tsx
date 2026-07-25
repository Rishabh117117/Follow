'use client'

import { useFollowDashboardStore, type DetailViewMode } from '@/stores/follow-dashboard-store'

export function DetailViewToggle({ current }: { current: DetailViewMode }) {
  const { setDetailViewMode } = useFollowDashboardStore()
  const modes: DetailViewMode[] = ['original', 'intelligence', 'both']
  return (
    <div
      style={{
        display: 'flex',
        background: 'var(--n100, #f0eeeb)',
        borderRadius: 8,
        padding: 3,
      }}
      data-testid="detail-toggle"
    >
      {modes.map((m) => (
        <button
          key={m}
          onClick={() => setDetailViewMode(m)}
          style={{
            padding: '5px 12px',
            border: 'none',
            borderRadius: 6,
            fontSize: 10,
            background: current === m ? '#fff' : 'transparent',
            color: current === m ? 'var(--n800, #332e25)' : 'var(--n500, #807a70)',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
          data-testid={`detail-toggle-${m}`}
        >
          {m.charAt(0).toUpperCase() + m.slice(1)}
        </button>
      ))}
    </div>
  )
}
