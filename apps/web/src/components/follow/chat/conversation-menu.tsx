'use client'

/**
 * ConversationMenu — ⋯ dropdown for floating-unit thread drawer rows.
 * Provides rename / pin / archive / delete actions wired to chat API.
 */

import { useState, useRef, useEffect } from 'react'
import { api } from '@/lib/api-client'

interface ConversationMenuProps {
  conversationId: string
  currentTitle: string
  isPinned: boolean
  onUpdated: () => void
  onDeleted: () => void
}

export function ConversationMenu({
  conversationId,
  currentTitle,
  isPinned,
  onUpdated,
  onDeleted,
}: ConversationMenuProps) {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(currentTitle)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const handleRename = async () => {
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === currentTitle) {
      setRenaming(false)
      return
    }
    await api.patch(`/api/chat/conversations/${conversationId}`, { title: trimmed })
    setRenaming(false)
    setOpen(false)
    onUpdated()
  }

  const handleTogglePin = async () => {
    await api.patch(`/api/chat/conversations/${conversationId}`, { isPinned: !isPinned })
    setOpen(false)
    onUpdated()
  }

  const handleArchive = async () => {
    await api.patch(`/api/chat/conversations/${conversationId}`, { status: 'archived' })
    setOpen(false)
    onUpdated()
  }

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    await api.delete(`/api/chat/conversations/${conversationId}`)
    setOpen(false)
    onDeleted()
  }

  if (renaming) {
    return (
      <input
        autoFocus
        value={renameValue}
        onChange={(e) => setRenameValue(e.target.value)}
        onBlur={handleRename}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleRename()
          if (e.key === 'Escape') setRenaming(false)
        }}
        className="flex-1 rounded border border-[#1A73E8] bg-white px-1.5 py-0.5 text-sm text-[#202124] focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      />
    )
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="flex h-6 w-6 items-center justify-center rounded text-[#9AA0A6] opacity-0 transition-opacity hover:bg-[#E8EAED] hover:text-[#202124] group-hover:opacity-100"
        title="More"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute right-0 top-7 z-50 w-40 rounded-lg bg-white py-1 text-sm shadow-lg"
          style={{ border: '1px solid #E8EAED' }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem
            label="Rename"
            onClick={() => {
              setRenameValue(currentTitle)
              setRenaming(true)
              setOpen(false)
            }}
          />
          <MenuItem
            label={isPinned ? 'Unpin' : 'Pin'}
            icon={'\uD83D\uDCCC'}
            onClick={handleTogglePin}
          />
          <MenuItem label="Archive" onClick={handleArchive} />
          <MenuItem
            label={confirmDelete ? 'Click again to confirm' : 'Delete'}
            danger
            onClick={handleDelete}
          />
        </div>
      )}
    </div>
  )
}

function MenuItem({
  label,
  icon,
  danger,
  onClick,
}: {
  label: string
  icon?: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[#F1F3F4] ${
        danger ? 'text-[#D93025]' : 'text-[#3C4043]'
      }`}
    >
      {icon && <span className="text-xs">{icon}</span>}
      <span>{label}</span>
    </button>
  )
}
