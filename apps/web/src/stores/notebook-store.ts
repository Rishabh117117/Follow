import { create } from 'zustand'
import type {
  Notebook,
  NotebookBlock,
  NotebookTool,
  NotebookAction,
} from '@workspace/shared/types'

interface NotebookState {
  // Notebook data
  notebook: Notebook | null
  activePage: number // 1-indexed page number
  activeBlockId: string | null
  selectedBlockIds: string[]

  // Tool state
  activeTool: NotebookTool
  penColor: string
  penWidth: number
  highlighterColor: string
  eraserMode: 'stroke' | 'point'
  eraserRadius: number
  isDrawing: boolean
  activeShape: 'rectangle' | 'circle' | 'diamond' | 'line'
  thumbnailStripOpen: boolean
  provPanelOpen: boolean

  // View state
  zoom: number
  panOffset: { x: number; y: number }

  // Actions
  setNotebook: (notebook: Notebook) => void
  setActivePage: (page: number) => void
  setActiveBlock: (blockId: string | null) => void
  setSelectedBlocks: (blockIds: string[]) => void
  addBlock: (pageId: string, block: Partial<NotebookBlock>) => void
  updateBlock: (blockId: string, updates: Partial<NotebookBlock>) => void
  deleteBlock: (blockId: string) => void
  moveBlock: (blockId: string, x: number, y: number) => void
  resizeBlock: (blockId: string, width: number, height: number) => void
  reorderBlocks: (blockId: string, newZIndex: number) => void

  // Tool actions
  setActiveTool: (tool: NotebookTool) => void
  setPenColor: (color: string) => void
  setPenWidth: (width: number) => void
  setEraserMode: (mode: 'stroke' | 'point') => void
  setEraserRadius: (radius: number) => void
  setHighlighterColor: (color: string) => void
  setIsDrawing: (drawing: boolean) => void
  setActiveShape: (shape: 'rectangle' | 'circle' | 'diamond' | 'line') => void
  setThumbnailStripOpen: (open: boolean) => void
  setProvPanelOpen: (open: boolean) => void
  toggleProvPanel: () => void
  selectAllBlocks: () => void

  // Page actions
  addPage: (page: Notebook['pages'][number]) => void
  deletePage: (pageId: string) => void
  reorderPages: (fromIndex: number, toIndex: number) => void

  // View actions
  setZoom: (zoom: number) => void
  setPanOffset: (offset: { x: number; y: number }) => void

  // Undo/redo
  undoStack: NotebookAction[]
  redoStack: NotebookAction[]
  undo: () => void
  redo: () => void
  pushAction: (action: NotebookAction) => void
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  // Notebook data
  notebook: null,
  activePage: 1,
  activeBlockId: null,
  selectedBlockIds: [],

  // Tool state
  activeTool: 'select',
  penColor: '#000000',
  penWidth: 2,
  highlighterColor: '#FDE68A',
  eraserMode: 'stroke',
  eraserRadius: 12,
  isDrawing: false,
  activeShape: 'rectangle',
  thumbnailStripOpen: false,
  provPanelOpen: false,

  // View state
  zoom: 1,
  panOffset: { x: 0, y: 0 },

  // Undo/redo
  undoStack: [],
  redoStack: [],

  setNotebook: (notebook) => set({ notebook }),

  setActivePage: (page) => set({ activePage: page, activeBlockId: null, selectedBlockIds: [] }),

  setActiveBlock: (blockId) => set({ activeBlockId: blockId }),

  setSelectedBlocks: (blockIds) => set({ selectedBlockIds: blockIds }),

  addBlock: (pageId, block) => {
    const { notebook } = get()
    if (!notebook) return

    set({
      notebook: {
        ...notebook,
        pages: notebook.pages.map((p) =>
          p.id === pageId
            ? { ...p, blocks: [...p.blocks, block as NotebookBlock] }
            : p
        ),
      },
    })
  },

  updateBlock: (blockId, updates) => {
    const { notebook } = get()
    if (!notebook) return

    set({
      notebook: {
        ...notebook,
        pages: notebook.pages.map((p) => ({
          ...p,
          blocks: p.blocks.map((b) =>
            b.id === blockId ? { ...b, ...updates } : b
          ),
        })),
      },
    })
  },

  deleteBlock: (blockId) => {
    const { notebook } = get()
    if (!notebook) return

    set({
      notebook: {
        ...notebook,
        pages: notebook.pages.map((p) => ({
          ...p,
          blocks: p.blocks.filter((b) => b.id !== blockId),
        })),
      },
      activeBlockId: get().activeBlockId === blockId ? null : get().activeBlockId,
      selectedBlockIds: get().selectedBlockIds.filter((id) => id !== blockId),
    })
  },

  moveBlock: (blockId, x, y) => {
    get().updateBlock(blockId, { x, y })
  },

  resizeBlock: (blockId, width, height) => {
    get().updateBlock(blockId, { width, height })
  },

  reorderBlocks: (blockId, newZIndex) => {
    get().updateBlock(blockId, { zIndex: newZIndex })
  },

  // Tool actions
  setActiveTool: (tool) => set({ activeTool: tool }),
  setPenColor: (color) => set({ penColor: color }),
  setPenWidth: (width) => set({ penWidth: width }),
  setEraserMode: (mode) => set({ eraserMode: mode }),
  setEraserRadius: (radius) => set({ eraserRadius: Math.max(4, Math.min(24, radius)) }),
  setHighlighterColor: (color) => set({ highlighterColor: color }),
  setIsDrawing: (drawing) => set({ isDrawing: drawing }),
  setActiveShape: (shape) => set({ activeShape: shape }),
  setThumbnailStripOpen: (open) => set({ thumbnailStripOpen: open }),
  setProvPanelOpen: (open) => set({ provPanelOpen: open }),
  toggleProvPanel: () => set((s) => ({ provPanelOpen: !s.provPanelOpen })),
  selectAllBlocks: () => {
    const { notebook, activePage } = get()
    if (!notebook) return
    const page = notebook.pages.find((p) => p.pageNumber === activePage)
    if (page) {
      set({ selectedBlockIds: page.blocks.map((b) => b.id) })
    }
  },

  // Page actions
  addPage: (page) => {
    const { notebook } = get()
    if (!notebook) return

    set({
      notebook: {
        ...notebook,
        pages: [...notebook.pages, page],
        pageCount: notebook.pageCount + 1,
      },
    })
  },

  deletePage: (pageId) => {
    const { notebook, activePage } = get()
    if (!notebook || notebook.pages.length <= 1) return

    const newPages = notebook.pages
      .filter((p) => p.id !== pageId)
      .map((p, i) => ({ ...p, pageNumber: i + 1 }))

    set({
      notebook: {
        ...notebook,
        pages: newPages,
        pageCount: newPages.length,
      },
      activePage: Math.min(activePage, newPages.length),
    })
  },

  reorderPages: (fromIndex, toIndex) => {
    const { notebook } = get()
    if (!notebook) return

    const pages = [...notebook.pages]
    const [moved] = pages.splice(fromIndex, 1)
    pages.splice(toIndex, 0, moved!)
    const reordered = pages.map((p, i) => ({ ...p, pageNumber: i + 1 }))

    set({
      notebook: {
        ...notebook,
        pages: reordered,
      },
    })
  },

  // View actions
  setZoom: (zoom) => set({ zoom: Math.min(3, Math.max(0.25, zoom)) }),
  setPanOffset: (offset) => set({ panOffset: offset }),

  // Undo/redo
  pushAction: (action) => {
    set((state) => ({
      undoStack: [...state.undoStack.slice(-49), action],
      redoStack: [],
    }))
  },

  undo: () => {
    const { undoStack, notebook } = get()
    if (undoStack.length === 0 || !notebook) return

    const action = undoStack[undoStack.length - 1]!
    const newUndoStack = undoStack.slice(0, -1)

    // Apply reverse
    if (action.type === 'add' && action.after) {
      get().deleteBlock(action.blockId)
    } else if (action.type === 'delete' && action.before) {
      const page = notebook.pages.find((p) =>
        p.id === (action.before as NotebookBlock)?.pageId
      )
      if (page) get().addBlock(page.id, action.before as NotebookBlock)
    } else if ((action.type === 'update' || action.type === 'move' || action.type === 'resize') && action.before) {
      get().updateBlock(action.blockId, action.before)
    }

    set((state) => ({
      undoStack: newUndoStack,
      redoStack: [...state.redoStack, action],
    }))
  },

  redo: () => {
    const { redoStack, notebook } = get()
    if (redoStack.length === 0 || !notebook) return

    const action = redoStack[redoStack.length - 1]!
    const newRedoStack = redoStack.slice(0, -1)

    // Apply forward
    if (action.type === 'add' && action.after) {
      const page = notebook.pages.find((p) =>
        p.id === (action.after as NotebookBlock)?.pageId
      )
      if (page) get().addBlock(page.id, action.after as NotebookBlock)
    } else if (action.type === 'delete') {
      get().deleteBlock(action.blockId)
    } else if ((action.type === 'update' || action.type === 'move' || action.type === 'resize') && action.after) {
      get().updateBlock(action.blockId, action.after)
    }

    set((state) => ({
      redoStack: newRedoStack,
      undoStack: [...state.undoStack, action],
    }))
  },
}))
