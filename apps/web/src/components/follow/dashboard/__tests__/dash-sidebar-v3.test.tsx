import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { useFollowDashboardStore } from '@/stores/follow-dashboard-store'
import { useIndexStore } from '@/stores/index-store'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(
  resolve(__dirname, '..', 'dash-sidebar.tsx'),
  'utf-8'
)

describe('DashSidebar v3 layout (WIRE-2)', () => {
  beforeEach(() => {
    useFollowDashboardStore.setState({
      sidebarView: 'items',
      sectionFilter: 'all',
      selectedItem: null,
    })
    useIndexStore.setState({
      activeIndexId: 'personal',
      indexes: [
        { id: 'personal', name: 'Personal', type: 'personal', facts: 247, files: 89, chats: 34 },
      ],
    })
  })

  it('renders the v3 sidebar marker', () => {
    expect(source).toContain('dash-sidebar-v3')
  })

  it('renders 4 section filters (All Items / Conversations / Files / Facts)', () => {
    expect(source).toContain('All Items')
    expect(source).toContain('Conversations')
    expect(source).toContain("label: 'Files'")
    expect(source).toContain("label: 'Facts'")
    expect(source).toContain('section-${s.id}')
    expect(source).toContain("id: 'all'")
    expect(source).toContain("id: 'conversation'")
    expect(source).toContain("id: 'file'")
    expect(source).toContain("id: 'fact'")
  })

  it('clicking a section calls setSectionFilter and setSidebarView(items)', () => {
    expect(source).toContain('setSectionFilter(s.id)')
    expect(source).toContain("setSidebarView('items')")
  })

  it('renders Notebooks and Memory buttons', () => {
    expect(source).toContain("view: 'notebooks'")
    expect(source).toContain("view: 'memory'")
    expect(source).toContain('view-${vb.view}')
    expect(source).toContain("label: 'Notebooks'")
    expect(source).toContain("label: 'Memory'")
  })

  it('renders Feature Vault at bottom', () => {
    expect(source).toContain('view-vault')
    expect(source).toContain('Feature Vault')
  })

  it('renders index stats panel with Facts/Files/Chats counts', () => {
    expect(source).toContain('index-stats')
    expect(source).toContain("['Facts', active.facts]")
    expect(source).toContain("['Files', active.files]")
    expect(source).toContain("['Chats', active.chats]")
  })

  it('profile footer uses useSession() and clicks to profile view', () => {
    expect(source).toContain("import { useSession, signOut } from 'next-auth/react'")
    expect(source).toContain("setSidebarView('profile')")
    expect(source).toContain('profile-footer')
    expect(source).toContain('profile-footer-name')
    expect(source).toContain('profile-footer-email')
  })

  it('does not contain legacy Recents/All Documents/Shared/Starred/Tracked/Projects nav', () => {
    // These legacy strings should no longer appear as sidebar nav items
    expect(source).not.toContain('setFilter(\'recent\')')
    expect(source).not.toContain('Shared with me')
    expect(source).not.toContain('Tracked Documents')
    expect(source).not.toContain('PROJECTS')
  })

  it('section filters read counts from active index', () => {
    expect(source).toContain('getActiveIndex')
    expect(source).toContain('active?.facts')
    expect(source).toContain('active?.files')
    expect(source).toContain('active?.chats')
  })
})
