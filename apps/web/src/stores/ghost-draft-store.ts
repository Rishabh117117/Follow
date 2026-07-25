import { create } from 'zustand'

export type GhostDraftState = 'preview' | 'edited' | 'moved' | 'committed' | 'dismissed'

export interface GhostDraftData {
  id: string
  content: string
  anchorBlockId: string
  sourcePrompt: string
  threadId: string
  state: GhostDraftState
  createdAt: string
  editedContent?: string
  // Notebook-specific anchor fields
  notebookBlockId?: string
  notebookPageId?: string
  insertPosition?: 'inside' | 'below'
}

interface GhostDraftStore {
  /** All active ghost drafts by ID */
  ghostDrafts: Map<string, GhostDraftData>
  /** Currently focused ghost */
  activeGhostId: string | null
  /** Whether user is repositioning a ghost */
  moveMode: boolean
  /** Ghost being moved */
  movingGhostId: string | null

  // Actions
  createGhost: (data: Omit<GhostDraftData, 'id' | 'state' | 'createdAt'>) => string
  updateGhostContent: (id: string, content: string) => void
  commitGhost: (id: string) => void
  dismissGhost: (id: string) => void
  enterMoveMode: (id: string) => void
  exitMoveMode: () => void
  relocateGhost: (id: string, newAnchorBlockId: string) => void
  regenerateGhost: (id: string) => void
  setActiveGhost: (id: string | null) => void
  reset: () => void
}

let ghostCounter = 0

export const useGhostDraftStore = create<GhostDraftStore>((set, get) => ({
  ghostDrafts: new Map(),
  activeGhostId: null,
  moveMode: false,
  movingGhostId: null,

  createGhost: (data) => {
    const state = get()

    // Max 3 active ghosts per document
    if (state.ghostDrafts.size >= 3) {
      window.dispatchEvent(
        new CustomEvent('follow-toast', {
          detail: { message: 'Commit or dismiss an existing preview first', type: 'warning' },
        })
      )
      return ''
    }

    // Same-anchor replacement: if a ghost already targets the same anchor, replace it
    let replacedId: string | null = null
    for (const [existingId, existingGhost] of state.ghostDrafts) {
      if (existingGhost.anchorBlockId === data.anchorBlockId) {
        replacedId = existingId
        break
      }
    }

    const id = `ghost-${Date.now()}-${++ghostCounter}`
    const ghost: GhostDraftData = {
      ...data,
      id,
      state: 'preview',
      createdAt: new Date().toISOString(),
    }
    set((s) => {
      const next = new Map(s.ghostDrafts)
      if (replacedId) next.delete(replacedId)
      next.set(id, ghost)
      return { ghostDrafts: next, activeGhostId: id }
    })
    return id
  },

  updateGhostContent: (id, content) => {
    set((s) => {
      const ghost = s.ghostDrafts.get(id)
      if (!ghost) return s
      const next = new Map(s.ghostDrafts)
      next.set(id, { ...ghost, editedContent: content, state: 'edited' })
      return { ghostDrafts: next }
    })
  },

  commitGhost: (id) => {
    set((s) => {
      const ghost = s.ghostDrafts.get(id)
      if (!ghost) return s
      const next = new Map(s.ghostDrafts)
      next.set(id, { ...ghost, state: 'committed' })
      return { ghostDrafts: next }
    })
  },

  dismissGhost: (id) => {
    set((s) => {
      const next = new Map(s.ghostDrafts)
      next.delete(id)
      return {
        ghostDrafts: next,
        activeGhostId: s.activeGhostId === id ? null : s.activeGhostId,
      }
    })
  },

  enterMoveMode: (id) => {
    set({ moveMode: true, movingGhostId: id })
  },

  exitMoveMode: () => {
    set({ moveMode: false, movingGhostId: null })
  },

  relocateGhost: (id, newAnchorBlockId) => {
    set((s) => {
      const ghost = s.ghostDrafts.get(id)
      if (!ghost) return s
      const next = new Map(s.ghostDrafts)
      next.set(id, { ...ghost, anchorBlockId: newAnchorBlockId, state: 'moved' })
      return { ghostDrafts: next, moveMode: false, movingGhostId: null }
    })
  },

  regenerateGhost: (id) => {
    const ghost = get().ghostDrafts.get(id)
    if (!ghost) return
    // Mark as pending regeneration — the caller is responsible for
    // triggering a new AI call and updating the content via updateGhostContent
    set((s) => {
      const next = new Map(s.ghostDrafts)
      next.set(id, { ...ghost, state: 'preview', editedContent: undefined })
      return { ghostDrafts: next }
    })
  },

  setActiveGhost: (id) => {
    set({ activeGhostId: id })
  },

  reset: () => {
    set({
      ghostDrafts: new Map(),
      activeGhostId: null,
      moveMode: false,
      movingGhostId: null,
    })
  },
}))
