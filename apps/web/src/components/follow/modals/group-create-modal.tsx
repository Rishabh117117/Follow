'use client'

/**
 * GroupCreateModal — creates a new `type=group` chat conversation backed by
 * the chat_conversation_members table. Used by UnitChatPanel's "New Group
 * Chat" menu item.
 */

import { useState, useEffect, useMemo } from 'react'
import { api } from '@/lib/api-client'

interface WorkspaceMemberRow {
  userId: string | null
  userName: string | null
  userEmail: string | null
  userAvatar: string | null
}

interface CreateGroupResponse {
  id: string
  title: string
  type: string
  createdAt: string
  updatedAt: string
  memberCount?: number
}

interface GroupCreateModalProps {
  workspaceId: string
  contextFileId: string | null
  contextFileName: string | null
  onClose: () => void
  onCreated: (conv: CreateGroupResponse) => void
}

export function GroupCreateModal({
  workspaceId,
  contextFileId,
  contextFileName,
  onClose,
  onCreated,
}: GroupCreateModalProps) {
  const [name, setName] = useState('')
  const [search, setSearch] = useState('')
  const [members, setMembers] = useState<WorkspaceMemberRow[]>([])
  const [selected, setSelected] = useState<WorkspaceMemberRow[]>([])
  const [linkDoc, setLinkDoc] = useState<boolean>(!!contextFileId)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load workspace members
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await api.get<{
          members: WorkspaceMemberRow[]
        }>(`/api/workspaces/${workspaceId}`)
        if (cancelled) return
        const list = (res.data?.members ?? []).filter((m): m is WorkspaceMemberRow => !!m.userId)
        setMembers(list)
      } catch (err) {
        console.warn('[GroupCreateModal] Failed to load members:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return [] as WorkspaceMemberRow[]
    return members
      .filter((m) => !selected.some((s) => s.userId === m.userId))
      .filter(
        (m) => m.userName?.toLowerCase().includes(q) || m.userEmail?.toLowerCase().includes(q)
      )
      .slice(0, 6)
  }, [search, members, selected])

  const handleAdd = (member: WorkspaceMemberRow) => {
    setSelected((prev) => [...prev, member])
    setSearch('')
  }

  const handleRemove = (userId: string | null) => {
    setSelected((prev) => prev.filter((m) => m.userId !== userId))
  }

  const handleCreate = async () => {
    if (!name.trim() || selected.length === 0) {
      setError('Add a name and at least one member')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const memberIds = selected.map((m) => m.userId).filter((id): id is string => !!id)
      const res = await api.post<CreateGroupResponse>('/api/chat/conversations', {
        workspaceId,
        title: name.trim().slice(0, 60),
        type: 'group',
        contextObjectId: linkDoc && contextFileId ? contextFileId : undefined,
        contextObjectType: linkDoc && contextFileId ? 'file' : undefined,
        memberIds,
      })
      if (res.error || !res.data) {
        throw new Error(res.error?.message ?? 'Failed to create group')
      }
      onCreated({ ...res.data, memberCount: memberIds.length + 1 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[440px] rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: '#202124' }}>
            New Group Chat
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[#F1F3F4]"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#5F6368"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Name */}
        <label className="mb-1 block text-xs font-medium" style={{ color: '#5F6368' }}>
          Group name
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 60))}
          placeholder="e.g. Thesis Research"
          className="mb-4 w-full rounded-lg border border-[#DADCE0] px-3 py-2 text-sm focus:border-[#1A73E8] focus:outline-none"
        />

        {/* Member chips */}
        {selected.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {selected.map((m) => (
              <span
                key={m.userId ?? m.userEmail ?? Math.random()}
                className="inline-flex items-center gap-1 rounded-full bg-[#E8F0FE] px-2 py-1 text-xs"
                style={{ color: '#1A73E8' }}
              >
                {m.userName ?? m.userEmail}
                <button
                  onClick={() => handleRemove(m.userId)}
                  className="ml-0.5 text-[#1A73E8] hover:text-[#0B5BCE]"
                >
                  {'\u00D7'}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Member search */}
        <label className="mb-1 block text-xs font-medium" style={{ color: '#5F6368' }}>
          Add members
        </label>
        <div className="relative mb-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="w-full rounded-lg border border-[#DADCE0] px-3 py-2 text-sm focus:border-[#1A73E8] focus:outline-none"
          />
          {filtered.length > 0 && (
            <div
              className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg bg-white"
              style={{ border: '1px solid #DADCE0', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
            >
              {filtered.map((m) => (
                <button
                  key={m.userId}
                  onClick={() => handleAdd(m)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[#F8F9FA]"
                >
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ background: '#6366F1' }}
                  >
                    {(m.userName ?? m.userEmail ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm" style={{ color: '#202124' }}>
                      {m.userName}
                    </div>
                    <div className="truncate text-xs" style={{ color: '#9AA0A6' }}>
                      {m.userEmail}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Document scope toggle */}
        {contextFileId && contextFileName && (
          <label
            className="mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
            style={{ background: '#F8F9FA' }}
          >
            <input
              type="checkbox"
              checked={linkDoc}
              onChange={(e) => setLinkDoc(e.target.checked)}
            />
            <span style={{ color: '#3C4043' }}>
              Link to document <strong>{contextFileName}</strong>
            </span>
          </label>
        )}

        {error && (
          <p className="mb-2 text-xs" style={{ color: '#D93025' }}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-[#F1F3F4]"
            style={{ color: '#5F6368' }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={submitting || !name.trim() || selected.length === 0}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ background: '#1A73E8' }}
          >
            {submitting ? 'Creating…' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  )
}
