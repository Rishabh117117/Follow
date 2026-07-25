'use client'

import { useState, useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { useCollaboration, useAutoSave } from '@/lib/collaboration'
import { useTrackEvent } from '@/hooks/use-track-event'
import { EditorHeader } from '../shared/editor-header'
import type { SaveStatus } from '../shared/save-indicator'
import { createRichTextExtensions, createStandaloneExtensions } from './extensions'
import { SlashCommandMenu, useSlashCommand } from './slash-command'

interface NotesEditorProps {
  fileId: string
  workspaceId: string
  fileName: string
  onRename: (name: string) => void
  onNavigateToFile?: (fileId: string) => void
}

export function NotesEditor({
  fileId,
  workspaceId,
  fileName,
  onRename,
  onNavigateToFile: _onNavigateToFile,
}: NotesEditorProps) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const { doc, provider, connected, collaborators } = useCollaboration(fileId, workspaceId)
  const track = useTrackEvent()

  const editor = useEditor(
    {
      extensions:
        doc && provider
          ? createRichTextExtensions({
              doc,
              provider,
              placeholder: 'Type / for commands, or start writing...',
            })
          : createStandaloneExtensions('Type / for commands, or start writing...'),
      editorProps: {
        attributes: {
          class:
            'prose prose-invert prose-zinc max-w-none focus:outline-none min-h-[400px] px-6 py-4',
        },
        handleKeyDown: () => {
          // Markdown shortcuts are handled by TipTap's input rules
          return false
        },
      },
      onUpdate: () => {
        setSaveStatus('unsaved')
      },
      onCreate: () => {
        track({
          actionType: 'edit',
          objectType: 'note',
          objectId: fileId,
          payload: { event: 'note_opened' },
        })
      },
    },
    [doc, provider]
  )

  // Slash command
  const slashCommand = useSlashCommand(editor)

  // Auto-save
  const { save } = useAutoSave(doc, fileId, {
    debounceMs: 1500, // Notes save faster
    onSave: () => setSaveStatus('saved'),
  })

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        setSaveStatus('saving')
        save().then(() => setSaveStatus('saved'))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [save])

  // Word count
  const wordCount =
    editor?.state.doc.textContent.split(/\s+/).filter((w) => w.length > 0).length ?? 0

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <EditorHeader
        fileName={fileName}
        fileType="note"
        onRename={onRename}
        saveStatus={saveStatus}
        connected={connected}
        collaborators={collaborators}
      >
        <span className="text-[10px] text-zinc-600">{wordCount} words</span>
      </EditorHeader>

      {/* Minimal toolbar for notes */}
      {editor && (
        <div className="flex items-center gap-0.5 border-b border-zinc-800/50 bg-zinc-900/30 px-3 py-1">
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`rounded px-1.5 py-0.5 text-xs font-bold ${
              editor.isActive('bold')
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-800'
            }`}
          >
            B
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`rounded px-1.5 py-0.5 text-xs italic ${
              editor.isActive('italic')
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-800'
            }`}
          >
            I
          </button>
          <button
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`rounded px-1.5 py-0.5 text-xs line-through ${
              editor.isActive('strike')
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-800'
            }`}
          >
            S
          </button>
          <button
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={`rounded px-1.5 py-0.5 text-xs ${
              editor.isActive('code')
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-800'
            }`}
          >
            {'</>'}
          </button>
          <div className="mx-1 h-4 w-px bg-zinc-800" />
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`rounded px-1.5 py-0.5 text-xs ${
              editor.isActive('bulletList')
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-800'
            }`}
          >
            \u2022
          </button>
          <button
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            className={`rounded px-1.5 py-0.5 text-xs ${
              editor.isActive('taskList')
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-800'
            }`}
          >
            \u2611
          </button>
          <div className="mx-1 h-4 w-px bg-zinc-800" />
          <span className="text-[10px] text-zinc-600">
            Type <kbd className="rounded bg-zinc-800 px-1 text-zinc-500">/</kbd> for commands
          </span>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Slash command menu */}
      {editor && (
        <SlashCommandMenu
          editor={editor}
          show={slashCommand.show}
          position={slashCommand.position}
          query={slashCommand.query}
          onClose={slashCommand.onClose}
        />
      )}

      {/* Bottom bar */}
      <div className="flex items-center justify-between border-t border-zinc-800/50 bg-zinc-900/30 px-4 py-1">
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-zinc-600">
            {connected ? 'Connected' : 'Offline'} \u00b7 {collaborators.length} collaborator
            {collaborators.length !== 1 ? 's' : ''}
          </span>
        </div>
        <span className="text-[10px] text-zinc-600">Markdown shortcuts enabled</span>
      </div>
    </div>
  )
}
