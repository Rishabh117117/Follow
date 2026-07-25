import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type EditorMode = 'canvas' | 'focus'
export type RightPanelTab = 'props' | 'prov' | 'notes' | 'memory' | 'patterns'
export type ProvSubTab = 'history' | 'meaning' | 'versions'

interface EditorLayoutState {
  editorMode: EditorMode
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  rightPanelTab: RightPanelTab
  provSubTab: ProvSubTab

  setEditorMode: (mode: EditorMode) => void
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
  setLeftPanelOpen: (open: boolean) => void
  setRightPanelOpen: (open: boolean) => void
  setRightPanelTab: (tab: RightPanelTab) => void
  setProvSubTab: (tab: ProvSubTab) => void
}

export const useEditorLayoutStore = create<EditorLayoutState>()(
  persist(
    (set) => ({
      editorMode: 'canvas',
      leftPanelOpen: true,
      rightPanelOpen: true,
      rightPanelTab: 'props',
      provSubTab: 'history',

      setEditorMode: (mode) => set({ editorMode: mode }),
      toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setLeftPanelOpen: (open) => set({ leftPanelOpen: open }),
      setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
      setProvSubTab: (tab) => set({ provSubTab: tab }),
    }),
    {
      name: 'follow-editor-layout',
      partialize: (state) => ({ editorMode: state.editorMode }),
    }
  )
)
