/**
 * Overlay state store — manages ghost drafts, revisions, doc intel marks,
 * preview cards, and selection state for all document overlays.
 */

import { create } from 'zustand'

// ─── Types ───────────────────────────────────────────────────────────────

export interface GhostDraft {
  id: string
  anchorIndex: number          // Paragraph index this ghost sits after
  content: string              // AI-generated text
  status: 'streaming' | 'ready' | 'editing'
  conversationId: string       // Chat conversation that generated this
}

export interface HighlightRevision {
  id: string
  originalText: string
  proposedText: string
  selectionBounds: DOMRect | null
  type: 'rewrite' | 'shorten' | 'strengthen' | 'tone' | 'grammar'
  wordDelta: number
  status: 'pending' | 'ready'
}

export interface ChatDraft {
  id: string
  googleDocId: string
  action: 'replace' | 'insert' | 'append'
  findText: string | null
  summary: string              // One-line description for toolbar badge
  versions: string[]           // Array of newText alternatives
  activeVersion: number        // Index into versions[]
  status: 'inserting' | 'ready' | 'committing' | 'discarding'
  startIndex: number           // Google Docs API start index of inserted text
  endIndex: number             // Google Docs API end index of inserted text
}

export type DocIntelType = 'clarity' | 'conciseness' | 'tone' | 'grammar' | 'structure'

export interface PendingAnnotation {
  id: string
  spanText: string
  insight: string
  category: string
  rating: number | null
  status: 'pending' | 'highlighted' | 'dismissed'
}

export interface DocIntelMark {
  id: string
  type: DocIntelType
  startPara: number
  startChar: number
  endPara: number
  endChar: number
  suggestion: string
  replacement: string
  rects: DOMRect[]
  dimmed: boolean
}

// ─── Store Interface ─────────────────────────────────────────────────────

interface OverlayState {
  // Ghost Drafts
  ghostDrafts: GhostDraft[]
  addGhostDraft: (draft: Omit<GhostDraft, 'id'>) => void
  updateGhostDraft: (id: string, updates: Partial<GhostDraft>) => void
  removeGhostDraft: (id: string) => void
  commitGhostDraft: (id: string) => void

  // Chat Drafts (preview → commit flow from chat edits)
  chatDrafts: ChatDraft[]
  addChatDraft: (draft: Omit<ChatDraft, 'id'>) => void
  addChatDraftVersion: (id: string, newText: string) => void
  setChatDraftVersion: (id: string, index: number) => void
  commitChatDraft: (id: string) => void
  removeChatDraft: (id: string) => void

  // Highlight Revisions
  revisions: HighlightRevision[]
  addRevision: (rev: Omit<HighlightRevision, 'id'>) => void
  acceptRevision: (id: string) => void
  rejectRevision: (id: string) => void
  removeRevision: (id: string) => void

  // Doc Intelligence Marks
  marks: DocIntelMark[]
  setMarks: (marks: DocIntelMark[]) => void
  clearMarks: () => void
  activeFilter: string
  setFilter: (filter: string) => void
  hoveredMarkId: string | null
  setHoveredMark: (id: string | null) => void

  // Pending Annotations (preview before applying)
  pendingAnnotations: PendingAnnotation[]
  activeAnnotationIndex: number
  setPendingAnnotations: (annotations: PendingAnnotation[]) => void
  updateAnnotationStatus: (id: string, status: PendingAnnotation['status']) => void
  removeAnnotation: (id: string) => void
  clearAnnotations: () => void
  setActiveAnnotationIndex: (index: number) => void

  // Selection state (from dom-bridge)
  selectedText: string | null
  selectionBounds: DOMRect | null
  setSelection: (text: string | null, bounds: DOMRect | null) => void

  // Selection menu visibility
  showSelectionMenu: boolean
  setSelectionMenu: (show: boolean) => void

  // Preview card
  activePreviewCardId: string | null
  setActivePreviewCard: (id: string | null) => void

  // Settle animations (committed ghost drafts / accepted revisions)
  settleAnchors: { id: string; paragraphIndex: number; expiresAt: number }[]
  addSettleAnchor: (paragraphIndex: number) => void
  clearExpiredSettles: () => void

  // E-1.3: Live collaborators (from CollaboratorTracker)
  collaborators: string[]
  setCollaborators: (names: string[]) => void

  // E-2: Insertion failure toast
  insertionToast: { id: string; content: string; message: string } | null
  showInsertionToast: (content: string, message?: string) => void
  dismissInsertionToast: () => void
}

// ─── Store Implementation ────────────────────────────────────────────────

let nextId = 1
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${nextId++}`
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  // ── Ghost Drafts ──

  ghostDrafts: [],

  addGhostDraft: (draft) =>
    set((s) => {
      // Same-anchor replacement: remove existing ghost at same anchor
      const filtered = s.ghostDrafts.filter((d) => d.anchorIndex !== draft.anchorIndex)
      // Max 3 active ghosts
      const trimmed = filtered.length >= 3 ? filtered.slice(1) : filtered
      return {
        ghostDrafts: [...trimmed, { ...draft, id: genId('ghost') }],
      }
    }),

  updateGhostDraft: (id, updates) =>
    set((s) => ({
      ghostDrafts: s.ghostDrafts.map((d) => (d.id === id ? { ...d, ...updates } : d)),
    })),

  removeGhostDraft: (id) =>
    set((s) => ({
      ghostDrafts: s.ghostDrafts.filter((d) => d.id !== id),
    })),

  commitGhostDraft: (id) => {
    const draft = get().ghostDrafts.find((d) => d.id === id)
    if (draft) {
      get().addSettleAnchor(draft.anchorIndex)
      set((s) => ({
        ghostDrafts: s.ghostDrafts.filter((d) => d.id !== id),
      }))
    }
  },

  // ── Chat Drafts ──

  chatDrafts: [],

  addChatDraft: (draft) =>
    set((s) => ({
      // Max 1 active chat draft — replace any existing
      chatDrafts: [{ ...draft, id: genId('chatdraft') }],
    })),

  addChatDraftVersion: (id, newText) =>
    set((s) => ({
      chatDrafts: s.chatDrafts.map((d) =>
        d.id === id
          ? { ...d, versions: [...d.versions, newText], activeVersion: d.versions.length }
          : d
      ),
    })),

  setChatDraftVersion: (id, index) =>
    set((s) => ({
      chatDrafts: s.chatDrafts.map((d) =>
        d.id === id ? { ...d, activeVersion: index } : d
      ),
    })),

  commitChatDraft: (id) => {
    set((s) => ({
      chatDrafts: s.chatDrafts.filter((d) => d.id !== id),
    }))
  },

  removeChatDraft: (id) =>
    set((s) => ({
      chatDrafts: s.chatDrafts.filter((d) => d.id !== id),
    })),

  // ── Highlight Revisions ──

  revisions: [],

  addRevision: (rev) =>
    set((s) => ({
      revisions: [...s.revisions, { ...rev, id: genId('rev') }],
    })),

  acceptRevision: (id) => {
    const rev = get().revisions.find((r) => r.id === id)
    if (rev?.selectionBounds) {
      const paras = document.querySelectorAll('.kix-paragraphrenderer')
      let paraIdx = 0
      for (let i = 0; i < paras.length; i++) {
        const r = paras[i].getBoundingClientRect()
        if (r.top <= (rev.selectionBounds?.top ?? 0) && r.bottom >= (rev.selectionBounds?.top ?? 0)) {
          paraIdx = i
          break
        }
      }
      get().addSettleAnchor(paraIdx)
    }
    set((s) => ({
      revisions: s.revisions.filter((r) => r.id !== id),
    }))
  },

  rejectRevision: (id) =>
    set((s) => ({
      revisions: s.revisions.filter((r) => r.id !== id),
    })),

  removeRevision: (id) =>
    set((s) => ({
      revisions: s.revisions.filter((r) => r.id !== id),
    })),

  // ── Doc Intelligence Marks ──

  marks: [],
  setMarks: (marks) => set({ marks }),
  clearMarks: () => set({ marks: [], hoveredMarkId: null, activeFilter: 'all' }),
  activeFilter: 'all',
  setFilter: (filter) =>
    set((s) => ({
      activeFilter: filter,
      marks: s.marks.map((m) => ({
        ...m,
        dimmed: filter !== 'all' && m.type !== filter,
      })),
    })),
  hoveredMarkId: null,
  setHoveredMark: (id) => set({ hoveredMarkId: id }),

  // ── Pending Annotations ──

  pendingAnnotations: [],
  activeAnnotationIndex: 0,
  setPendingAnnotations: (annotations) => set({ pendingAnnotations: annotations, activeAnnotationIndex: 0 }),
  updateAnnotationStatus: (id, status) =>
    set((s) => ({
      pendingAnnotations: s.pendingAnnotations.map((a) =>
        a.id === id ? { ...a, status } : a
      ),
    })),
  removeAnnotation: (id) =>
    set((s) => {
      const filtered = s.pendingAnnotations.filter((a) => a.id !== id)
      return {
        pendingAnnotations: filtered,
        activeAnnotationIndex: Math.min(s.activeAnnotationIndex, Math.max(0, filtered.length - 1)),
      }
    }),
  clearAnnotations: () => set({ pendingAnnotations: [], activeAnnotationIndex: 0 }),
  setActiveAnnotationIndex: (index) => set({ activeAnnotationIndex: index }),

  // ── Selection ──

  selectedText: null,
  selectionBounds: null,
  setSelection: (text, bounds) =>
    set({
      selectedText: text,
      selectionBounds: bounds,
      // Show menu when: text > 3 chars with bounds, OR bounds exist in canvas mode (text pending copy)
      showSelectionMenu: !!(bounds && ((text && text.length > 3) || (!text && bounds.width > 10))),
    }),

  showSelectionMenu: false,
  setSelectionMenu: (show) => set({ showSelectionMenu: show }),

  // ── Preview Card ──

  activePreviewCardId: null,
  setActivePreviewCard: (id) => set({ activePreviewCardId: id }),

  // ── Settle Animations ──

  settleAnchors: [],
  addSettleAnchor: (paragraphIndex) =>
    set((s) => ({
      settleAnchors: [
        ...s.settleAnchors,
        { id: genId('settle'), paragraphIndex, expiresAt: Date.now() + 3000 },
      ],
    })),
  clearExpiredSettles: () =>
    set((s) => ({
      settleAnchors: s.settleAnchors.filter((a) => a.expiresAt > Date.now()),
    })),

  // ── Collaborators ──

  collaborators: [],
  setCollaborators: (names) => set({ collaborators: names }),

  // ── Insertion toast ──

  insertionToast: null,
  showInsertionToast: (content, message = "Couldn't insert text automatically") =>
    set({ insertionToast: { id: genId('toast'), content, message } }),
  dismissInsertionToast: () => set({ insertionToast: null }),
}))
