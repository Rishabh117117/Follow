'use client'

/**
 * ProjectOverview — v9 dashboard for an active project index.
 *
 * Wires the new dashboard layout (mockup/project-dashboard.html) to the live
 * APIs. Mounts inside FollowMain when sidebarView === 'overview' and the
 * active index is a project (not personal).
 *
 * Sections:
 *   1. Project Index card — Description / Scope / Memory (collapsible stack)
 *   2. Files row + GWS Files row
 *   3. Members cards (derived from contributors until space_members lands)
 *   4. Recents (activity feed)
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api-client'
import { useIndexStore } from '@/stores/index-store'
import { useFollowDashboardStore } from '@/stores/follow-dashboard-store'
import { AddToIndexModal } from '@/components/follow/modals/add-to-index-modal'
import { ItemsSection } from './items-section'

// ─────────────────────────────────────────────────────────────────────────────
// Types — minimal local shapes to avoid coupling to package internals.
// ─────────────────────────────────────────────────────────────────────────────

interface SpaceData {
  id: string
  name: string
  description?: string | null
  icon?: string | null
  color?: string | null
  isProject?: boolean
  metadata?: Record<string, unknown> | null
  createdAt?: string
  documents?: Array<{
    id: string
    title: string | null
    docType: string | null
    addedAt?: string
  }>
  conversations?: Array<{
    id: string
    title: string | null
    userId: string
    updatedAt: string
    user?: {
      id: string
      name: string | null
      email: string | null
      avatarUrl: string | null
    } | null
  }>
}

interface RawFile {
  id: string
  fileName: string
  mimeType?: string | null
  sourceType?: string | null
  updatedAt?: string
  createdAt?: string
  size?: number | null
}

interface MemorySection {
  id: string
  name: string
  content: string
  updatedAt?: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface MemoryVersion {
  id: string
  version: number
  generatedAt?: string
  sections?: MemorySection[]
}

interface ActivityEvent {
  id: string
  time: string
  type: string
  threadId: string
  userId?: string | null
  metadata?: Record<string, unknown> | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level component
// ─────────────────────────────────────────────────────────────────────────────

export function ProjectOverview() {
  const activeIndex = useIndexStore((s) => s.indexes.find((i) => i.id === s.activeIndexId))
  const spaceId = activeIndex?.id

  if (!activeIndex) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        Loading index…
      </div>
    )
  }

  if (activeIndex.type === 'personal') {
    return <PersonalOverview />
  }

  if (!spaceId) return null

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: '#FAFAF9' }}>
      <div className="mx-auto max-w-[960px] px-12 pb-24 pt-8">
        <ProjectHeader spaceId={spaceId} fallbackName={activeIndex.name} />
        <ProjectIndexCard spaceId={spaceId} />
        <FilesRow spaceId={spaceId} />
        <GwsFilesRow spaceId={spaceId} />
        <ItemsSection />
        <MembersRow spaceId={spaceId} />
        <RecentsRow spaceId={spaceId} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

function ProjectHeader({ spaceId, fallbackName }: { spaceId: string; fallbackName: string }) {
  const { data } = useQuery({
    queryKey: ['space', spaceId],
    queryFn: async () => (await api.get<SpaceData>(`/api/spaces/${spaceId}`)).data,
    staleTime: 30_000,
  })

  const space = data ?? { id: spaceId, name: fallbackName }
  const initials = (space.name ?? fallbackName).slice(0, 1).toUpperCase()

  return (
    <header className="mb-7">
      <div className="mb-1 text-xs text-neutral-500">Workspace · Projects</div>
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-[10px] font-semibold text-white"
          style={{ background: 'linear-gradient(135deg,#6C63FF,#EC4899)' }}
        >
          {initials}
        </div>
        <h1 className="text-[22px] font-semibold">{space.name ?? fallbackName}</h1>
      </div>
      {space.createdAt ? (
        <div className="mt-1 pl-12 text-xs text-neutral-500">
          Created {new Date(space.createdAt).toLocaleDateString()}
        </div>
      ) : null}
    </header>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Index card — Description / Scope / Memory
// ─────────────────────────────────────────────────────────────────────────────

function ProjectIndexCard({ spaceId }: { spaceId: string }) {
  // Scope is workspace-level, not project-level (keyed by userId+workspaceId
  // server-side), so it lives in the sidebar — see <ScopePanel /> mounted in
  // dash-sidebar.tsx. Per-project cards stay focused on description + memory.
  return (
    <section className="mb-6">
      <SectionHeader title="Project Index" />
      <div className="flex flex-col gap-2.5">
        <DescriptionPanel spaceId={spaceId} />
        <MemoryPanel spaceId={spaceId} />
      </div>
    </section>
  )
}

function DescriptionPanel({ spaceId }: { spaceId: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftDesc, setDraftDesc] = useState('')

  const { data } = useQuery({
    queryKey: ['space', spaceId],
    queryFn: async () => (await api.get<SpaceData>(`/api/spaces/${spaceId}`)).data,
    staleTime: 30_000,
  })

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string | null> = {}
      if (draftName.trim() && draftName !== data?.name) payload.name = draftName.trim()
      if (draftDesc !== (data?.description ?? '')) payload.description = draftDesc.trim() || null
      if (Object.keys(payload).length === 0) return null
      return (await api.patch<SpaceData>(`/api/spaces/${spaceId}`, payload)).data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space', spaceId] })
      setEditing(false)
    },
  })

  const startEdit = () => {
    setDraftName(data?.name ?? '')
    setDraftDesc(data?.description ?? '')
    setEditing(true)
    if (!open) setOpen(true)
  }

  return (
    <PxCard
      open={open}
      onToggle={() => setOpen((o) => !o)}
      icon="📝"
      title="Description"
      meta={
        data?.metadata?.lastEditedAt
          ? `edited ${formatRelative(String(data.metadata.lastEditedAt))}`
          : undefined
      }
      action={editing ? 'Cancel' : 'Edit'}
      onAction={editing ? () => setEditing(false) : startEdit}
    >
      {editing ? (
        <>
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Project name
            </div>
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm"
              placeholder="Project name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Summary
            </div>
            <textarea
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              rows={3}
              className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm"
              placeholder="What is this project about?"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={save.isPending || !draftName.trim()}
              onClick={() => save.mutate()}
              className="rounded-md bg-[#6C63FF] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600"
            >
              Cancel
            </button>
            {save.error ? (
              <span className="text-[11px] text-red-600">
                {save.error instanceof Error ? save.error.message : 'Save failed'}
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <Field label="Project name" value={data?.name ?? '—'} />
          <Field label="Summary" value={data?.description || 'No description set yet.'} />
          <FieldGrid>
            <Field compact label="Visibility" value={data?.isProject ? 'Project' : 'Space'} />
            <Field
              compact
              label="Created"
              value={data?.createdAt ? new Date(data.createdAt).toLocaleDateString() : '—'}
            />
          </FieldGrid>
        </>
      )}
    </PxCard>
  )
}

interface MemoryProfile {
  id: string
  indexId: string
  name: string
}

function MemoryPanel({ spaceId }: { spaceId: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(true)

  // GET /api/memory/sections returns the latest version's sections directly
  // (data: MemorySection[]). Profile + version metadata come from separate
  // endpoints — we fetch the profile so Regenerate can target it.
  const { data: sections } = useQuery({
    queryKey: ['memory-sections', spaceId],
    queryFn: async () =>
      (await api.get<MemorySection[]>(`/api/memory/sections?indexId=${spaceId}`)).data ?? [],
    staleTime: 30_000,
  })

  const { data: profiles } = useQuery({
    queryKey: ['memory-profiles', spaceId],
    queryFn: async () =>
      (await api.get<MemoryProfile[]>(`/api/memory/profiles?indexId=${spaceId}`)).data ?? [],
    staleTime: 60_000,
  })

  const profileId = profiles?.[0]?.id ?? null

  const regenerate = useMutation({
    mutationFn: async () => {
      if (!profileId) throw new Error('No memory profile yet')
      return (await api.post(`/api/memory/profiles/${profileId}/generate`, { indexId: spaceId }))
        .data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memory-sections', spaceId] })
    },
  })

  const list = sections ?? []
  const summary = list.find((s) => /summary|recent/i.test(s.name))?.content

  return (
    <PxCard
      open={open}
      onToggle={() => setOpen((o) => !o)}
      icon="⧉"
      title="Memory"
      meta={
        regenerate.isPending
          ? 'regenerating…'
          : list.length > 0
            ? `${list.length} sections`
            : 'no memory yet'
      }
      action={regenerate.isPending ? 'Regenerating…' : 'Regenerate'}
      onAction={() => regenerate.mutate()}
    >
      <Field
        label="Recent Project Memory Summary (auto-digested)"
        value={summary ?? 'Memory has not been generated yet.'}
      />
      {list.length > 0 ? (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Sections
          </div>
          <div className="grid grid-cols-4 gap-2">
            {list.slice(0, 8).map((s) => (
              <div
                key={s.id}
                className="cursor-pointer rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 hover:bg-neutral-100"
              >
                <div className="text-xs font-medium">{s.name}</div>
                <div className="mt-0.5 text-[11px] text-neutral-500">{s.content.length} chars</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {regenerate.error ? (
        <div className="text-[11px] text-red-600">
          {regenerate.error instanceof Error ? regenerate.error.message : 'Regenerate failed'}
        </div>
      ) : null}
    </PxCard>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Files & GWS rows
// ─────────────────────────────────────────────────────────────────────────────

function FilesRow({ spaceId }: { spaceId: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ['raw-files', spaceId],
    queryFn: async () =>
      (await api.get<RawFile[]>(`/api/raw-files?spaceId=${spaceId}&limit=24`)).data ?? [],
    staleTime: 15_000,
  })

  const files = (data ?? []).filter((f) => f.sourceType !== 'chat_artifact')

  return (
    <section className="mb-3">
      <SectionHeader title="Files" />
      <FilesPanel
        open={open}
        onToggle={() => setOpen((o) => !o)}
        onAdd={() => setAddOpen(true)}
        title="Uploaded files"
        count={files.length}
      >
        <FileGrid>
          {files.map((f) => (
            <FileTile key={f.id} fileName={f.fileName} mimeType={f.mimeType ?? ''} />
          ))}
        </FileGrid>
        {files.length === 0 ? <EmptyHint label="No files yet — drag & drop, or click +" /> : null}
      </FilesPanel>
      {addOpen ? (
        <AddToIndexModal
          indexLabel="Project"
          spaceId={spaceId}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            queryClient.invalidateQueries({ queryKey: ['raw-files', spaceId] })
            queryClient.invalidateQueries({ queryKey: ['space', spaceId] })
          }}
        />
      ) : null}
    </section>
  )
}

function GwsFilesRow({ spaceId }: { spaceId: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ['space', spaceId],
    queryFn: async () => (await api.get<SpaceData>(`/api/spaces/${spaceId}`)).data,
    staleTime: 30_000,
  })

  const docs = (data?.documents ?? []).filter((d) =>
    ['google_docs', 'google_sheets', 'google_slides'].includes(d.docType ?? '')
  )

  return (
    <>
      <FilesPanel
        open={open}
        onToggle={() => setOpen((o) => !o)}
        onAdd={() => setAddOpen(true)}
        title="Google Workspace files"
        count={docs.length}
      >
        <FileGrid>
          {docs.map((d) => (
            <FileTile key={d.id} fileName={d.title ?? 'Untitled'} mimeType={d.docType ?? ''} />
          ))}
        </FileGrid>
        {docs.length === 0 ? <EmptyHint label="No Google Workspace files added — click +" /> : null}
      </FilesPanel>
      {addOpen ? (
        // Open the modal pre-routed to the GWS step by toggling step state from
        // the inside is not exposed; users land on "choose" and pick Drive. We
        // could lift `initialStep` later if this turns out friction-prone.
        <AddToIndexModal
          indexLabel="Project"
          spaceId={spaceId}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            queryClient.invalidateQueries({ queryKey: ['space', spaceId] })
          }}
        />
      ) : null}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Members
// ─────────────────────────────────────────────────────────────────────────────
// There is no space_members / project_members table yet — workspace-level
// membership (workspaceMembers) is the only persisted relation. We derive the
// per-project member set from chat conversations in the space because:
//   • adding space_members would force a full invite/permissions surface area
//     (RBAC checks across files, chat, scope, MCP) before the dashboard can
//     ship, and that's a separate sprint;
//   • activity-derived membership matches what the user sees today in the
//     conversation list — no risk of surfacing "member with zero footprint".
// When space_members lands, swap the source here for /api/spaces/:id/members
// and add an explicit role badge per card.

function MembersRow({ spaceId }: { spaceId: string }) {
  const { data } = useQuery({
    queryKey: ['space', spaceId],
    queryFn: async () => (await api.get<SpaceData>(`/api/spaces/${spaceId}`)).data,
    staleTime: 30_000,
  })

  const byUser = new Map<
    string,
    {
      userId: string
      name: string | null
      email: string | null
      avatarUrl: string | null
      chats: number
      lastActive?: string
    }
  >()
  for (const c of data?.conversations ?? []) {
    const cur = byUser.get(c.userId) ?? {
      userId: c.userId,
      name: c.user?.name ?? null,
      email: c.user?.email ?? null,
      avatarUrl: c.user?.avatarUrl ?? null,
      chats: 0,
    }
    cur.chats += 1
    if (!cur.lastActive || c.updatedAt > cur.lastActive) cur.lastActive = c.updatedAt
    byUser.set(c.userId, cur)
  }
  const members = Array.from(byUser.values())

  return (
    <section className="mb-6 mt-7">
      <SectionHeader
        title="Members"
        subtitle="activity in this project — derived until space_members exists"
      />
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        {members.map((m) => (
          <MemberCard
            key={m.userId}
            userId={m.userId}
            name={m.name}
            email={m.email}
            avatarUrl={m.avatarUrl}
            chats={m.chats}
            lastActive={m.lastActive}
          />
        ))}
        <div className="flex min-h-[124px] cursor-pointer items-center justify-center rounded-xl border border-dashed border-neutral-300 text-sm text-neutral-500 hover:bg-neutral-50">
          + Invite member
        </div>
      </div>
    </section>
  )
}

function MemberCard({
  userId,
  name,
  email,
  avatarUrl,
  chats,
  lastActive,
}: {
  userId: string
  name: string | null
  email: string | null
  avatarUrl: string | null
  chats: number
  lastActive?: string
}) {
  const displayName = name?.trim() || email?.split('@')[0] || `user-${userId.slice(0, 6)}`
  const initials = displayName.slice(0, 1).toUpperCase()
  return (
    <div className="cursor-pointer rounded-xl border border-neutral-200 bg-white p-3.5 hover:border-neutral-300">
      <div className="mb-3 flex items-center gap-2.5">
        {avatarUrl ? (
          <img src={avatarUrl} alt={displayName} className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ background: hashColor(userId) }}
          >
            {initials}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{displayName}</div>
          {email ? <div className="truncate text-[10px] text-neutral-500">{email}</div> : null}
        </div>
      </div>
      <div className="flex gap-3.5 border-t border-neutral-200 pt-2.5 text-xs">
        <div>
          <b className="block text-sm font-semibold">{chats}</b>
          <span className="text-neutral-500">Chats</span>
        </div>
      </div>
      {lastActive ? (
        <div className="mt-2 text-[11px] text-neutral-500">active {formatRelative(lastActive)}</div>
      ) : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Recents
// ─────────────────────────────────────────────────────────────────────────────

function RecentsRow({ spaceId }: { spaceId: string }) {
  const setSectionFilter = useFollowDashboardStore((s) => s.setSectionFilter)
  const { data } = useQuery({
    queryKey: ['space-activity', spaceId],
    queryFn: async () =>
      (await api.get<ActivityEvent[]>(`/api/spaces/${spaceId}/activity?limit=20`)).data ?? [],
    staleTime: 10_000,
  })

  const events = data ?? []

  return (
    <section>
      <SectionHeader
        title="Recents"
        action="View activity"
        onAction={() => {
          setSectionFilter('all')
          const el = document.querySelector('[data-testid="dashboard-items-section"]')
          if (el && 'scrollIntoView' in el) {
            ;(el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        }}
      />
      <div className="rounded-xl border border-neutral-200 bg-white">
        {events.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-neutral-500">
            No activity yet — open a file or save a conversation to see it here.
          </div>
        ) : (
          events.map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 last:border-b-0"
            >
              <div
                className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                style={{ background: hashColor(e.userId ?? e.id) }}
              >
                {(e.userId ?? '·').slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 text-xs">
                <span className="font-medium">{e.type}</span>{' '}
                <span className="text-neutral-500">on thread {e.threadId.slice(0, 8)}</span>
              </div>
              <div className="w-20 text-right text-[11px] text-neutral-500">
                {formatRelative(e.time)}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Personal overview — file rows + Claude / ChatGPT / Third-party columns.
// ─────────────────────────────────────────────────────────────────────────────

interface ConnectedAccount {
  provider: string
  email?: string | null
  status?: string | null
}

interface ChatConv {
  id: string
  title: string | null
  userId: string
  workspaceId?: string
  metadata?: Record<string, unknown> | null
  updatedAt: string
}

function PersonalOverview() {
  return (
    <div className="flex-1 overflow-y-auto" style={{ background: '#FAFAF9' }}>
      <div className="mx-auto max-w-[960px] px-12 pb-24 pt-8">
        <PersonalHeader />
        <PersonalProfileCard />
        <PersonalFilesRow />
        <PersonalGwsRow />
        <ItemsSection />
        <PersonalSourcesGrid />
        <PersonalRecents />
      </div>
    </div>
  )
}

function PersonalHeader() {
  return (
    <header className="mb-7">
      <div className="mb-1 text-xs text-neutral-500">Personal workspace</div>
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-[10px] font-semibold text-white"
          style={{ background: 'linear-gradient(135deg,#FBBF24,#F59E0B)' }}
        >
          P
        </div>
        <h1 className="text-[22px] font-semibold">Personal Index</h1>
      </div>
      <div className="mt-1 pl-12 text-xs text-neutral-500">
        Your private knowledge across files, chats, and connected apps.
      </div>
    </header>
  )
}

function PersonalProfileCard() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(true)
  const [memOpen, setMemOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: async () =>
      (await api.get<{ id: string; email?: string; name?: string }>('/api/users/me')).data,
    staleTime: 60_000,
  })
  const { data: sections } = useQuery({
    queryKey: ['memory-sections', 'personal'],
    queryFn: async () =>
      (await api.get<MemorySection[]>('/api/memory/sections?indexId=personal')).data ?? [],
    staleTime: 30_000,
  })
  const { data: profiles } = useQuery({
    queryKey: ['memory-profiles', 'personal'],
    queryFn: async () =>
      (await api.get<MemoryProfile[]>('/api/memory/profiles?indexId=personal')).data ?? [],
    staleTime: 60_000,
  })

  const profileId = profiles?.[0]?.id ?? null
  const list = sections ?? []
  const summary = list.find((s) => /summary|recent/i.test(s.name))?.content

  const saveProfile = useMutation({
    mutationFn: async () => {
      if (!draftName.trim() || draftName === me?.name) return null
      return (await api.patch('/api/users/me', { name: draftName.trim() })).data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] })
      setEditing(false)
    },
  })

  const regenerate = useMutation({
    mutationFn: async () => {
      if (!profileId) throw new Error('No personal memory profile yet')
      return (await api.post(`/api/memory/profiles/${profileId}/generate`, { indexId: 'personal' }))
        .data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memory-sections', 'personal'] })
    },
  })

  const startEdit = () => {
    setDraftName(me?.name ?? '')
    setEditing(true)
    if (!open) setOpen(true)
  }

  return (
    <section className="mb-6">
      <SectionHeader title="About you" />
      <div className="flex flex-col gap-2.5">
        <PxCard
          open={open}
          onToggle={() => setOpen((o) => !o)}
          icon="👤"
          title="Profile"
          action={editing ? 'Cancel' : 'Edit'}
          onAction={editing ? () => setEditing(false) : startEdit}
        >
          {editing ? (
            <>
              <div className="flex flex-col gap-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Name
                </div>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Email
                </div>
                <div className="text-sm text-neutral-500">
                  {me?.email ?? '—'} <span className="text-[10px]">(read-only)</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={saveProfile.isPending || !draftName.trim()}
                  onClick={() => saveProfile.mutate()}
                  className="rounded-md bg-[#6C63FF] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {saveProfile.isPending ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600"
                >
                  Cancel
                </button>
                {saveProfile.error ? (
                  <span className="text-[11px] text-red-600">
                    {saveProfile.error instanceof Error ? saveProfile.error.message : 'Save failed'}
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <FieldGrid>
              <Field compact label="Name" value={me?.name ?? '—'} />
              <Field compact label="Email" value={me?.email ?? '—'} />
            </FieldGrid>
          )}
        </PxCard>

        <PxCard
          open={memOpen}
          onToggle={() => setMemOpen((o) => !o)}
          icon="⧉"
          title="Personal Memory"
          meta={
            regenerate.isPending
              ? 'regenerating…'
              : list.length > 0
                ? `${list.length} sections`
                : 'no memory yet'
          }
          action={regenerate.isPending ? 'Regenerating…' : 'Regenerate'}
          onAction={() => regenerate.mutate()}
        >
          <Field label="Recent summary" value={summary ?? 'Memory has not been generated yet.'} />
        </PxCard>
      </div>
    </section>
  )
}

function PersonalFilesRow() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ['raw-files', 'personal'],
    queryFn: async () =>
      (await api.get<RawFile[]>('/api/raw-files?spaceId=personal&limit=24')).data ?? [],
    staleTime: 15_000,
  })
  const files = (data ?? []).filter((f) => f.sourceType !== 'chat_artifact')

  return (
    <section className="mb-3">
      <SectionHeader title="Files" />
      <FilesPanel
        open={open}
        onToggle={() => setOpen((o) => !o)}
        onAdd={() => setAddOpen(true)}
        title="Uploaded files"
        count={files.length}
      >
        <FileGrid>
          {files.map((f) => (
            <FileTile key={f.id} fileName={f.fileName} mimeType={f.mimeType ?? ''} />
          ))}
        </FileGrid>
        {files.length === 0 ? <EmptyHint label="No files yet — drag & drop, or click +" /> : null}
      </FilesPanel>
      {addOpen ? (
        <AddToIndexModal
          indexLabel="Personal"
          spaceId="personal"
          onClose={() => setAddOpen(false)}
          onAdded={() => queryClient.invalidateQueries({ queryKey: ['raw-files', 'personal'] })}
        />
      ) : null}
    </section>
  )
}

function PersonalGwsRow() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  // Personal GWS file count comes from /api/gws/documents (workspace-scoped
  // tracked docs). For per-user filtering we'd need a richer endpoint — for
  // now we surface the workspace-level list, which is what the user already
  // has access to from the browser extension.
  const { data: docs } = useQuery({
    queryKey: ['gws-documents', 'all'],
    queryFn: async () =>
      (
        await api.get<Array<{ id: string; title: string | null; docType: string }>>(
          '/api/gws/documents?filter=all'
        )
      ).data ?? [],
    staleTime: 30_000,
  })
  const list = docs ?? []
  return (
    <>
      <FilesPanel
        open={open}
        onToggle={() => setOpen((o) => !o)}
        onAdd={() => setAddOpen(true)}
        title="Google Workspace files"
        count={list.length}
      >
        <FileGrid>
          {list.slice(0, 24).map((d) => (
            <FileTile key={d.id} fileName={d.title ?? 'Untitled'} mimeType={d.docType} />
          ))}
        </FileGrid>
        {list.length === 0 ? (
          <EmptyHint label="No Google Workspace files yet — click + to paste a link or browse tracked docs" />
        ) : null}
      </FilesPanel>
      {addOpen ? (
        <AddToIndexModal
          indexLabel="Personal"
          spaceId="personal"
          onClose={() => setAddOpen(false)}
          onAdded={() => queryClient.invalidateQueries({ queryKey: ['gws-documents', 'all'] })}
        />
      ) : null}
    </>
  )
}

function PersonalSourcesGrid() {
  const { data: convs } = useQuery({
    queryKey: ['personal-conversations'],
    queryFn: async () => {
      // Workspace-scoped fetch; we group by source on the client.
      const wsMatch =
        typeof window !== 'undefined'
          ? window.location.pathname.match(/\/workspace\/([0-9a-f-]{36})/)
          : null
      const workspaceId = wsMatch?.[1]
      if (!workspaceId) return []
      return (
        (await api.get<ChatConv[]>(`/api/chat/conversations?workspaceId=${workspaceId}&limit=30`))
          .data ?? []
      )
    },
    staleTime: 15_000,
  })

  const claudeConvs = (convs ?? []).filter((c) => sourceOf(c) === 'claude')
  const chatgptConvs = (convs ?? []).filter((c) => sourceOf(c) === 'chatgpt')

  const { data: accounts } = useQuery({
    queryKey: ['connected-accounts'],
    queryFn: async () => (await api.get<ConnectedAccount[]>('/api/users/me/accounts')).data ?? [],
    staleTime: 60_000,
  })

  return (
    <section className="mb-6 mt-6">
      <SectionHeader title="Connected sources" />
      <div className="grid gap-3.5" style={{ gridTemplateColumns: '1.1fr 1fr 1.4fr' }}>
        <SourceColumn
          title="Claude"
          subtitle={`${claudeConvs.length} chats`}
          color="#6C63FF"
          letter="C"
          actionLabel="+ New"
          conversations={claudeConvs}
        />
        <SourceColumn
          title="ChatGPT"
          subtitle={`${chatgptConvs.length} chats imported`}
          color="#10a37f"
          letter="G"
          actionLabel="+ Import"
          conversations={chatgptConvs}
        />
        <ThirdPartyColumn accounts={accounts ?? []} />
      </div>
    </section>
  )
}

function SourceColumn({
  title,
  subtitle,
  color,
  letter,
  actionLabel,
  conversations,
}: {
  title: string
  subtitle: string
  color: string
  letter: string
  actionLabel: string
  conversations: ChatConv[]
}) {
  return (
    <div className="flex min-h-[380px] flex-col rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3.5 flex items-center gap-2.5">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-sm font-bold text-white"
          style={{ background: color }}
        >
          {letter}
        </div>
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-[11px] text-neutral-500">{subtitle}</div>
        </div>
        <button className="ml-auto cursor-pointer rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] text-neutral-600">
          {actionLabel}
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-3 py-6 text-center text-xs text-neutral-500">
            No {title} chats yet.
          </div>
        ) : (
          conversations.slice(0, 8).map((c) => (
            <div
              key={c.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-neutral-50"
            >
              <div className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs">{c.title ?? 'Untitled'}</div>
              </div>
              <div className="flex-shrink-0 text-[10px] text-neutral-500">
                {formatRelative(c.updatedAt)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ThirdPartyColumn({ accounts }: { accounts: ConnectedAccount[] }) {
  const tiles: Array<{
    name: string
    color: string
    letter: string
    provider: string
    description: string
  }> = [
    {
      name: 'Google Drive',
      color: '#1A73E8',
      letter: 'G',
      provider: 'google',
      description: 'Files & Docs',
    },
    {
      name: 'Chrome ext.',
      color: '#4285F4',
      letter: 'C',
      provider: 'chrome',
      description: 'Page captures',
    },
    {
      name: 'Slack',
      color: '#4A154B',
      letter: 'S',
      provider: 'slack',
      description: 'Threads & saved msgs',
    },
    {
      name: 'Notion',
      color: '#000000',
      letter: 'N',
      provider: 'notion',
      description: 'Pages & databases',
    },
    {
      name: 'Perplexity',
      color: '#1FB8CD',
      letter: 'P',
      provider: 'perplexity',
      description: 'Research history',
    },
    {
      name: 'Linear',
      color: '#5E6AD2',
      letter: 'L',
      provider: 'linear',
      description: 'Issues & projects',
    },
  ]
  const connectedSet = new Set(accounts.map((a) => a.provider))

  return (
    <div className="flex min-h-[380px] flex-col rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3.5 flex items-center gap-2.5">
        <div className="text-sm font-semibold">Third-party apps</div>
        <div className="text-[11px] text-neutral-500">
          {connectedSet.size} connected · {tiles.length - connectedSet.size} available
        </div>
        <button className="ml-auto cursor-pointer rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] text-neutral-600">
          Browse all
        </button>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-2">
        {tiles.map((t) => {
          const connected = connectedSet.has(t.provider)
          return (
            <div
              key={t.provider}
              className="flex min-h-[100px] flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 hover:bg-neutral-100"
            >
              <div className="flex items-center gap-2">
                <div
                  className="flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold text-white"
                  style={{ background: t.color }}
                >
                  {t.letter}
                </div>
                <div className="text-xs font-medium">{t.name}</div>
                <div
                  className="ml-auto rounded-full px-1.5 py-0.5 text-[9px]"
                  style={{
                    background: connected ? '#DCFCE7' : '#F1F0EC',
                    color: connected ? '#047857' : '#6B6B68',
                  }}
                >
                  {connected ? 'connected' : 'connect'}
                </div>
              </div>
              <div className="text-[10px] text-neutral-500">{t.description}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PersonalRecents() {
  const setSectionFilter = useFollowDashboardStore((s) => s.setSectionFilter)
  const { data: convs } = useQuery({
    queryKey: ['personal-conversations'],
    queryFn: async () => {
      const wsMatch =
        typeof window !== 'undefined'
          ? window.location.pathname.match(/\/workspace\/([0-9a-f-]{36})/)
          : null
      const workspaceId = wsMatch?.[1]
      if (!workspaceId) return []
      return (
        (await api.get<ChatConv[]>(`/api/chat/conversations?workspaceId=${workspaceId}&limit=10`))
          .data ?? []
      )
    },
    staleTime: 15_000,
  })

  const { data: files } = useQuery({
    queryKey: ['raw-files', 'personal-recent'],
    queryFn: async () =>
      (await api.get<RawFile[]>('/api/raw-files?spaceId=personal&limit=10')).data ?? [],
    staleTime: 15_000,
  })

  // Merge + sort by updatedAt desc, take 8.
  const events: Array<{ id: string; ts: string; pill: string; pillColor: string; title: string }> =
    []
  for (const c of convs ?? []) {
    events.push({
      id: `c-${c.id}`,
      ts: c.updatedAt,
      pill: sourceOf(c),
      pillColor: sourcePillColor(sourceOf(c)),
      title: c.title ?? 'Untitled chat',
    })
  }
  for (const f of files ?? []) {
    events.push({
      id: `f-${f.id}`,
      ts: f.updatedAt ?? f.createdAt ?? '',
      pill: 'upload',
      pillColor: '#FEF3C7',
      title: f.fileName,
    })
  }
  events.sort((a, b) => (a.ts < b.ts ? 1 : -1))
  const top = events.slice(0, 8)

  return (
    <section>
      <SectionHeader
        title="Recent activity"
        action="View all"
        onAction={() => {
          setSectionFilter('all')
          const el = document.querySelector('[data-testid="dashboard-items-section"]')
          if (el && 'scrollIntoView' in el) {
            ;(el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        }}
      />
      <div className="rounded-xl border border-neutral-200 bg-white">
        {top.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-neutral-500">No activity yet.</div>
        ) : (
          top.map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-3 border-b border-neutral-200 px-4 py-2.5 last:border-b-0"
            >
              <div
                className="rounded-full px-2 py-0.5 text-[10px]"
                style={{ background: e.pillColor, color: '#525252' }}
              >
                {e.pill}
              </div>
              <div className="flex-1 truncate text-xs">{e.title}</div>
              <div className="w-20 text-right text-[11px] text-neutral-500">
                {formatRelative(e.ts)}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

function sourceOf(c: ChatConv): string {
  const m = (c.metadata ?? {}) as Record<string, unknown>
  const s = (m.source ?? m.source_tool ?? m.provider) as string | undefined
  if (!s) return 'claude'
  const lower = s.toLowerCase()
  if (lower.includes('chatgpt') || lower.includes('openai') || lower.includes('gpt'))
    return 'chatgpt'
  if (lower.includes('cursor')) return 'cursor'
  return 'claude'
}

function sourcePillColor(src: string): string {
  if (src === 'claude') return '#EFEAFF'
  if (src === 'chatgpt') return '#D1FAE5'
  if (src === 'cursor') return '#1F1F1F'
  return '#F1F0EC'
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusable building blocks
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({
  title,
  subtitle,
  action,
  onAction,
}: {
  title: string
  subtitle?: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {title}
        {subtitle ? (
          <span className="ml-1.5 font-normal normal-case tracking-normal text-neutral-500">
            · {subtitle}
          </span>
        ) : null}
      </h2>
      {action ? (
        <button
          onClick={onAction}
          disabled={!onAction}
          className="text-[11px] text-neutral-500 hover:text-neutral-900 disabled:cursor-default disabled:hover:text-neutral-500"
        >
          {action} ›
        </button>
      ) : null}
    </div>
  )
}

function PxCard({
  open,
  onToggle,
  icon,
  title,
  meta,
  badge,
  action,
  onAction,
  children,
}: {
  open: boolean
  onToggle: () => void
  icon: string
  title: string
  meta?: string
  badge?: React.ReactNode
  action?: string
  onAction?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div
        className="flex cursor-pointer items-center bg-neutral-50 px-4 py-3"
        style={{ borderBottom: open ? '1px solid #EAEAE8' : 'none' }}
        onClick={onToggle}
      >
        <div className="flex flex-1 items-center gap-2.5 text-sm font-semibold">
          <span className="text-xs text-neutral-400">{open ? '▾' : '▸'}</span>
          <span>{icon}</span>
          <span>{title}</span>
          {badge}
        </div>
        <div className="flex items-center gap-3">
          {meta ? <span className="text-[11px] text-neutral-500">{meta}</span> : null}
          {action ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onAction?.()
              }}
              className="rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50"
            >
              {action}
            </button>
          ) : null}
        </div>
      </div>
      {open ? <div className="flex flex-col gap-4 px-5 py-4">{children}</div> : null}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SubCard({
  open,
  onToggle,
  icon,
  title,
  meta,
  children,
}: {
  open: boolean
  onToggle: () => void
  icon: string
  title: string
  meta?: string
  children?: React.ReactNode
}) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-neutral-200"
      style={{ background: open ? 'white' : '#FBFAF7' }}
    >
      <div
        className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2.5"
        style={{ borderBottom: open ? '1px solid #EAEAE8' : 'none' }}
        onClick={onToggle}
      >
        <span className="text-xs text-neutral-400">{open ? '▾' : '▸'}</span>
        <span className="w-4 text-center text-sm">{icon}</span>
        <span className="text-xs font-semibold">{title}</span>
        {meta ? <span className="ml-auto text-[11px] text-neutral-500">{meta}</span> : null}
      </div>
      {open && children ? <div className="px-4 py-3.5">{children}</div> : null}
    </div>
  )
}

function FilesPanel({
  open,
  onToggle,
  onAdd,
  title,
  count,
  children,
}: {
  open: boolean
  onToggle: () => void
  onAdd?: () => void
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <div className="mb-3 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-sm font-medium">
          <span className="cursor-pointer text-xs text-neutral-400" onClick={onToggle}>
            {open ? '▾' : '▸'}
          </span>
          {title}
          <span className="ml-1 text-xs font-normal text-neutral-500">{count}</span>
        </div>
        <button
          onClick={onAdd}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-dashed border-neutral-300 bg-neutral-50 text-neutral-500 hover:bg-neutral-100"
          aria-label={`Add to ${title}`}
        >
          +
        </button>
      </div>
      {open ? children : null}
    </div>
  )
}

function FileGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="grid gap-2.5"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
    >
      {children}
    </div>
  )
}

function FileTile({ fileName, mimeType }: { fileName: string; mimeType: string }) {
  const { label, color } = fileTypeBadge(fileName, mimeType)
  return (
    <div className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 hover:bg-neutral-100">
      <div
        className="flex h-8 w-7 flex-shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
        style={{ background: color }}
      >
        {label}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium">{fileName}</div>
      </div>
    </div>
  )
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-3 py-4 text-center text-xs text-neutral-500">
      {label}
    </div>
  )
}

function Field({
  label,
  value,
  compact,
}: {
  label: string
  value: React.ReactNode
  compact?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className={compact ? 'text-xs' : 'text-sm'}>{value}</div>
    </div>
  )
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-4 gap-4">{children}</div>
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LifecycleBadge({ state }: { state: 'unscoped' | 'active' | 'live' | 'paused' | 'ended' }) {
  const styles: Record<typeof state, { bg: string; color: string; label: string }> = {
    unscoped: { bg: '#F1F0EC', color: '#6B6B68', label: '○ Unscoped' },
    active: { bg: '#DBEAFE', color: '#1D4ED8', label: '● Active' },
    live: { bg: '#DCFCE7', color: '#047857', label: '● Live' },
    paused: { bg: '#FEF3C7', color: '#B45309', label: '● Paused' },
    ended: { bg: '#F1F0EC', color: '#6B6B68', label: '○ Ended' },
  }
  const s = styles[state]
  return (
    <span
      className="ml-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

function fileTypeBadge(fileName: string, mimeType: string): { label: string; color: string } {
  const lower = fileName.toLowerCase()
  if (mimeType.includes('pdf') || lower.endsWith('.pdf')) return { label: 'PDF', color: '#DC2626' }
  if (lower.match(/\.docx?$/) || mimeType.includes('msword') || mimeType.includes('document'))
    return { label: 'DOC', color: '#2563EB' }
  if (lower.match(/\.xlsx?$/) || mimeType.includes('spreadsheet'))
    return { label: 'XLS', color: '#059669' }
  if (lower.match(/\.(png|jpe?g|gif|webp|svg)$/) || mimeType.startsWith('image/'))
    return { label: 'IMG', color: '#DB2777' }
  if (lower.endsWith('.md')) return { label: 'MD', color: '#525252' }
  if (lower.match(/\.(ts|tsx|js|jsx|py|rs|go|java)$/)) return { label: 'CODE', color: '#7C3AED' }
  if (mimeType === 'google_docs') return { label: 'G', color: '#1A73E8' }
  if (mimeType === 'google_sheets') return { label: 'G', color: '#0F9D58' }
  if (mimeType === 'google_slides') return { label: 'G', color: '#F4B400' }
  return { label: 'FILE', color: '#525252' }
}

function hashColor(seed: string): string {
  const palette = ['#6C63FF', '#10B981', '#F59E0B', '#EC4899', '#0EA5E9', '#7C3AED', '#DC2626']
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return palette[h % palette.length]!
}
