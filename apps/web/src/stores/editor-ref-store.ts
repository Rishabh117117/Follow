import { create } from 'zustand'
import type { Editor } from '@tiptap/react'

interface EditorRefState {
  /** The currently active TipTap editor instance (set by RichTextEditor on mount) */
  editor: Editor | null
  setEditor: (editor: Editor | null) => void
}

export const useEditorRefStore = create<EditorRefState>((set) => ({
  editor: null,
  setEditor: (editor) => set({ editor }),
}))
