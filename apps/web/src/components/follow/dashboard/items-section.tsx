'use client'

/**
 * ItemsSection — embedded items feed for the Dashboard.
 *
 * Renders a filter bar (All / Conversations / Files / Facts) plus a list of
 * unified items. Clicking a row sets the global `selectedItem` so the
 * PreviewPane slides in. Designed to live inside the scrolling Dashboard
 * column, not as a standalone page — that's still ItemsView.
 */

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import {
  useFollowDashboardStore,
  type SectionFilter,
  type ItemType,
} from '@/stores/follow-dashboard-store'
import { useUnifiedItems } from '@/components/follow/items/use-unified-items'
import { SourcePill } from '../items/badges/source-pill'
import { ConfidenceDot } from '../items/badges/confidence-dot'
import { IndexStatusBadge } from '../items/badges/index-status-badge'
import { useIndexStatus } from '../items/_shared'

const FILTERS: Array<{ id: SectionFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'conversation', label: 'Conversations' },
  { id: 'file', label: 'Files' },
  { id: 'fact', label: 'Facts' },
]

export function ItemsSection() {
  const params = useParams<{ id?: string }>()
  const workspaceId = params?.id ?? ''
  const { sectionFilter, setSectionFilter, selectedItem, setSelectedItem } =
    useFollowDashboardStore()
  const { items, isLoading } = useUnifiedItems(workspaceId)

  const filtered = useMemo(() => {
    if (sectionFilter === 'all') return items
    const target: ItemType =
      sectionFilter === 'conversation' ? 'conv' : sectionFilter === 'file' ? 'file' : 'fact'
    return items.filter((i) => i.it === target)
  }, [items, sectionFilter])

  const visible = useMemo(
    () => filtered.filter((i) => !(i.raw as { hidden?: boolean }).hidden).slice(0, 80),
    [filtered]
  )

  const statusIds = useMemo(
    () =>
      visible
        .filter((i) => i.it !== 'fact')
        .map((i) => i.id)
        .sort(),
    [visible]
  )
  const indexStatus = useIndexStatus(statusIds)

  return (
    <section className="mb-6 mt-7" data-testid="dashboard-items-section">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Items
        </h2>
        <div
          style={{
            display: 'flex',
            background: 'var(--n100, #f0eeeb)',
            borderRadius: 8,
            padding: 3,
          }}
          data-testid="items-section-filters"
        >
          {FILTERS.map((f) => {
            const active = sectionFilter === f.id
            const count =
              f.id === 'all'
                ? items.length
                : items.filter((i) =>
                    f.id === 'conversation'
                      ? i.it === 'conv'
                      : f.id === 'file'
                        ? i.it === 'file'
                        : i.it === 'fact'
                  ).length
            return (
              <button
                key={f.id}
                onClick={() => setSectionFilter(f.id)}
                data-testid={`items-section-filter-${f.id}`}
                style={{
                  padding: '4px 12px',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 11,
                  background: active ? '#fff' : 'transparent',
                  color: active ? 'var(--n800, #332e25)' : 'var(--n500, #807a70)',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>{f.label}</span>
                <span
                  style={{
                    fontSize: 9,
                    color: active ? 'var(--n500, #807a70)' : 'var(--n400, #9c968d)',
                  }}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {isLoading ? (
          <div
            style={{ padding: 24, color: 'var(--n400, #9c968d)', fontSize: 12 }}
            data-testid="items-section-loading"
          >
            Loading items…
          </div>
        ) : visible.length === 0 ? (
          <div
            style={{
              padding: '20px 24px',
              color: 'var(--n400, #9c968d)',
              fontSize: 11,
              fontFamily: 'monospace',
            }}
            data-testid="items-section-empty"
          >
            No items in this section yet.
          </div>
        ) : (
          visible.map((item) => {
            const isSel = selectedItem?.id === item.id
            const groupCount = (item.raw as { _groupCount?: number })._groupCount
            return (
              <div
                key={item.id}
                onClick={() => setSelectedItem({ id: item.id, type: item.it })}
                data-testid={`items-section-row-${item.id}`}
                style={{
                  padding: '11px 16px',
                  borderBottom: '1px solid var(--n100, #f0eeeb)',
                  cursor: 'pointer',
                  background: isSel ? 'rgba(108,99,255,0.08)' : 'transparent',
                  borderLeft: isSel ? '3px solid #6C63FF' : '3px solid transparent',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  transition: 'background 100ms',
                }}
                onMouseEnter={(e) => {
                  if (!isSel) e.currentTarget.style.background = 'var(--n50, #faf9f7)'
                }}
                onMouseLeave={(e) => {
                  if (!isSel) e.currentTarget.style.background = 'transparent'
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: isSel ? '#6C63FF' : 'var(--n800, #332e25)',
                      fontWeight: 500,
                      marginBottom: 3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.title}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flexWrap: 'wrap',
                    }}
                  >
                    <SourcePill source={item.source} small />
                    {typeof groupCount === 'number' && groupCount > 1 && (
                      <span
                        style={{
                          fontSize: 9,
                          fontFamily: 'monospace',
                          color: '#6C63FF',
                          background: 'rgba(108,99,255,0.12)',
                          padding: '1px 6px',
                          borderRadius: 4,
                        }}
                      >
                        ×{groupCount} updates
                      </span>
                    )}
                    {item.time && (
                      <span style={{ fontSize: 10, color: 'var(--n400, #9c968d)' }}>
                        {item.time}
                      </span>
                    )}
                    {typeof item.confidence === 'number' && (
                      <ConfidenceDot value={item.confidence} />
                    )}
                    {item.it !== 'fact' && (
                      <IndexStatusBadge
                        fileId={item.id}
                        status={
                          indexStatus[item.id] ?? {
                            upload: 'uploaded',
                            index: 'not_indexed',
                          }
                        }
                        onIndex={() => {
                          /* triggered from ItemsView power-user surface */
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
      {filtered.length > visible.length ? (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: 'var(--n500, #807a70)',
            fontFamily: 'monospace',
          }}
        >
          Showing {visible.length} of {filtered.length}
        </div>
      ) : null}
    </section>
  )
}
