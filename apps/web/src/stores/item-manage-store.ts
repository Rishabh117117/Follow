/**
 * Item Manage Store (Sprint CTX-1)
 *
 * Client-side state for selecting, hiding, adding, and removing items
 * from the active index.
 */
import { create } from 'zustand'

export type AddStep = 'choose' | 'paste' | 'chat-import' | 'gdrive' | 'uploading' | 'done'

export interface ConfirmDialogState {
  id: string
  name: string
}

export interface ItemManageState {
  selectMode: boolean
  selectedIds: string[]
  showHidden: boolean
  addPanelOpen: boolean
  addStep: AddStep
  confirmDialog: ConfirmDialogState | null

  toggleSelectMode: () => void
  toggleSelected: (id: string) => void
  selectAll: (ids: string[]) => void
  clearSelection: () => void
  toggleShowHidden: () => void
  openAddPanel: () => void
  closeAddPanel: () => void
  setAddStep: (step: AddStep) => void
  openConfirmDialog: (id: string, name: string) => void
  closeConfirmDialog: () => void
}

export const useItemManageStore = create<ItemManageState>((set) => ({
  selectMode: false,
  selectedIds: [],
  showHidden: false,
  addPanelOpen: false,
  addStep: 'choose',
  confirmDialog: null,

  toggleSelectMode: () =>
    set((state) => ({
      selectMode: !state.selectMode,
      selectedIds: state.selectMode ? [] : state.selectedIds,
    })),

  toggleSelected: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((x) => x !== id)
        : [...state.selectedIds, id],
    })),

  selectAll: (ids) => set({ selectedIds: [...ids] }),
  clearSelection: () => set({ selectedIds: [] }),
  toggleShowHidden: () => set((state) => ({ showHidden: !state.showHidden })),
  openAddPanel: () => set({ addPanelOpen: true, addStep: 'choose' }),
  closeAddPanel: () => set({ addPanelOpen: false, addStep: 'choose' }),
  setAddStep: (step) => set({ addStep: step }),
  openConfirmDialog: (id, name) => set({ confirmDialog: { id, name } }),
  closeConfirmDialog: () => set({ confirmDialog: null }),
}))
