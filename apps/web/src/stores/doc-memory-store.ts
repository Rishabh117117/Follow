import { create } from 'zustand'
import { api } from '@/lib/api-client'
import type {
  DocumentInterpretation,
  DocumentPattern,
  DocumentDecisionTrail,
  DocumentMemory,
} from '@workspace/shared/types'

interface DocMemoryState {
  // Data
  interpretation: DocumentInterpretation | null
  patterns: DocumentPattern[]
  decisionTrails: DocumentDecisionTrail[]

  // UI state
  activeTab: 'history' | 'meaning'
  expandedTensionId: string | null
  expandedDecisionRef: string | null
  showAllPatterns: boolean
  isLoading: boolean
  lastFetchedFileId: string | null

  // Actions
  setActiveTab: (tab: 'history' | 'meaning') => void
  setInterpretation: (interp: DocumentInterpretation | null) => void
  setPatterns: (patterns: DocumentPattern[]) => void
  setDecisionTrails: (trails: DocumentDecisionTrail[]) => void
  toggleTension: (id: string | null) => void
  toggleDecision: (ref: string | null) => void
  toggleShowAllPatterns: () => void
  setLoading: (loading: boolean) => void
  fetchDocMemory: (fileId: string) => Promise<void>
  triggerInterpretation: (fileId: string, workspaceId: string) => Promise<void>
  dismissPattern: (patternId: string) => Promise<void>
  reset: () => void
}

export const useDocMemoryStore = create<DocMemoryState>((set, _get) => ({
  // Initial state
  interpretation: null,
  patterns: [],
  decisionTrails: [],
  activeTab: 'history',
  expandedTensionId: null,
  expandedDecisionRef: null,
  showAllPatterns: false,
  isLoading: false,
  lastFetchedFileId: null,

  // Actions
  setActiveTab: (tab) => set({ activeTab: tab }),

  setInterpretation: (interp) => set({ interpretation: interp }),

  setPatterns: (patterns) => set({ patterns }),

  setDecisionTrails: (trails) => set({ decisionTrails: trails }),

  toggleTension: (id) =>
    set((s) => ({
      expandedTensionId: s.expandedTensionId === id ? null : id,
    })),

  toggleDecision: (ref) =>
    set((s) => ({
      expandedDecisionRef: s.expandedDecisionRef === ref ? null : ref,
    })),

  toggleShowAllPatterns: () => set((s) => ({ showAllPatterns: !s.showAllPatterns })),

  setLoading: (loading) => set({ isLoading: loading }),

  fetchDocMemory: async (fileId: string) => {
    set({ isLoading: true })
    try {
      const res = await api.get<DocumentMemory>(`/api/doc-memory/${fileId}`)
      if (res.data) {
        set({
          interpretation: res.data.interpretation,
          patterns: res.data.patterns,
          decisionTrails: res.data.decisionTrails,
          lastFetchedFileId: fileId,
        })
      }
    } catch (err) {
      console.warn('[DocMemoryStore] fetchDocMemory failed:', err)
    } finally {
      set({ isLoading: false })
    }
  },

  triggerInterpretation: async (fileId: string, workspaceId: string) => {
    set({ isLoading: true })
    try {
      const res = await api.post<DocumentInterpretation>(`/api/doc-memory/${fileId}/interpret`, {
        workspaceId,
      })
      if (res.data) {
        set({ interpretation: res.data })
      }
    } catch (err) {
      console.warn('[DocMemoryStore] triggerInterpretation failed:', err)
    } finally {
      set({ isLoading: false })
    }
  },

  dismissPattern: async (patternId: string) => {
    try {
      await api.patch(`/api/doc-memory/patterns/${patternId}`, { dismissed: true })
      set((s) => ({
        patterns: s.patterns.filter((p) => p.id !== patternId),
      }))
    } catch (err) {
      console.warn('[DocMemoryStore] dismissPattern failed:', err)
    }
  },

  reset: () =>
    set({
      interpretation: null,
      patterns: [],
      decisionTrails: [],
      activeTab: 'history',
      expandedTensionId: null,
      expandedDecisionRef: null,
      showAllPatterns: false,
      isLoading: false,
      lastFetchedFileId: null,
    }),
}))
