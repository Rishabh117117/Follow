'use client'

import { useState, useRef, useEffect } from 'react'
import type { CollaboratorInfo } from '@/lib/collaboration'
import { CollaboratorAvatars } from './collaborator-avatars'
import { SaveIndicator, type SaveStatus } from './save-indicator'

interface EditorHeaderProps {
  fileName: string
  fileType: string
  onRename: (name: string) => void
  saveStatus: SaveStatus
  connected: boolean
  collaborators: CollaboratorInfo[]
  /** Self-info for the collaborator detail dropdown */
  self?: { userId: string; name: string; color: string }
  workspaceId?: string
  fileId?: string
  children?: React.ReactNode
}

const FILE_TYPE_ICONS: Record<string, string> = {
  document: '\ud83d\udcdd',
  spreadsheet: '\ud83d\udcca',
  presentation: '\ud83c\udfa8',
  note: '\ud83d\uddd2\ufe0f',
}

export function EditorHeader({
  fileName,
  fileType,
  onRename,
  saveStatus,
  connected,
  collaborators,
  self,
  workspaceId,
  fileId,
  children,
}: EditorHeaderProps) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(fileName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setName(fileName)
  }, [fileName])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== fileName) {
      onRename(trimmed)
    } else {
      setName(fileName)
    }
    setEditing(false)
  }

  const icon = FILE_TYPE_ICONS[fileType] ?? '\ud83d\udcc4'

  return (
    <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-2">
      <div className="flex items-center gap-3">
        <span className="text-lg">{icon}</span>
        {editing ? (
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
              if (e.key === 'Escape') {
                setName(fileName)
                setEditing(false)
              }
            }}
            className="rounded bg-transparent px-1 text-sm font-medium text-zinc-100 outline-none ring-1 ring-zinc-600"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-sm font-medium text-zinc-100 transition-colors hover:text-white"
          >
            {fileName}
          </button>
        )}
        <SaveIndicator status={saveStatus} connected={connected} />
      </div>

      <div className="flex items-center gap-3">
        {children}
        <CollaboratorAvatars
          collaborators={collaborators}
          self={self}
          workspaceId={workspaceId}
          fileId={fileId}
        />
      </div>
    </div>
  )
}
