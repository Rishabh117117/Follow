'use client'

/**
 * PreviewPane — global slide-over detail panel.
 *
 * Mounted once at the dashboard shell so any view (Dashboard items section,
 * Notebooks, Memory) can open a preview by setting `selectedItem` in the
 * follow-dashboard store. Closes on backdrop click, Escape, or the X button.
 *
 * Hidden when `sidebarView === 'items'` because ItemsView still renders its
 * own inline detail pane in that mode (see Phase 3 of the unification).
 */

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useFollowDashboardStore } from '@/stores/follow-dashboard-store'
import { useUnifiedItems } from '@/components/follow/items/use-unified-items'
import { ConversationDetail } from '@/components/follow/items/detail/conversation-detail'
import { ConversationGroupDetail } from '@/components/follow/items/detail/conversation-group-detail'
import { FileDetail } from '@/components/follow/items/detail/file-detail'
import { FactDetail } from '@/components/follow/items/detail/fact-detail'
import { DetailViewToggle } from '@/components/follow/items/detail/detail-view-toggle'
import { SourcePill } from '@/components/follow/items/badges/source-pill'

export function PreviewPane() {
  const params = useParams<{ id?: string }>()
  const workspaceId = params?.id ?? ''
  const { sidebarView, selectedItem, detailViewMode, setSelectedItem } = useFollowDashboardStore()

  // ItemsView still renders its own inline detail. Don't double up.
  const suppress = sidebarView === 'items'

  const { items } = useUnifiedItems(workspaceId)
  const selected = selectedItem ? items.find((i) => i.id === selectedItem.id) : null

  // Esc to close. Effect must mount unconditionally to keep hook order stable.
  useEffect(() => {
    if (suppress || !selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setSelectedItem(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [suppress, selected, setSelectedItem])

  if (suppress || !selected) return null

  const close = () => setSelectedItem(null)

  return (
    <>
      {/* Backdrop */}
      <div
        data-testid="preview-pane-backdrop"
        onClick={close}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 12, 8, 0.18)',
          zIndex: 70,
          animation: 'follow-preview-fade 140ms ease-out',
        }}
      />

      {/* Slide-over panel */}
      <aside
        data-testid="preview-pane"
        role="dialog"
        aria-label={selected.title}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(560px, 92vw)',
          background: '#fff',
          borderLeft: '1px solid var(--n150, #e5e2de)',
          boxShadow: '-12px 0 32px rgba(15, 12, 8, 0.10)',
          zIndex: 71,
          display: 'flex',
          flexDirection: 'column',
          animation: 'follow-preview-slide 180ms cubic-bezier(0.2, 0, 0, 1)',
        }}
      >
        <style jsx>{`
          @keyframes follow-preview-slide {
            from {
              transform: translateX(100%);
            }
            to {
              transform: translateX(0);
            }
          }
          @keyframes follow-preview-fade {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
        `}</style>

        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 18px',
            borderBottom: '1px solid var(--n150, #e5e2de)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--n800, #332e25)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              data-testid="preview-pane-title"
            >
              {selected.title}
            </span>
            <SourcePill source={selected.source} small />
          </div>
          <DetailViewToggle current={detailViewMode} />
          <button
            type="button"
            data-testid="preview-pane-close"
            onClick={close}
            aria-label="Close preview"
            title="Close (Esc)"
            style={{
              padding: 6,
              border: 'none',
              background: 'transparent',
              color: 'var(--n500, #807a70)',
              cursor: 'pointer',
              borderRadius: 6,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--n100, #f0eeeb)'
              e.currentTarget.style.color = 'var(--n800, #332e25)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--n500, #807a70)'
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px' }}>
          {detailViewMode === 'original' ? (
            <>
              {selected.it === 'conv' &&
                (() => {
                  const groupIds = (selected.raw as { _groupMemberIds?: string[] })._groupMemberIds
                  const groupMembers =
                    (
                      selected.raw as {
                        _groupMembers?: Array<{
                          id: string
                          title: string
                          createdAt?: string
                        }>
                      }
                    )._groupMembers ?? []
                  if (groupIds && groupIds.length > 1) {
                    return (
                      <ConversationGroupDetail
                        memberIds={groupIds}
                        members={groupMembers}
                        source={selected.source}
                      />
                    )
                  }
                  return (
                    <ConversationDetail conversationId={selected.id} source={selected.source} />
                  )
                })()}
              {selected.it === 'file' && <FileDetail item={selected} />}
              {selected.it === 'fact' && <FactDetail item={selected} />}
            </>
          ) : (
            <div
              style={{
                padding: 32,
                textAlign: 'center',
                color: 'var(--n400, #9c968d)',
                fontSize: 13,
              }}
              data-testid="preview-pane-placeholder"
            >
              {detailViewMode === 'intelligence'
                ? 'Intelligence view coming soon.'
                : 'Both view (original + intelligence) coming soon.'}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
