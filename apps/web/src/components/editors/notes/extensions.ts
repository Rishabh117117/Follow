import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
import Typography from '@tiptap/extension-typography'
import Color from '@tiptap/extension-color'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'

export interface EditorExtensionOptions {
  doc: Y.Doc
  provider: WebsocketProvider
  placeholder?: string
}

export function createRichTextExtensions(options: EditorExtensionOptions) {
  const { doc, provider, placeholder = 'Start writing...' } = options

  return [
    StarterKit.configure({
      undoRedo: false, // Yjs handles undo/redo
    }),
    Placeholder.configure({
      placeholder,
      emptyEditorClass: 'is-editor-empty',
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableCell,
    TableHeader,
    Image.configure({
      inline: true,
      allowBase64: true,
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        class: 'text-blue-400 underline hover:text-blue-300',
      },
    }),
    Highlight.configure({
      multicolor: true,
    }),
    TextAlign.configure({
      types: ['heading', 'paragraph'],
    }),
    Underline,
    Typography,
    Color,
    Collaboration.configure({
      document: doc,
    }),
    CollaborationCursor.configure({
      provider,
    }),
  ]
}

/**
 * Create extensions for a non-collaborative (offline/single-user) editor.
 */
export function createStandaloneExtensions(placeholder = 'Start writing...') {
  return [
    StarterKit,
    Placeholder.configure({
      placeholder,
      emptyEditorClass: 'is-editor-empty',
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableCell,
    TableHeader,
    Image.configure({
      inline: true,
      allowBase64: true,
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        class: 'text-blue-400 underline hover:text-blue-300',
      },
    }),
    Highlight.configure({
      multicolor: true,
    }),
    TextAlign.configure({
      types: ['heading', 'paragraph'],
    }),
    Underline,
    Typography,
    Color,
  ]
}
