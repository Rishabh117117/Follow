'use client'

/**
 * GroupMembersDropdown — appears when the user clicks the avatar stack in
 * GroupChatPanel's header. Lists members with online dots and role badges,
 * and lets the group owner add or remove members. Backed by:
 *   GET    /api/chat/conversations/:id/members
 *   POST   /api/chat/conversations/:id/members
 *   DELETE /api/chat/conversations/:id/members/:userId
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api-client'
import { getMemberColor, getInitials } from '@/stores/group-thread-store'

interface ConversationMemberRow {
  userId: string
  role: 'owner' | 'member'
  name: string | null
  email: string | null
  avatarUrl: string | null
}

interface WorkspaceMemberRow {
  userId: string | null
  userName: string | null
  userEmail: string | null
}

interface GroupMembersDropdownProps {
  conversationId: string
  workspaceId: string
  currentUserId: string
  members: ConversationMemberRow[]
  onlineIds: Set<string>
  onClose: () => void
  onChanged: () => void
}

export function GroupMembersDropdown({
  conversationId,
  workspaceId,
  currentUserId,
  members,
  onlineIds,
  onClose,
  onChanged,
}: GroupMembersDropdownProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMemberRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isOwner = useMemo(
    () => members.some((m) => m.userId === currentUserId && m.role === 'owner'),
    [members, currentUserId]
  )

  // Close on outside click
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [onClose])

  // Lazily load workspace members when adding
  useEffect(() => {
    if (!adding || workspaceMembers.length > 0) return
    void api
      .get<{ members: WorkspaceMemberRow[] }>(`/api/workspaces/${workspaceId}`)
      .then((res) => {
        setWorkspaceMembers(
          (res.data?.members ?? []).filter((m): m is WorkspaceMemberRow => !!m.userId)
        )
      })
      .catch(() => undefined)
  }, [adding, workspaceMembers.length, workspaceId])

  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return [] as WorkspaceMemberRow[]
    const memberIds = new Set(members.map((m) => m.userId))
    return workspaceMembers
      .filter((m) => m.userId && !memberIds.has(m.userId))
      .filter(
        (m) => m.userName?.toLowerCase().includes(q) || m.userEmail?.toLowerCase().includes(q)
      )
      .slice(0, 6)
  }, [search, workspaceMembers, members])

  const handleAdd = async (userId: string) => {
    setBusy(userId)
    setError(null)
    try {
      await api.post(`/api/chat/conversations/${conversationId}/members`, { userId })
      setSearch('')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member')
    } finally {
      setBusy(null)
    }
  }

  const handleRemove = async (userId: string) => {
    setBusy(userId)
    setError(null)
    try {
      await api.delete(`/api/chat/conversations/${conversationId}/members/${userId}`)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      ref={ref}
      className="absolute right-2 top-10 z-50 w-[260px] rounded-xl bg-white p-2 shadow-xl"
      style={{ border: '1px solid #E0E0E0' }}
    >
      <div className="mb-1 flex items-center justify-between px-2 py-1">
        <span
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: '#9AA0A6' }}
        >
          Members ({members.length})
        </span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-[11px] font-medium"
          style={{ color: '#1A73E8' }}
        >
          {adding ? 'Done' : '+ Add'}
        </button>
      </div>

      {/* Existing members */}
      <div className="max-h-[220px] overflow-y-auto">
        {members.map((m) => {
          const isOnline = onlineIds.has(m.userId) || m.userId === currentUserId
          const isSelf = m.userId === currentUserId
          const color = getMemberColor(m.userId)
          const initials = getInitials(m.name ?? m.email ?? '?')
          return (
            <div
              key={m.userId}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[#F8F9FA]"
            >
              <div className="relative">
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white"
                  style={{ background: color }}
                >
                  {initials}
                </div>
                <span
                  className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full"
                  style={{
                    background: isOnline ? '#22C55E' : '#9AA0A6',
                    border: '1.5px solid white',
                  }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs" style={{ color: '#202124' }}>
                  {m.name ?? m.email ?? 'Unknown'}{' '}
                  {isSelf && <span className="text-[#9AA0A6]">(you)</span>}
                </div>
                <div className="flex items-center gap-1 text-[10px]" style={{ color: '#9AA0A6' }}>
                  {m.role === 'owner' && (
                    <span
                      className="rounded px-1 py-px text-[9px] font-semibold uppercase"
                      style={{ background: '#FEF3C7', color: '#92400E' }}
                    >
                      Owner
                    </span>
                  )}
                  <span>{isOnline ? 'online' : 'offline'}</span>
                </div>
              </div>
              {isOwner && !isSelf && m.role !== 'owner' && (
                <button
                  onClick={() => handleRemove(m.userId)}
                  disabled={busy === m.userId}
                  className="text-[10px] text-[#D93025] hover:underline disabled:opacity-40"
                >
                  Remove
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Add member search */}
      {adding && (
        <div className="mt-2 border-t pt-2" style={{ borderColor: '#E8EAED' }}>
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="w-full rounded-md border border-[#DADCE0] px-2 py-1 text-xs focus:border-[#1A73E8] focus:outline-none"
          />
          {filteredCandidates.length > 0 && (
            <div className="mt-1 max-h-[160px] overflow-y-auto">
              {filteredCandidates.map((c) => (
                <button
                  key={c.userId}
                  onClick={() => c.userId && handleAdd(c.userId)}
                  disabled={busy === c.userId}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[#F1F3F4] disabled:opacity-40"
                >
                  <div
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold text-white"
                    style={{ background: getMemberColor(c.userId ?? '') }}
                  >
                    {getInitials(c.userName ?? c.userEmail ?? '?')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs" style={{ color: '#202124' }}>
                      {c.userName}
                    </div>
                    <div className="truncate text-[10px]" style={{ color: '#9AA0A6' }}>
                      {c.userEmail}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 px-2 text-[10px]" style={{ color: '#D93025' }}>
          {error}
        </p>
      )}
    </div>
  )
}
