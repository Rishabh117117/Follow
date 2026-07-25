'use client'

/**
 * Follow Sidebar — v3 layout (Sprint WIRE-2)
 *
 * Matches the v3 wireframe exactly:
 *   - Brand "Follow"
 *   - Index dropdown (IndexSelector)
 *   - Section filters (All Items / Conversations / Files / Facts)
 *   - Notebooks button
 *   - Memory button
 *   - (spacer)
 *   - Feature Vault button
 *   - Index stats panel (Facts / Files / Chats)
 *   - User profile footer (clickable → profile view)
 *
 * Props kept (workspaceId, fileCounts, projects) for back-compat with the
 * existing call site, but they are not used by the v3 sidebar.
 */

import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import {
  useFollowDashboardStore,
  type SectionFilter,
  type SidebarView,
} from '@/stores/follow-dashboard-store'
import { useIndexStore } from '@/stores/index-store'
import { McpReadyIndicator } from '@/components/follow/shell/mcp-ready-indicator'
import { ScopePanel } from './scope-panel'
import { IndexSelector } from '@/components/follow/items/index-selector'

export interface SidebarProject {
  id: string
  name: string
  color: string | null
  count: number
}

interface DashSidebarProps {
  workspaceId?: string
  fileCounts?: {
    all: number
    shared: number
    starred: number
    smartDocs?: number
  }
  projects?: SidebarProject[]
}

function getInitials(name: string | null | undefined): string {
  if (!name) return 'U'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]!.toUpperCase())
    .join('')
}

export function DashSidebar(_props: DashSidebarProps) {
  const { sidebarView, sectionFilter, setSidebarView, setSectionFilter } = useFollowDashboardStore()
  const { getActiveIndex, fetchIndexes } = useIndexStore()
  const active = getActiveIndex()
  const { data: session } = useSession()
  const user = session?.user

  // Keep sidebar counts live. /api/indexes runs 6 fast COUNT(*) queries; safe
  // to poll. Also refresh immediately whenever something mutates the item
  // set — AddToIndexModal, the per-item Index button, and MCP save events
  // all fire the `follow:items-changed` custom event.
  useEffect(() => {
    fetchIndexes()
    const id = setInterval(() => fetchIndexes(), 10_000)
    const onChanged = () => fetchIndexes()
    window.addEventListener('follow:items-changed', onChanged)
    return () => {
      clearInterval(id)
      window.removeEventListener('follow:items-changed', onChanged)
    }
  }, [fetchIndexes])

  const userName = user?.name ?? 'User'
  const userEmail = user?.email ?? ''
  const avatarUrl = user?.image ?? null
  const initials = getInitials(user?.name)

  // Profile gear menu (Settings / Sign out) — replaces the old one-shot logout button.
  const router = useRouter()
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!profileMenuOpen) return
    const onDocClick = (ev: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(ev.target as Node)) {
        setProfileMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [profileMenuOpen])

  // Counts from the active index (WIRE-1 real data)
  const factsCount = active?.facts ?? 0
  const filesCount = active?.files ?? 0
  const chatsCount = active?.chats ?? 0
  const allCount = factsCount + filesCount + chatsCount

  const sections: Array<{ id: SectionFilter; label: string; icon: string; count: number }> = [
    { id: 'all', label: 'All Items', icon: '◉', count: allCount },
    { id: 'conversation', label: 'Conversations', icon: '◯', count: chatsCount },
    { id: 'file', label: 'Files', icon: '◫', count: filesCount },
    { id: 'fact', label: 'Facts', icon: '◈', count: factsCount },
  ]

  const viewButtons: Array<{ view: SidebarView; label: string; icon: string; count: number }> = [
    { view: 'overview', label: 'Dashboard', icon: '◐', count: 0 },
    { view: 'notebooks', label: 'Notebooks', icon: '▤', count: 0 },
    { view: 'memory', label: 'Memory', icon: '⧉', count: 6 },
  ]

  // Section filter buttons now route to the Dashboard's <ItemsSection /> and
  // scroll-anchor it into view. The legacy `sidebarView === 'items'` standalone
  // page is no longer reachable from the sidebar.
  const onSectionClick = (id: SectionFilter) => {
    setSectionFilter(id)
    setSidebarView('overview')
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        const el = document.querySelector('[data-testid="dashboard-items-section"]')
        if (el && 'scrollIntoView' in el) {
          ;(el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      })
    }
  }
  const isItemsActive = sidebarView === 'overview'

  return (
    <aside
      className="flex h-full w-[240px] flex-shrink-0 flex-col"
      style={{ background: '#fff', borderRight: '1px solid var(--n150, #e5e2de)' }}
      data-testid="dash-sidebar-v3"
    >
      {/* Brand + Index selector */}
      <div style={{ padding: '16px 14px 10px' }}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: '#6C63FF',
            letterSpacing: -0.5,
            marginBottom: 12,
          }}
        >
          Follow
        </div>
        <IndexSelector />
      </div>

      {/* Section filters */}
      <div style={{ padding: '0 8px' }} data-testid="section-filters">
        {sections.map((s) => {
          const isActive = isItemsActive && sectionFilter === s.id
          return (
            <button
              key={s.id}
              onClick={() => onSectionClick(s.id)}
              className="w-full"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                border: 'none',
                borderRadius: 7,
                background: isActive ? 'rgba(108,99,255,0.10)' : 'transparent',
                color: isActive ? '#6C63FF' : 'var(--n600, #666054)',
                cursor: 'pointer',
                fontSize: 12.5,
                marginBottom: 1,
              }}
              data-testid={`section-${s.id}`}
            >
              <span style={{ fontSize: 13, width: 18, textAlign: 'center' }}>{s.icon}</span>
              <span style={{ flex: 1, textAlign: 'left' }}>{s.label}</span>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'monospace',
                  color: 'var(--n400, #9c968d)',
                }}
              >
                {s.count}
              </span>
            </button>
          )
        })}
      </div>

      <div style={{ height: 1, background: 'var(--n150, #e5e2de)', margin: '8px 14px' }} />

      {/* Notebooks + Memory */}
      <div style={{ padding: '0 8px' }} data-testid="view-buttons">
        {viewButtons.map((vb) => {
          const isActive = sidebarView === vb.view
          return (
            <button
              key={vb.view}
              onClick={() => setSidebarView(vb.view)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                border: 'none',
                borderRadius: 7,
                background: isActive ? 'rgba(108,99,255,0.10)' : 'transparent',
                color: isActive ? '#6C63FF' : 'var(--n600, #666054)',
                cursor: 'pointer',
                fontSize: 12.5,
                marginBottom: 1,
              }}
              data-testid={`view-${vb.view}`}
            >
              <span style={{ fontSize: 13, width: 18, textAlign: 'center' }}>{vb.icon}</span>
              <span style={{ flex: 1, textAlign: 'left' }}>{vb.label}</span>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'monospace',
                  color: 'var(--n400, #9c968d)',
                }}
              >
                {vb.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Flex spacer pushes Vault + stats + profile to bottom */}
      <div style={{ flex: 1 }} />

      {/* Feature Vault */}
      <div style={{ padding: '0 8px', marginBottom: 4 }}>
        <button
          onClick={() => setSidebarView('vault')}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            border: 'none',
            borderRadius: 7,
            background: sidebarView === 'vault' ? 'rgba(108,99,255,0.10)' : 'transparent',
            color: sidebarView === 'vault' ? '#6C63FF' : 'var(--n500, #807a70)',
            cursor: 'pointer',
            fontSize: 12,
          }}
          data-testid="view-vault"
        >
          <span style={{ fontSize: 13, width: 18, textAlign: 'center' }}>⬡</span>
          <span style={{ flex: 1, textAlign: 'left' }}>Feature Vault</span>
          <span
            style={{
              fontSize: 9,
              fontFamily: 'monospace',
              color: '#b7791f',
              background: 'rgba(183,121,31,0.15)',
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            16
          </span>
        </button>
      </div>

      {/* Index stats */}
      {active && (
        <div
          style={{
            padding: '8px 16px',
            borderTop: '1px solid var(--n150, #e5e2de)',
          }}
          data-testid="index-stats"
        >
          <div
            style={{
              fontSize: 9,
              fontFamily: 'monospace',
              color: 'var(--n400, #9c968d)',
              letterSpacing: 1.5,
              marginBottom: 4,
            }}
          >
            {active.name.toUpperCase()}
          </div>
          {[
            ['Facts', active.facts],
            ['Files', active.files],
            ['Chats', active.chats],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}
            >
              <span style={{ fontSize: 11, color: 'var(--n500, #807a70)' }}>{label}</span>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: 'var(--n700, #4d473c)',
                }}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Workspace-level scope panel — collapsible, sits above the MCP indicator
          because scope is keyed by (userId, workspaceId), not by space. Putting
          it in the sidebar keeps it visible across project switches. */}
      <ScopePanel />

      {/* MCP-ready indicator — status chip above the profile footer */}
      <McpReadyIndicator />

      {/* Profile footer — div (not button) so we can nest gear-menu buttons inside legally */}
      <div
        onClick={() => setSidebarView('profile')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setSidebarView('profile')
        }}
        style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--n150, #e5e2de)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: sidebarView === 'profile' ? 'rgba(108,99,255,0.05)' : 'transparent',
          cursor: 'pointer',
          width: '100%',
        }}
        data-testid="profile-footer"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'rgba(108,99,255,0.22)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              color: '#6C63FF',
            }}
          >
            {initials}
          </div>
        )}
        <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              color: 'var(--n800, #332e25)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            data-testid="profile-footer-name"
          >
            {userName}
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--n400, #9c968d)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            data-testid="profile-footer-email"
          >
            {userEmail}
          </div>
        </div>
        <div ref={profileMenuRef} style={{ position: 'relative' }}>
          <span
            onClick={(e) => {
              e.stopPropagation()
              setProfileMenuOpen((v) => !v)
            }}
            style={{ fontSize: 14, color: 'var(--n400, #9c968d)', cursor: 'pointer' }}
            title="Settings"
          >
            ⚙
          </span>
          {profileMenuOpen && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                bottom: 'calc(100% + 6px)',
                minWidth: 160,
                background: 'white',
                border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                padding: 4,
                zIndex: 60,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen(false)
                  router.push('/settings/profile')
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: 'none',
                  background: 'transparent',
                  borderRadius: 6,
                  fontSize: 12,
                  color: 'var(--n800, #332e25)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.04)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                }}
              >
                Settings
              </button>
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen(false)
                  router.push('/settings/agents')
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: 'none',
                  background: 'transparent',
                  borderRadius: 6,
                  fontSize: 12,
                  color: 'var(--n800, #332e25)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.04)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                }}
              >
                Desktop Agent
              </button>
              <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '4px 6px' }} />
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen(false)
                  signOut({ callbackUrl: '/auth/login' })
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: 'none',
                  background: 'transparent',
                  borderRadius: 6,
                  fontSize: 12,
                  color: '#c23a3a',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(194,58,58,0.08)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
