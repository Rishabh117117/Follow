/**
 * Port of apps/web/src/stores/floating-unit-store.ts
 * Adapted for Chrome Extension context (no TipTap editor references).
 */

import { create } from 'zustand'

export type PanelState = 'dot' | 'collapsed' | 'expanded'
export type ActiveMode = 'chat' | 'prov' | 'notes'

export interface AttachedSource {
  id: string
  type: 'file' | 'url'
  label: string
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

  expand: () =>
    set({
      panelState: 'expanded',
      previousState: 'expanded',
    }),

  collapse: () =>
    set({
      panelState: 'collapsed',
      previousState: 'collapsed',
    }),

  minimize: () => set({ panelState: 'dot' }),

  restore: () =>
    set((s) => ({
      panelState: s.previousState,
    })),

  setActiveMode: (mode) => set({ activeMode: mode }),

  setConversation: (id, title) =>
    set({
      currentConversationId: id,
      currentConversationTitle: title,
    }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

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
