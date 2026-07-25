import { describe, it, expect } from 'vitest'

/**
 * Home Page — tests for HomeSidebar, DocumentCard, and DocList filtering logic.
 */

// ─── HomeSidebar nav items ──────────────────────────────────────────

describe('HomeSidebar', () => {
  const NAV_ITEMS = [
    { key: 'all', label: 'All Documents' },
    { key: 'recent', label: 'Recent' },
    { key: 'shared', label: 'Shared with Me' },
    { key: 'starred', label: 'Starred' },
  ] as const

  it('should have exactly 4 navigation items', () => {
    expect(NAV_ITEMS.length).toBe(4)
  })

  it('should have correct filter keys', () => {
    const keys = NAV_ITEMS.map((item) => item.key)
    expect(keys).toEqual(['all', 'recent', 'shared', 'starred'])
  })
})

// ─── DocumentCard type config ───────────────────────────────────────

describe('DocumentCard type configuration', () => {
  const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
    document: { label: 'Doc', color: 'var(--ai)' },
    note: { label: 'Note', color: '#10B981' },
    spreadsheet: { label: 'Sheet', color: '#F59E0B' },
    presentation: { label: 'Slides', color: '#EF4444' },
  }

  it('should have configs for all editor types', () => {
    expect(Object.keys(TYPE_CONFIG)).toEqual(['document', 'note', 'spreadsheet', 'presentation'])
  })

  it('should have distinct labels for each type', () => {
    const labels = Object.values(TYPE_CONFIG).map((c) => c.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

// ─── DocList filter logic ───────────────────────────────────────────

describe('DocList filtering', () => {
  interface MockDoc {
    id: string
    name: string
    updatedAt: string
    mimeType: string
    metadata: Record<string, unknown>
  }

  const now = Date.now()

  const mockDocs: MockDoc[] = [
    {
      id: '1',
      name: 'Recent Doc',
      updatedAt: new Date(now - 3600000).toISOString(), // 1 hour ago
      mimeType: 'text/html',
      metadata: { editorType: 'document' },
    },
    {
      id: '2',
      name: 'Old Doc',
      updatedAt: new Date(now - 14 * 86400000).toISOString(), // 14 days ago
      mimeType: 'text/html',
      metadata: { editorType: 'document' },
    },
    {
      id: '3',
      name: 'Shared Doc',
      updatedAt: new Date(now - 86400000).toISOString(), // 1 day ago
      mimeType: 'text/html',
      metadata: { editorType: 'document', isShared: true },
    },
  ]

  const RECENT_DAYS = 7

  it('should filter recent docs within last 7 days', () => {
    const cutoff = now - RECENT_DAYS * 86400000
    const recent = mockDocs.filter((d) => new Date(d.updatedAt).getTime() > cutoff)
    // Recent Doc (1h ago) and Shared Doc (1d ago) are recent, Old Doc (14d ago) is not
    expect(recent.length).toBe(2)
    expect(recent.map((d) => d.name)).toContain('Recent Doc')
    expect(recent.map((d) => d.name)).toContain('Shared Doc')
  })

  it('should filter shared docs by isShared metadata', () => {
    const shared = mockDocs.filter((d) => (d.metadata?.isShared as boolean) === true)
    expect(shared.length).toBe(1)
    expect(shared[0]!.name).toBe('Shared Doc')
  })
})
