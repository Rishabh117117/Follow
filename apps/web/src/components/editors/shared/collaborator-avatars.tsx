'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CollaboratorInfo } from '@/lib/collaboration'
import { useEditorRefStore } from '@/stores/editor-ref-store'
import { api } from '@/lib/api-client'

interface CollaboratorAvatarsProps {
  collaborators: CollaboratorInfo[]
  /** Self-info — used to label the current user in the dropdown */
  self?: { userId: string; name: string; color: string }
  workspaceId?: string
  fileId?: string
  maxShow?: number
}

export function CollaboratorAvatars({
  collaborators,
  self,
  workspaceId,
  fileId,
  maxShow = 5,
}: CollaboratorAvatarsProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (collaborators.length === 0 && !self) return null

  const visible = collaborators.slice(0, maxShow)
  const overflow = collaborators.length - maxShow

  const startChatWith = async (userId: string) => {
    if (!workspaceId) return
    try {
      const res = await api.post<{ id: string }>('/api/chat/conversations', {
        workspaceId,
        type: 'standard',
        title: 'Direct chat',
        contextObjectId: fileId,
        contextObjectType: fileId ? 'file' : undefined,
      })
      if (res.data?.id) {
        router.push(`/workspace/${workspaceId}/chat?conversation=${res.data.id}&with=${userId}`)
      }
    } catch (err) {
      console.warn('[CollaboratorAvatars] start chat failed', err)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1"
        title="Click to see who's in this document"
      >
        <div className="flex -space-x-2">
          {visible.map((c, i) => (
            <div
              key={`${c.userId}-${i}`}
              className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-zinc-900 text-[9px] font-bold text-white"
              style={{ backgroundColor: c.color }}
              title={c.name}
            >
              {getInitials(c.name)}
            </div>
          ))}
          {overflow > 0 && (
            <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-zinc-900 bg-zinc-700 text-[9px] font-medium text-zinc-300">
              +{overflow}
            </div>
          )}
        </div>
        <span className="ml-1 text-xs text-zinc-500">{collaborators.length + (self ? 1 : 0)} editing</span>
      </button>

      {open && (
        <CollaboratorDetailDropdown
          collaborators={collaborators}
          self={self}
          onStartChat={startChatWith}
        />
      )}
    </div>
  )
}

function CollaboratorDetailDropdown({
  collaborators,
  self,
  onStartChat,
}: {
  collaborators: CollaboratorInfo[]
  self?: { userId: string; name: string; color: string }
  onStartChat: (userId: string) => void
}) {
  // Read the current TipTap editor — we map each collaborator's cursor pos to
  // the nearest H1/H2 heading text. Self section is mapped from the live cursor.
  const editor = useEditorRefStore((s) => s.editor)
  const [now, setNow] = useState(Date.now())

  // Re-render periodically so "Xm ago" stays accurate
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const sectionForPos = (pos: number | undefined): string | null => {
    if (!editor || pos == null) return null
    let lastHeading: string | null = null
    let stop = false
    editor.state.doc.descendants((node, p) => {
      if (stop) return false
      if (p > pos) {
        stop = true
        return false
      }
      if (
        (node as unknown as { type: { name: string }; attrs: { level?: number } }).type.name ===
          'heading' &&
        ((node as unknown as { attrs: { level?: number } }).attrs.level ?? 99) <= 2
      ) {
        lastHeading = (node as unknown as { textContent: string }).textContent
      }
      return true
    })
    return lastHeading
  }

  const selfSection = (() => {
    if (!editor) return null
    const sel = editor.state.selection
    return sectionForPos(sel.from)
  })()

  return (
    <div
      className="absolute right-0 top-9 z-50 w-[260px] rounded-xl bg-white p-2 shadow-xl"
      style={{ border: '1px solid #E0E0E0' }}
    >
      <div className="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#9AA0A6]">
        In this document
      </div>
      {self && (
        <CollabRow
          name={`${self.name} · You`}
          color={self.color}
          section={selfSection}
          isSelf
          isOnline
        />
      )}
      {collaborators.map((c) => {
        const section = sectionForPos(c.cursor?.head ?? c.cursor?.anchor)
        return (
          <CollabRow
            key={c.userId}
            name={c.name}
            color={c.color}
            section={section}
            isOnline
            onStartChat={() => onStartChat(c.userId)}
          />
        )
      })}
      {collaborators.length === 0 && !self && (
        <p className="px-2 py-2 text-[11px]" style={{ color: '#9AA0A6' }}>
          You're the only one here
        </p>
      )}
      <div
        className="mt-1 border-t px-2 pt-1 text-[10px]"
        style={{ borderColor: '#E8EAED', color: '#9AA0A6' }}
      >
        {collaborators.length + (self ? 1 : 0)} viewing · {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  )
}

function CollabRow({
  name,
  color,
  section,
  isSelf,
  isOnline,
  onStartChat,
}: {
  name: string
  color: string
  section: string | null
  isSelf?: boolean
  isOnline?: boolean
  onStartChat?: () => void
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[#F8F9FA]">
      <div className="relative">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ background: color }}
        >
          {getInitials(name)}
        </div>
        {isOnline && (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full"
            style={{ background: '#22C55E', border: '1.5px solid white' }}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs" style={{ color: '#202124' }}>
          {name}
        </div>
        <div className="truncate text-[10px]" style={{ color: '#9AA0A6' }}>
          {section ?? 'No section'}
        </div>
      </div>
      {!isSelf && onStartChat && (
        <button
          onClick={onStartChat}
          className="text-[10px] font-medium opacity-0 transition-opacity group-hover:opacity-100"
          style={{ color: '#1A73E8' }}
          title={`Start chat with ${name}`}
        >
          Chat
        </button>
      )}
    </div>
  )
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}
