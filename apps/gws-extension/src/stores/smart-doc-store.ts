/**
 * Document tracking state store.
 * Tracks activation status, document linkage, recording state, and signal metrics.
 */

import { create } from 'zustand'

interface SmartDocState {
  // Activation
  isActivated: boolean
  followDocId: string | null // The external_documents.id from Follow backend
  googleDocId: string | null
  strandId: string | null
  strandName: string | null

  // Recording
  isRecording: boolean

  // Metrics
  signalCount: number
  lastSignalAt: string | null

  // Actions
  activate: (data: {
    followDocId: string
    googleDocId: string
    strandId?: string
    strandName?: string
  }) => void
  deactivate: () => void
  setRecording: (recording: boolean) => void
  incrementSignalCount: (count?: number) => void
  setLastSignalAt: (time: string) => void
}

export const useSmartDocStore = create<SmartDocState>((set) => ({
  isActivated: false,
  followDocId: null,
  googleDocId: null,
  strandId: null,
  strandName: null,
  isRecording: false,
  signalCount: 0,
  lastSignalAt: null,

  activate: ({ followDocId, googleDocId, strandId, strandName }) =>
    set({
      isActivated: true,
      followDocId,
      googleDocId,
      strandId: strandId ?? null,
      strandName: strandName ?? null,
      isRecording: true,
      signalCount: 0,
      lastSignalAt: null,
    }),

  deactivate: () =>
    set({
      isActivated: false,
      followDocId: null,
      googleDocId: null,
      strandId: null,
      strandName: null,
      isRecording: false,
      signalCount: 0,
      lastSignalAt: null,
    }),

  setRecording: (recording) => set({ isRecording: recording }),

  incrementSignalCount: (count = 1) =>
    set((s) => ({ signalCount: s.signalCount + count })),

  setLastSignalAt: (time) => set({ lastSignalAt: time }),
}))
