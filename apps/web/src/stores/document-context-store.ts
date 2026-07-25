'use client'

import { create } from 'zustand'

interface DocumentContextState {
  currentSectionIndex: number
  currentSectionTitle: string
  currentHeadingLevel: number
  sectionCount: number
}

interface DocumentContextActions {
  setCurrentSection: (index: number, title: string, level: number) => void
  setSectionCount: (count: number) => void
  reset: () => void
}

const initialState: DocumentContextState = {
  currentSectionIndex: 0,
  currentSectionTitle: '',
  currentHeadingLevel: 0,
  sectionCount: 0,
}

export const useDocumentContextStore = create<DocumentContextState & DocumentContextActions>(
  (set) => ({
    ...initialState,
    setCurrentSection: (index, title, level) =>
      set({ currentSectionIndex: index, currentSectionTitle: title, currentHeadingLevel: level }),
    setSectionCount: (count) => set({ sectionCount: count }),
    reset: () => set(initialState),
  })
)
