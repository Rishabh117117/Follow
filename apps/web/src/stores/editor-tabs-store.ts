import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface EditorTab {
  id: string
  label: string
  fileId?: string
}

interface EditorTabsState {
  tabs: EditorTab[]
  activeTabIndex: number
  addTab: (label: string, fileId?: string) => void
  removeTab: (index: number) => void
  setActiveTab: (index: number) => void
  renameTab: (index: number, label: string) => void
  setTabs: (tabs: EditorTab[]) => void
  reset: () => void
}

let tabCounter = 0

function makeId() {
  tabCounter += 1
  return `tab-${Date.now()}-${tabCounter}`
}

const DEFAULT_TABS: EditorTab[] = [{ id: 'tab-default', label: 'Document' }]

export const useEditorTabsStore = create<EditorTabsState>()(
  persist(
    (set, get) => ({
      tabs: DEFAULT_TABS,
      activeTabIndex: 0,

      addTab: (label, fileId) => {
        const tab: EditorTab = { id: makeId(), label, fileId }
        set((s) => ({
          tabs: [...s.tabs, tab],
          activeTabIndex: s.tabs.length, // activate new tab
        }))
      },

      removeTab: (index) => {
        const { tabs, activeTabIndex } = get()
        if (tabs.length <= 1) return // keep at least one tab

        const newTabs = tabs.filter((_, i) => i !== index)
        let newActive = activeTabIndex
        if (index === activeTabIndex) {
          // Removing active: go to previous or stay at 0
          newActive = Math.max(0, index - 1)
        } else if (index < activeTabIndex) {
          newActive = activeTabIndex - 1
        }
        set({ tabs: newTabs, activeTabIndex: Math.min(newActive, newTabs.length - 1) })
      },

      setActiveTab: (index) => {
        const { tabs } = get()
        if (index >= 0 && index < tabs.length) {
          set({ activeTabIndex: index })
        }
      },

      renameTab: (index, label) => {
        set((s) => ({
          tabs: s.tabs.map((t, i) => (i === index ? { ...t, label } : t)),
        }))
      },

      setTabs: (tabs) => {
        set((s) => ({
          tabs,
          activeTabIndex: Math.min(s.activeTabIndex, tabs.length - 1),
        }))
      },

      reset: () => set({ tabs: DEFAULT_TABS, activeTabIndex: 0 }),
    }),
    {
      name: 'follow-editor-tabs',
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabIndex: state.activeTabIndex,
      }),
    }
  )
)
