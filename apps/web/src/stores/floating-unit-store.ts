import { create } from 'zustand'

export type UnitVisualState = 'collapsed' | 'expanded' | 'dot'
export type UnitActiveMode = 'none' | 'web' | 'doc' | 'memory' | 'notes'

export interface AttachedSource {
  id: string
  type: 'file' | 'url'
  label: string
}

/** Default and bounds for the resizable chat panel height (in px) */
export const CHAT_PANEL_DEFAULT_HEIGHT = 480
export const CHAT_PANEL_MIN_HEIGHT = 320
export const CHAT_PANEL_MAX_HEIGHT_OFFSET = 80 // px from viewport top

interface FloatingUnitState {
  // Visual state
  unitState: UnitVisualState
  previousState: 'collapsed' | 'expanded'
  activeMode: UnitActiveMode

  // Chat state (document-scoped)
  activeChatId: string | null
  chatFileId: string | null

  // Chat panel height (resizable)
  chatPanelHeight: number

  // Whether the thread history sidebar is showing
  showThreadHistory: boolean

  // Attached sources
  attachedSources: AttachedSource[]

  // Web recording — toggle that keeps the unit persistent and records browsing
  isWebRecording: boolean
  webRecordingStartedAt: string | null

  // Chat persistence — thread persists across route changes
  chatThreadId: string | null
  chatHistory: Array<{ id: string; title: string; time: string; msgs: number; surface: string }>
  showHistory: boolean

  // Tab naming: chat | memory | notes
  activeTab: 'chat' | 'memory' | 'notes'

  // Pending input text (for when user types in collapsed bar then expands)
  pendingInput: string

  // Actions — visual state
  expand: () => void
  collapse: () => void
  minimize: () => void
  restore: () => void

  // Actions — mode
  setActiveMode: (mode: UnitActiveMode) => void

  // Actions — chat
  setActiveChatId: (id: string | null) => void
  setChatFileId: (fileId: string | null) => void

  // Actions — resize
  setChatPanelHeight: (h: number) => void

  // Actions — thread history
  setShowThreadHistory: (show: boolean) => void

  // Actions — sources
  addSource: (source: AttachedSource) => void
  removeSource: (id: string) => void

  // Actions — web recording
  toggleWebRecording: () => void
  setWebRecording: (enabled: boolean) => void

  // Actions — chat persistence
  setChatThreadId: (id: string | null) => void
  addChatHistory: (entry: { id: string; title: string; time: string; msgs: number; surface: string }) => void
  setShowHistory: (show: boolean) => void
  newChatThread: () => void

  // Actions — tab
  setActiveTab: (tab: 'chat' | 'memory' | 'notes') => void

  // Actions — input
  setPendingInput: (text: string) => void
}

export const useFloatingUnitStore = create<FloatingUnitState>((set) => ({
  unitState: 'collapsed',
  previousState: 'collapsed',
  activeMode: 'none',
  activeChatId: null,
  chatFileId: null,
  chatPanelHeight: CHAT_PANEL_DEFAULT_HEIGHT,
  showThreadHistory: false,
  attachedSources: [],
  isWebRecording: false,
  webRecordingStartedAt: null,
  chatThreadId: null,
  chatHistory: [],
  showHistory: false,
  activeTab: 'chat',
  pendingInput: '',

  expand: () =>
    set((s) => ({
      unitState: 'expanded',
      previousState: 'expanded',
      activeMode: s.activeMode === 'none' ? 'none' : s.activeMode,
    })),

  collapse: () =>
    set({
      unitState: 'collapsed',
      previousState: 'collapsed',
    }),

  minimize: () =>
    set((_s) => ({
      unitState: 'dot',
      // Keep previousState so restore knows where to go
    })),

  restore: () =>
    set((s) => ({
      unitState: s.previousState,
    })),

  setActiveMode: (mode) => set({ activeMode: mode }),

  setActiveChatId: (id) => set({ activeChatId: id }),

  setChatFileId: (fileId) =>
    set({
      chatFileId: fileId,
      // Reset chat when switching documents
      activeChatId: null,
    }),

  setChatPanelHeight: (h) => {
    const maxH = (typeof window !== 'undefined' ? window.innerHeight : 900) - CHAT_PANEL_MAX_HEIGHT_OFFSET
    set({ chatPanelHeight: Math.max(CHAT_PANEL_MIN_HEIGHT, Math.min(h, maxH)) })
  },

  setShowThreadHistory: (show) => set({ showThreadHistory: show }),

  addSource: (source) =>
    set((s) => {
      if (s.attachedSources.some((src) => src.id === source.id)) return s
      return { attachedSources: [...s.attachedSources, source] }
    }),

  removeSource: (id) =>
    set((s) => ({
      attachedSources: s.attachedSources.filter((src) => src.id !== id),
    })),

  toggleWebRecording: () =>
    set((s) => ({
      isWebRecording: !s.isWebRecording,
      webRecordingStartedAt: !s.isWebRecording ? new Date().toISOString() : null,
    })),

  setWebRecording: (enabled) =>
    set({
      isWebRecording: enabled,
      webRecordingStartedAt: enabled ? new Date().toISOString() : null,
    }),

  setChatThreadId: (id) => set({ chatThreadId: id }),

  addChatHistory: (entry) =>
    set((s) => ({ chatHistory: [entry, ...s.chatHistory].slice(0, 50) })),

  setShowHistory: (show) => set({ showHistory: show }),

  newChatThread: () =>
    set((s) => {
      // Save current thread to history if it has an ID
      const history = s.chatThreadId
        ? [
            {
              id: s.chatThreadId,
              title: 'Chat',
              time: new Date().toISOString(),
              msgs: 0,
              surface: 'web',
            },
            ...s.chatHistory,
          ].slice(0, 50)
        : s.chatHistory
      return {
        chatThreadId: crypto.randomUUID(),
        chatHistory: history,
        activeChatId: null,
      }
    }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setPendingInput: (text) => set({ pendingInput: text }),
}))
