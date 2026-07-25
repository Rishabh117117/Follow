/**
 * Port of apps/web/src/stores/floating-unit-store.ts
 * Adapted for Chrome Extension context (no TipTap editor references).
 * EXT-2: Added chat persistence, context bar state, and hybrid notes.
 */

import { create } from 'zustand'

export type PanelState = 'dot' | 'collapsed' | 'expanded'
export type ActiveMode = 'chat' | 'memory' | 'notes'

export interface AttachedSource {
  id: string
  type: 'file' | 'url'
  label: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface ChatThread {
  id: string
  title: string
  time: string
  msgCount: number
}

export interface PinnedItem {
  id: string
  type: 'file' | 'fact' | 'conversation'
  name: string
  source: string
}

export interface NoteClip {
  id: string
  text: string
  source: string
  time: string
  notebookId: string | null
  pinnedToChatId: string | null
}

export const CHAT_PANEL_DEFAULT_HEIGHT = 480
export const CHAT_PANEL_MIN_HEIGHT = 320
export const CHAT_PANEL_MAX_HEIGHT_OFFSET = 80

interface FloatingUnitStore {
  // Visual state
  panelState: PanelState
  previousState: 'collapsed' | 'expanded'
  activeMode: ActiveMode

  // Chat
  currentConversationId: string | null
  currentConversationTitle: string | null
  isStreaming: boolean

  // Chat persistence (EXT-2)
  chatThreadId: string | null
  chatMessages: ChatMessage[]
  chatHistory: ChatThread[]
  showHistory: boolean

  // Context bar (EXT-2)
  chatScope: 'all' | 'doc' | 'pinned'
  followWeb: boolean
  seeing: string[]
  pinnedItems: PinnedItem[]
  contextExpanded: boolean

  // Hybrid notes (EXT-2)
  noteClips: NoteClip[]

  // Resize
  expandedHeight: number

  // Thread history drawer
  threadDrawerOpen: boolean

  // Attached sources
  attachedSources: AttachedSource[]

  // Input
  pendingInput: string

  // Actions — visual state
  setPanelState: (state: PanelState) => void
  togglePanel: () => void
  expand: () => void
  collapse: () => void
  minimize: () => void
  restore: () => void

  // Actions — mode
  setActiveMode: (mode: ActiveMode) => void

  // Actions — chat
  setConversation: (id: string | null, title: string | null) => void
  setStreaming: (streaming: boolean) => void

  // Actions — chat persistence (EXT-2)
  setChatThreadId: (id: string | null) => void
  addChatMessage: (msg: ChatMessage) => void
  clearChatMessages: () => void
  newChatThread: () => void
  setShowHistory: (show: boolean) => void

  // Actions — context bar (EXT-2)
  setChatScope: (scope: 'all' | 'doc' | 'pinned') => void
  toggleFollowWeb: () => void
  setSeeing: (items: string[]) => void
  pinItem: (item: PinnedItem) => void
  unpinItem: (id: string) => void
  toggleContextExpanded: () => void

  // Actions — hybrid notes (EXT-2)
  addNoteClip: (clip: NoteClip) => void
  moveClipToNotebook: (clipId: string, notebookId: string) => void
  pinClipToChat: (clipId: string, chatId: string) => void

  // Actions — resize
  setExpandedHeight: (height: number) => void

  // Actions — thread history
  toggleThreadDrawer: () => void
  setThreadDrawerOpen: (open: boolean) => void

  // Actions — sources
  addSource: (source: AttachedSource) => void
  removeSource: (id: string) => void

  // Actions — input
  setPendingInput: (text: string) => void
}

export const useFloatingUnitStore = create<FloatingUnitStore>((set) => ({
  panelState: 'dot',
  previousState: 'collapsed',
  activeMode: 'chat',
  currentConversationId: null,
  currentConversationTitle: null,
  isStreaming: false,
  chatThreadId: null,
  chatMessages: [],
  chatHistory: [],
  showHistory: false,
  chatScope: 'all',
  followWeb: false,
  seeing: [],
  pinnedItems: [],
  contextExpanded: false,
  noteClips: [],
  expandedHeight: CHAT_PANEL_DEFAULT_HEIGHT,
  threadDrawerOpen: false,
  attachedSources: [],
  pendingInput: '',

  setPanelState: (state) =>
    set((s) => ({
      panelState: state,
      previousState: state === 'dot' ? s.previousState : state === 'expanded' ? 'expanded' : 'collapsed',
    })),

  togglePanel: () =>
    set((s) => {
      if (s.panelState === 'dot') return { panelState: s.previousState }
      if (s.panelState === 'collapsed') return { panelState: 'expanded', previousState: 'expanded' }
      if (s.panelState === 'expanded') return { panelState: 'dot' }
      return {}
    }),

  expand: () => set({ panelState: 'expanded', previousState: 'expanded' }),
  collapse: () => set({ panelState: 'collapsed', previousState: 'collapsed' }),
  minimize: () => set({ panelState: 'dot' }),
  restore: () => set((s) => ({ panelState: s.previousState })),

  setActiveMode: (mode) => set({ activeMode: mode }),

  setConversation: (id, title) =>
    set({ currentConversationId: id, currentConversationTitle: title }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  // Chat persistence
  setChatThreadId: (id) => set({ chatThreadId: id }),

  addChatMessage: (msg) =>
    set((s) => ({
      chatMessages: [...s.chatMessages, msg].slice(-100),
    })),

  clearChatMessages: () => set({ chatMessages: [] }),

  newChatThread: () =>
    set((s) => {
      const history = s.chatThreadId
        ? [
            { id: s.chatThreadId, title: 'Chat', time: new Date().toISOString(), msgCount: s.chatMessages.length },
            ...s.chatHistory,
          ].slice(0, 50)
        : s.chatHistory
      return {
        chatThreadId: `thread-${Date.now()}`,
        chatMessages: [],
        chatHistory: history,
        currentConversationId: null,
      }
    }),

  setShowHistory: (show) => set({ showHistory: show }),

  // Context bar
  setChatScope: (scope) => set({ chatScope: scope }),
  toggleFollowWeb: () => set((s) => ({ followWeb: !s.followWeb })),
  setSeeing: (items) => set({ seeing: items }),
  pinItem: (item) =>
    set((s) => ({
      pinnedItems: s.pinnedItems.some((p) => p.id === item.id)
        ? s.pinnedItems
        : [...s.pinnedItems, item],
    })),
  unpinItem: (id) =>
    set((s) => ({ pinnedItems: s.pinnedItems.filter((p) => p.id !== id) })),
  toggleContextExpanded: () => set((s) => ({ contextExpanded: !s.contextExpanded })),

  // Hybrid notes
  addNoteClip: (clip) => set((s) => ({ noteClips: [clip, ...s.noteClips] })),
  moveClipToNotebook: (clipId, notebookId) =>
    set((s) => ({
      noteClips: s.noteClips.map((c) => (c.id === clipId ? { ...c, notebookId } : c)),
    })),
  pinClipToChat: (clipId, chatId) =>
    set((s) => ({
      noteClips: s.noteClips.map((c) => (c.id === clipId ? { ...c, pinnedToChatId: chatId } : c)),
    })),

  // Resize
  setExpandedHeight: (height) => {
    const maxH = (typeof window !== 'undefined' ? window.innerHeight : 900) - CHAT_PANEL_MAX_HEIGHT_OFFSET
    set({ expandedHeight: Math.max(CHAT_PANEL_MIN_HEIGHT, Math.min(height, maxH)) })
  },

  toggleThreadDrawer: () => set((s) => ({ threadDrawerOpen: !s.threadDrawerOpen })),
  setThreadDrawerOpen: (open) => set({ threadDrawerOpen: open }),

  addSource: (source) =>
    set((s) => {
      if (s.attachedSources.some((src) => src.id === source.id)) return s
      return { attachedSources: [...s.attachedSources, source] }
    }),

  removeSource: (id) =>
    set((s) => ({
      attachedSources: s.attachedSources.filter((src) => src.id !== id),
    })),

  setPendingInput: (text) => set({ pendingInput: text }),
}))
