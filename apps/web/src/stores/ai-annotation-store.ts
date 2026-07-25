import { create } from 'zustand'

export interface AiAnnotation {
  id: string
  spanText: string
  explanation: string
  category?: string
}

interface AiAnnotationState {
  annotations: AiAnnotation[]
  activeAnnotationId: string | null
  isProcessing: boolean

  setAnnotations: (annotations: AiAnnotation[]) => void
  addAnnotations: (annotations: AiAnnotation[]) => void
  setActiveAnnotation: (id: string | null) => void
  setProcessing: (processing: boolean) => void
  dismissAnnotation: (id: string) => void
  clearAll: () => void
}

export const useAiAnnotationStore = create<AiAnnotationState>((set) => ({
  annotations: [],
  activeAnnotationId: null,
  isProcessing: false,

  setAnnotations: (annotations) => set({ annotations }),
  addAnnotations: (newAnnotations) =>
    set((state) => ({
      annotations: [...state.annotations, ...newAnnotations],
    })),
  setActiveAnnotation: (id) => set({ activeAnnotationId: id }),
  setProcessing: (processing) => set({ isProcessing: processing }),

  dismissAnnotation: (id) =>
    set((state) => ({
      annotations: state.annotations.filter((a) => a.id !== id),
      activeAnnotationId: state.activeAnnotationId === id ? null : state.activeAnnotationId,
    })),

  clearAll: () =>
    set({
      annotations: [],
      activeAnnotationId: null,
      isProcessing: false,
    }),
}))
