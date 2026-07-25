'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/react'

export interface SlashCommandItem {
  title: string
  description: string
  icon: string
  action: (editor: Editor) => void
}

const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    title: 'Heading 1',
    description: 'Large section heading',
    icon: 'H1',
    action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    icon: 'H2',
    action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    icon: 'H3',
    action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    title: 'Bullet List',
    description: 'Create a simple list',
    icon: '\u2022',
    action: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    title: 'Numbered List',
    description: 'Create a numbered list',
    icon: '1.',
    action: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    title: 'Task List',
    description: 'Create a to-do list',
    icon: '\u2611',
    action: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    title: 'Quote',
    description: 'Add a blockquote',
    icon: '\u201c',
    action: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    title: 'Code Block',
    description: 'Add a code block',
    icon: '{ }',
    action: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: 'Divider',
    description: 'Add a horizontal rule',
    icon: '\u2500',
    action: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    title: 'Table',
    description: 'Add a table',
    icon: '\u229e',
    action: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
]

interface SlashCommandMenuProps {
  editor: Editor
  show: boolean
  position: { top: number; left: number }
  query: string
  onClose: () => void
}

export function SlashCommandMenu({
  editor,
  show,
  position,
  query,
  onClose,
}: SlashCommandMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

  const filtered = SLASH_COMMANDS.filter(
    (cmd) =>
      cmd.title.toLowerCase().includes(query.toLowerCase()) ||
      cmd.description.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const executeCommand = useCallback(
    (item: SlashCommandItem) => {
      // Delete the slash command text
      const { from } = editor.state.selection
      const textBefore = editor.state.doc.textBetween(
        Math.max(0, from - query.length - 1),
        from,
        '\n'
      )
      const slashPos = textBefore.lastIndexOf('/')
      if (slashPos >= 0) {
        const deleteFrom = from - query.length - 1
        editor.chain().focus().deleteRange({ from: deleteFrom, to: from }).run()
      }

      item.action(editor)
      onClose()
    },
    [editor, query, onClose]
  )

  useEffect(() => {
    if (!show) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % filtered.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filtered[selectedIndex]) {
          executeCommand(filtered[selectedIndex])
        }
      } else if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [show, selectedIndex, filtered, executeCommand, onClose])

  if (!show || filtered.length === 0) return null

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-64 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
      style={{ top: position.top, left: position.left }}
    >
      <div className="max-h-64 overflow-auto p-1">
        {filtered.map((item, i) => (
          <button
            key={item.title}
            onClick={() => executeCommand(item)}
            onMouseEnter={() => setSelectedIndex(i)}
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
              i === selectedIndex ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
            }`}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-800 text-sm text-zinc-300">
              {item.icon}
            </span>
            <div>
              <div className="text-sm text-zinc-200">{item.title}</div>
              <div className="text-[11px] text-zinc-500">{item.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Hook to manage slash command state for an editor.
 */
export function useSlashCommand(editor: Editor | null) {
  const [show, setShow] = useState(false)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!editor) return

    const handleUpdate = () => {
      const { from } = editor.state.selection
      const textBefore = editor.state.doc.textBetween(Math.max(0, from - 50), from, '\n')

      // Check if we have a slash command in progress
      const slashMatch = textBefore.match(/\/([a-zA-Z]*)$/)

      if (slashMatch) {
        setQuery(slashMatch[1] ?? '')
        setShow(true)

        // Position the menu near the cursor
        const coords = editor.view.coordsAtPos(from)
        setPosition({
          top: coords.bottom + 4,
          left: coords.left,
        })
      } else {
        setShow(false)
        setQuery('')
      }
    }

    editor.on('update', handleUpdate)
    editor.on('selectionUpdate', handleUpdate)

    return () => {
      editor.off('update', handleUpdate)
      editor.off('selectionUpdate', handleUpdate)
    }
  }, [editor])

  return {
    show,
    query,
    position,
    onClose: () => {
      setShow(false)
      setQuery('')
    },
  }
}
