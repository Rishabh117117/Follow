import { create } from 'zustand'
import { DEV_WORKSPACE } from '@workspace/shared/constants'
import { authFetch } from '@/lib/api-client'

// ─── Types ─────────────────────────────────────────────────────────────────

export type ClipSourceType =
  | 'document'
  | 'web'
  | 'chat'
  | 'canvas'
  | 'extension'
  | 'import'
  | 'manual'

export interface EvidenceClip {
  id: string
  /** The quoted text or captured content */
  quote: string
  /** Where this clip came from */
  sourceType: ClipSourceType
  /** Source label (file name, URL, conversation title, etc.) */
  sourceLabel: string
  /** Optional URL for web sources */
  sourceUrl?: string
  /** Optional file ID for document sources */
  fileId?: string
  /** User interpretation / annotation */
  interpretation: string
  /** Tags for grouping */
  tags: string[]
  /** Timestamp of when clip was created */
  createdAt: string
  /** Whether this clip is pinned */
  isPinned: boolean
  /** Color highlight (optional) */
  highlightColor?: string
  /** Notebook assignment — null means loose clip */
  notebookId: string | null
  /** Pinned to a specific chat thread — null means not pinned */
  pinnedToChatId: string | null
}

export type ClipSortMode = 'newest' | 'oldest' | 'source' | 'pinned'
export type ClipFilterSource = ClipSourceType | 'all'

interface FollowNotesState {
  /** All evidence clips */
  clips: EvidenceClip[]
  /** Currently selected clip ID (for detail view) */
  activeClipId: string | null
  /** Panel open/closed */
  isPanelOpen: boolean
  /** Sort mode */
  sortMode: ClipSortMode
  /** Filter by source type */
  filterSource: ClipFilterSource
  /** Search query */
  searchQuery: string

  // Actions
  addClip: (clip: EvidenceClip) => void
  removeClip: (id: string) => void
  updateClip: (id: string, update: Partial<EvidenceClip>) => void
  setInterpretation: (id: string, interpretation: string) => void
  togglePin: (id: string) => void
  addTag: (id: string, tag: string) => void
  removeTag: (id: string, tag: string) => void
  setActiveClip: (id: string | null) => void
  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
  setSortMode: (mode: ClipSortMode) => void
  setFilterSource: (source: ClipFilterSource) => void
  setSearchQuery: (query: string) => void
  reset: () => void

  // Hybrid notes actions (UI-4)
  moveToNotebook: (noteId: string, notebookId: string) => void
  pinToChat: (noteId: string, chatId: string) => void
  unpinFromChat: (noteId: string) => void
  createClipFromPage: (text: string, source: string) => void
}

export const useFollowNotesStore = create<FollowNotesState>((set) => ({
  clips: [],
  activeClipId: null,
  isPanelOpen: false,
  sortMode: 'newest',
  filterSource: 'all',
  searchQuery: '',

  addClip: (clip) => {
    // Add locally (immediate UX)
    set((s) => ({ clips: [clip, ...s.clips] }))

    // Sync to backend (non-blocking, Sprint IX-6)
    authFetch(`/api/follow-notes/clips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quote: clip.quote,
        sourceType: clip.sourceType,
        sourceLabel: clip.sourceLabel,
        sourceUrl: clip.sourceUrl,
        fileId: clip.fileId,
        interpretation: clip.interpretation,
        tags: clip.tags,
        documentId: clip.fileId,
        workspaceId: DEV_WORKSPACE.id,
      }),
    }).catch((err) => {
      console.error('[FollowNotes] Failed to persist clip:', err)
    })
  },

  removeClip: (id) =>
    set((s) => ({
      clips: s.clips.filter((c) => c.id !== id),
      activeClipId: s.activeClipId === id ? null : s.activeClipId,
    })),

  updateClip: (id, update) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, ...update } : c)),
    })),

  setInterpretation: (id, interpretation) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, interpretation } : c)),
    })),

  togglePin: (id) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, isPinned: !c.isPinned } : c)),
    })),

  addTag: (id, tag) =>
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === id && !c.tags.includes(tag) ? { ...c, tags: [...c.tags, tag] } : c
      ),
    })),

  removeTag: (id, tag) =>
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === id ? { ...c, tags: c.tags.filter((t) => t !== tag) } : c
      ),
    })),

  setActiveClip: (id) => set({ activeClipId: id }),

  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false, activeClipId: null }),
  togglePanel: () =>
    set((s) => ({
      isPanelOpen: !s.isPanelOpen,
      activeClipId: s.isPanelOpen ? null : s.activeClipId,
    })),

  setSortMode: (mode) => set({ sortMode: mode }),
  setFilterSource: (source) => set({ filterSource: source }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  reset: () =>
    set({
      clips: [],
      activeClipId: null,
      isPanelOpen: false,
      sortMode: 'newest',
      filterSource: 'all',
      searchQuery: '',
    }),

  moveToNotebook: (noteId, notebookId) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === noteId ? { ...c, notebookId } : c)),
    })),

  pinToChat: (noteId, chatId) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === noteId ? { ...c, pinnedToChatId: chatId } : c)),
    })),

  unpinFromChat: (noteId) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === noteId ? { ...c, pinnedToChatId: null } : c)),
    })),

  createClipFromPage: (text, source) => {
    const clip: EvidenceClip = {
      id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      quote: text,
      sourceType: 'web',
      sourceLabel: source,
      interpretation: '',
      tags: [],
      createdAt: new Date().toISOString(),
      isPinned: false,
      notebookId: null,
      pinnedToChatId: null,
    }
    set((s) => ({ clips: [clip, ...s.clips] }))
  },
}))

// ─── Utility helpers ──────────────────────────────────────────────────────

/** Create a new clip with auto-generated ID and timestamp */
export function createClip(
  partial: Omit<
    EvidenceClip,
    'id' | 'createdAt' | 'isPinned' | 'tags' | 'notebookId' | 'pinnedToChatId'
  > &
    Partial<Pick<EvidenceClip, 'tags' | 'isPinned' | 'notebookId' | 'pinnedToChatId'>>
): EvidenceClip {
  return {
    id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    isPinned: false,
    tags: [],
    notebookId: null,
    pinnedToChatId: null,
    ...partial,
  }
}

/** Selector: loose clips (no notebook assigned) */
export function looseClips(clips: EvidenceClip[]): EvidenceClip[] {
  return clips.filter((c) => c.notebookId === null)
}

/** Selector: clips in a specific notebook */
export function notebookClips(clips: EvidenceClip[], notebookId: string): EvidenceClip[] {
  return clips.filter((c) => c.notebookId === notebookId)
}

/** Selector: clips pinned to a specific chat */
export function pinnedClips(clips: EvidenceClip[], chatId: string): EvidenceClip[] {
  return clips.filter((c) => c.pinnedToChatId === chatId)
}

/** Get filtered + sorted clips */
export function getProcessedClips(
  clips: EvidenceClip[],
  filterSource: ClipFilterSource,
  sortMode: ClipSortMode,
  searchQuery: string
): EvidenceClip[] {
  let result = [...clips]

  // Filter by source
  if (filterSource !== 'all') {
    result = result.filter((c) => c.sourceType === filterSource)
  }

  // Filter by search query
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase()
    result = result.filter(
      (c) =>
        c.quote.toLowerCase().includes(q) ||
        c.interpretation.toLowerCase().includes(q) ||
        c.sourceLabel.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
    )
  }

  // Sort
  switch (sortMode) {
    case 'newest':
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      break
    case 'oldest':
      result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      break
    case 'source':
      result.sort((a, b) => a.sourceType.localeCompare(b.sourceType))
      break
    case 'pinned':
      result.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
      break
  }

  return result
}

/** Source type display config */
export const SOURCE_TYPE_CONFIG: Record<
  ClipSourceType,
  { icon: string; label: string; color: string }
> = {
  document: { icon: '📄', label: 'Document', color: '#2563EB' },
  web: { icon: '🌐', label: 'Web', color: '#059669' },
  chat: { icon: '💬', label: 'Chat', color: '#7C3AED' },
  canvas: { icon: '🎨', label: 'Canvas', color: '#D97706' },
  extension: { icon: '🧩', label: 'Extension', color: '#DC2626' },
  import: { icon: '📥', label: 'Import', color: '#0891B2' },
  manual: { icon: '✍️', label: 'Manual', color: '#6B7280' },
}
