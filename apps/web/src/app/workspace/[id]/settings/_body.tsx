'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api-client'

interface Member {
  id: string
  userId: string | null
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  status: 'active' | 'pending' | 'removed'
  inviteEmail: string | null
  joinedAt: string | null
  userName: string | null
  userEmail: string | null
  userAvatar: string | null
}

interface WorkspaceDetail {
  id: string
  name: string
  slug: string
  ownerId: string
  createdAt: string
  members: Member[]
}

/**
 * PAGE-SHAPE-CLEANUP-1 (2026-04-23): body extracted from `./page.tsx`
 * into this private sibling. Next 14's App Router page contract
 * forbids named exports alongside the default; the ConfigHub
 * Workspace tab (gated, `dev-config-hub: false`) imports
 * `WorkspaceSettingsBody` from here now. The
 * `/workspace/[id]/settings` URL still renders this body via the
 * page's default re-export.
 */
export function WorkspaceSettingsBody() {
  const params = useParams<{ id: string }>()
  const workspaceId = params?.id as string
  const router = useRouter()
  const qc = useQueryClient()

  const { data: wsData } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => api.get<WorkspaceDetail>(`/api/workspaces/${workspaceId}`),
    enabled: !!workspaceId,
  })

  const { data: membersData } = useQuery({
    queryKey: ['workspace', workspaceId, 'members'],
    queryFn: () => api.get<Member[]>(`/api/workspaces/${workspaceId}/members`),
    enabled: !!workspaceId,
  })

  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  useEffect(() => {
    if (wsData?.data) setNameDraft(wsData.data.name)
  }, [wsData?.data])

  const patchWorkspace = useMutation({
    mutationFn: (body: { name?: string; slug?: string }) =>
      api.patch(`/api/workspaces/${workspaceId}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace', workspaceId] }),
  })

  const patchMemberRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.patch(`/api/workspaces/${workspaceId}/members/${userId}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace', workspaceId, 'members'] }),
  })

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.delete(`/api/workspaces/${workspaceId}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace', workspaceId, 'members'] }),
  })

  const revokeInvite = useMutation({
    mutationFn: (inviteId: string) =>
      api.delete(`/api/workspaces/${workspaceId}/invites/${inviteId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace', workspaceId, 'members'] }),
  })

  const deleteWorkspace = useMutation({
    mutationFn: () => api.delete(`/api/workspaces/${workspaceId}`),
    onSuccess: () => router.push('/'),
  })

  const workspace = wsData?.data
  const members = membersData?.data ?? []
  const active = members.filter((m) => m.status === 'active')
  const pending = members.filter((m) => m.status === 'pending')

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--n100)' }}>
      <div className="mx-auto max-w-[900px] px-8 py-10">
        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <Link
            href={`/workspace/${workspaceId}`}
            className="text-[12px] transition-colors hover:underline"
            style={{ color: 'var(--n500)' }}
          >
            ← Back to workspace
          </Link>
        </div>

        <h1
          className="mb-2 text-[28px] leading-tight"
          style={{
            fontFamily: 'Newsreader, Georgia, serif',
            color: 'var(--n950)',
            fontWeight: 500,
          }}
        >
          Workspace Settings
        </h1>
        <p className="mb-10 text-[13px]" style={{ color: 'var(--n500)' }}>
          Manage members and workspace configuration.
        </p>

        {/* General */}
        <Section title="General">
          <div className="rounded-lg border bg-white p-5" style={{ borderColor: 'var(--n200)' }}>
            <Field label="Workspace name">
              {editingName ? (
                <input
                  type="text"
                  value={nameDraft}
                  autoFocus
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      patchWorkspace.mutate({ name: nameDraft.trim() })
                      setEditingName(false)
                    }
                    if (e.key === 'Escape') {
                      setNameDraft(workspace?.name ?? '')
                      setEditingName(false)
                    }
                  }}
                  onBlur={() => {
                    if (nameDraft.trim() && nameDraft !== workspace?.name) {
                      patchWorkspace.mutate({ name: nameDraft.trim() })
                    }
                    setEditingName(false)
                  }}
                  className="w-full max-w-sm rounded-md border bg-white px-3 py-2 text-[13px]"
                  style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
                />
              ) : (
                <button
                  onClick={() => setEditingName(true)}
                  className="text-left text-[13px] hover:underline"
                  style={{ color: 'var(--n950)' }}
                >
                  {workspace?.name ?? 'Loading…'}
                </button>
              )}
            </Field>
            <Field label="Slug">
              <span className="font-mono text-[12px]" style={{ color: 'var(--n500)' }}>
                {workspace?.slug ?? '—'}
              </span>
            </Field>
            <div className="mt-4 flex gap-6 border-t pt-4" style={{ borderColor: 'var(--n150)' }}>
              <Stat label="Members" value={active.length.toString()} />
              <Stat label="Pending invites" value={pending.length.toString()} />
              <Stat
                label="Created"
                value={
                  workspace?.createdAt ? new Date(workspace.createdAt).toLocaleDateString() : '—'
                }
              />
            </div>
          </div>
        </Section>

        {/* Members */}
        <Section
          title="Members"
          action={
            <button
              onClick={() => setInviteOpen(true)}
              className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white"
              style={{ backgroundColor: 'var(--n950)' }}
            >
              + Invite People
            </button>
          }
        >
          <div className="rounded-lg border bg-white" style={{ borderColor: 'var(--n200)' }}>
            {active.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px]" style={{ color: 'var(--n500)' }}>
                No active members.
              </div>
            ) : (
              active.map((m, idx) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  isOwner={m.userId === workspace?.ownerId}
                  borderTop={idx > 0}
                  onRoleChange={(role) =>
                    m.userId && patchMemberRole.mutate({ userId: m.userId, role })
                  }
                  onRemove={() => m.userId && removeMember.mutate(m.userId)}
                />
              ))
            )}
          </div>
        </Section>

        {/* Pending invites */}
        {pending.length > 0 && (
          <Section title="Pending Invites">
            <div className="rounded-lg border bg-white" style={{ borderColor: 'var(--n200)' }}>
              {pending.map((inv, idx) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderTop: idx > 0 ? '1px solid var(--n150)' : undefined }}
                >
                  <div>
                    <div className="text-[13px]" style={{ color: 'var(--n950)' }}>
                      {inv.inviteEmail}
                    </div>
                    <div className="text-[11px] capitalize" style={{ color: 'var(--n500)' }}>
                      {inv.role}
                    </div>
                  </div>
                  <button
                    onClick={() => revokeInvite.mutate(inv.id)}
                    className="rounded-md border bg-white px-3 py-1 text-[11px] font-medium"
                    style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Danger zone */}
        <Section title="Danger Zone" danger>
          <div className="rounded-lg border bg-white p-4" style={{ borderColor: '#FCA5A5' }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium" style={{ color: 'var(--err)' }}>
                  Delete this workspace
                </div>
                <div className="text-[11px]" style={{ color: 'var(--n500)' }}>
                  Permanently remove the workspace and all its contents.
                </div>
              </div>
              <button
                onClick={() => setDeleteOpen(true)}
                className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white"
                style={{ backgroundColor: 'var(--err)' }}
              >
                Delete
              </button>
            </div>
          </div>
        </Section>
      </div>

      {inviteOpen && workspace && (
        <InviteModal
          workspaceId={workspaceId}
          onClose={() => {
            setInviteOpen(false)
            qc.invalidateQueries({ queryKey: ['workspace', workspaceId, 'members'] })
          }}
        />
      )}

      {deleteOpen && workspace && (
        <DeleteWorkspaceModal
          name={workspace.name}
          value={deleteConfirm}
          onChange={setDeleteConfirm}
          onCancel={() => {
            setDeleteOpen(false)
            setDeleteConfirm('')
          }}
          onConfirm={() => deleteWorkspace.mutate()}
          disabled={deleteConfirm !== workspace.name || deleteWorkspace.isPending}
        />
      )}
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Section({
  title,
  action,
  children,
  danger,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center justify-between">
        <h2
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: danger ? 'var(--err)' : 'var(--n500)' }}
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <label
        className="mb-1 block text-[11px] font-medium uppercase tracking-wide"
        style={{ color: 'var(--n500)' }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--n500)' }}>
        {label}
      </div>
      <div
        className="mt-1 text-[16px]"
        style={{
          fontFamily: 'Newsreader, Georgia, serif',
          color: 'var(--n950)',
          fontWeight: 500,
        }}
      >
        {value}
      </div>
    </div>
  )
}

function MemberRow({
  member,
  isOwner,
  borderTop,
  onRoleChange,
  onRemove,
}: {
  member: Member
  isOwner: boolean
  borderTop: boolean
  onRoleChange: (role: string) => void
  onRemove: () => void
}) {
  const initials = (member.userName ?? member.userEmail ?? '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={{ borderTop: borderTop ? '1px solid var(--n150)' : undefined }}
    >
      <div
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
        style={{ backgroundColor: 'var(--ai, #6366F1)' }}
      >
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]" style={{ color: 'var(--n950)' }}>
          {member.userName ?? 'Unknown'}
        </div>
        <div className="truncate text-[11px]" style={{ color: 'var(--n500)' }}>
          {member.userEmail ?? '—'}
        </div>
      </div>
      {isOwner ? (
        <span
          className="rounded-md px-2 py-0.5 text-[11px] font-medium"
          style={{
            backgroundColor: 'var(--aiS)',
            color: 'var(--ai)',
          }}
        >
          Owner
        </span>
      ) : (
        <>
          <select
            value={member.role}
            onChange={(e) => onRoleChange(e.target.value)}
            className="rounded-md border bg-white px-2 py-1 text-[11px]"
            style={{ borderColor: 'var(--n300)' }}
          >
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            onClick={() => {
              if (confirm(`Remove ${member.userName ?? 'this member'}?`)) onRemove()
            }}
            className="rounded-md p-1 text-[14px] hover:bg-gray-100"
            style={{ color: 'var(--n400)' }}
            aria-label="Remove member"
          >
            ×
          </button>
        </>
      )}
    </div>
  )
}

function InviteModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'editor' | 'viewer'>('editor')
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    setError(null)
    const result = await api.post<{ inviteToken: string }>(
      `/api/workspaces/${workspaceId}/invite`,
      { email, role }
    )
    setSending(false)
    if (result.data?.inviteToken) {
      const origin =
        typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
      setInviteUrl(`${origin}/invite/${result.data.inviteToken}`)
    } else {
      setError('Could not send invite. Please try again.')
    }
  }

  const handleCopy = () => {
    if (inviteUrl) navigator.clipboard.writeText(inviteUrl)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
    >
      <div
        className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl"
        style={{ borderColor: 'var(--n200)' }}
      >
        <h3
          className="mb-2 text-[18px]"
          style={{
            fontFamily: 'Newsreader, Georgia, serif',
            color: 'var(--n950)',
            fontWeight: 500,
          }}
        >
          Invite someone
        </h3>
        {inviteUrl ? (
          <>
            <p className="mb-3 text-[12px]" style={{ color: 'var(--n500)' }}>
              Invite sent. Share this link with them:
            </p>
            <div
              className="mb-4 flex items-center gap-2 rounded-md border bg-white p-2"
              style={{ borderColor: 'var(--n200)' }}
            >
              <input
                readOnly
                value={inviteUrl}
                className="flex-1 bg-transparent font-mono text-[11px] focus:outline-none"
                style={{ color: 'var(--n700)' }}
              />
              <button
                onClick={handleCopy}
                className="rounded-md px-2 py-1 text-[11px] font-medium text-white"
                style={{ backgroundColor: 'var(--n950)' }}
              >
                Copy
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="rounded-md border bg-white px-4 py-2 text-[12px] font-medium"
                style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSend}>
            {error && (
              <div
                className="mb-3 rounded-md border px-3 py-2 text-[12px]"
                style={{
                  backgroundColor: 'var(--errS)',
                  borderColor: '#FCA5A5',
                  color: 'var(--err)',
                }}
              >
                {error}
              </div>
            )}
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="name@company.com"
                className="w-full rounded-md border bg-white px-3 py-2 text-[13px]"
                style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
              />
            </Field>
            <Field label="Role">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                className="w-full rounded-md border bg-white px-3 py-2 text-[13px]"
                style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border bg-white px-4 py-2 text-[12px] font-medium"
                style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sending || !email}
                className="rounded-md px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--n950)' }}
              >
                {sending ? 'Sending…' : 'Send Invite'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function DeleteWorkspaceModal({
  name,
  value,
  onChange,
  onCancel,
  onConfirm,
  disabled,
}: {
  name: string
  value: string
  onChange: (v: string) => void
  onCancel: () => void
  onConfirm: () => void
  disabled: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
    >
      <div
        className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl"
        style={{ borderColor: 'var(--n200)' }}
      >
        <h3
          className="mb-2 text-[18px]"
          style={{
            fontFamily: 'Newsreader, Georgia, serif',
            color: 'var(--n950)',
            fontWeight: 500,
          }}
        >
          Delete this workspace?
        </h3>
        <p className="mb-4 text-[13px]" style={{ color: 'var(--n500)' }}>
          This cannot be undone. Type <strong>{name}</strong> to confirm.
        </p>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={name}
          className="mb-4 w-full rounded-md border bg-white px-3 py-2 text-[13px]"
          style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border bg-white px-4 py-2 text-[12px] font-medium"
            style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={disabled}
            className="rounded-md px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--err)' }}
          >
            Delete workspace
          </button>
        </div>
      </div>
    </div>
  )
}

export default WorkspaceSettingsBody
