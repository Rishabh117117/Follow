'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { signOut } from 'next-auth/react'
import { useState, useEffect } from 'react'
import { api, API_BASE } from '@/lib/api-client'
import type { UserSettings } from '@workspace/shared/types'

interface MeData {
  user: {
    id: string
    email: string
    name: string
    avatarUrl: string | null
    image: string | null
  }
  profile: {
    settings: UserSettings
    promptPreferences: Record<string, unknown>
    knownFacts: unknown[]
  }
  statePersistent: Record<string, unknown> | null
}

interface AccountRow {
  provider: string
  type: string
}

/**
 * PAGE-SHAPE-CLEANUP-1 (2026-04-23): body extracted from `./page.tsx`
 * into this private sibling. Next 14's App Router page contract
 * forbids named exports alongside the default; the ConfigHub Profile
 * tab (gated, `dev-config-hub: false`) imports `ProfileSettingsBody`
 * from here now. The `/settings/profile` URL still renders this body
 * via the page's default re-export.
 */
export function ProfileSettingsBody() {
  const qc = useQueryClient()
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeData>('/api/users/me'),
  })
  const { data: accountsResp } = useQuery({
    queryKey: ['me', 'accounts'],
    queryFn: () => api.get<AccountRow[]>('/api/users/me/accounts'),
  })

  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [bioDraft, setBioDraft] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  useEffect(() => {
    if (me?.data) {
      setNameDraft(me.data.user.name)
      setBioDraft(me.data.profile.settings.bio ?? '')
    }
  }, [me?.data])

  const patchMe = useMutation({
    mutationFn: (body: { name?: string; settings?: Partial<UserSettings> }) =>
      api.patch('/api/users/me', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })

  const deleteMe = useMutation({
    mutationFn: () => api.delete('/api/users/me'),
    onSuccess: () => signOut({ callbackUrl: '/auth/login' }),
  })

  const handleSaveName = () => {
    if (nameDraft.trim() && nameDraft !== me?.data?.user.name) {
      patchMe.mutate({ name: nameDraft.trim() })
    }
    setEditingName(false)
  }

  const handleSaveBio = () => {
    if (bioDraft !== (me?.data?.profile.settings.bio ?? '')) {
      patchMe.mutate({ settings: { bio: bioDraft } })
    }
  }

  const handleExport = async () => {
    window.open(`${API_BASE}/api/users/me/export`, '_blank')
  }

  const user = me?.data?.user
  const settings = me?.data?.profile.settings ?? {}
  const persistent = me?.data?.statePersistent ?? {}
  const accounts = accountsResp?.data ?? []

  // Work patterns from statePersistent
  const workStyle =
    getNestedString(persistent, 'workStyle') ?? getNestedString(persistent, 'workStyle', 'type')
  const productiveStart = getNestedNumber(persistent, 'productiveHours', 'start')
  const productiveEnd = getNestedNumber(persistent, 'productiveHours', 'end')
  const avgSession = getNestedNumber(persistent, 'avgSessionDuration')
  const aiAcceptance = getNestedNumber(persistent, 'aiPreferences', 'acceptanceRate')
  const collabStyle = getNestedString(persistent, 'collaborationStyle')

  const hasPatterns = workStyle !== null || productiveStart !== null || avgSession !== null

  const initials = (user?.name ?? 'U')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="space-y-10">
      <Header title="Profile" subtitle="Manage your personal information and account." />

      {/* Avatar + name + email */}
      <section>
        <div className="flex items-start gap-5">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full text-[24px] font-semibold text-white"
            style={{ backgroundColor: 'var(--ai, #6366F1)' }}
          >
            {initials}
          </div>
          <div className="flex flex-col gap-1 pt-1">
            <button
              disabled
              title="Coming soon"
              className="rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                borderColor: 'var(--n200)',
                color: 'var(--n500)',
                backgroundColor: 'white',
                cursor: 'not-allowed',
              }}
            >
              Upload
            </button>
            <span className="text-[10px]" style={{ color: 'var(--n400)' }}>
              Coming soon
            </span>
          </div>
        </div>

        {/* Name (inline edit) */}
        <Field label="Name">
          {editingName ? (
            <input
              type="text"
              value={nameDraft}
              autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName()
                if (e.key === 'Escape') {
                  setNameDraft(user?.name ?? '')
                  setEditingName(false)
                }
              }}
              onBlur={handleSaveName}
              className="w-full max-w-sm rounded-md border bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-1"
              style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
            />
          ) : (
            <button
              onClick={() => setEditingName(true)}
              className="text-left text-[13px] hover:underline"
              style={{ color: 'var(--n950)' }}
            >
              {user?.name ?? 'Loading…'}
            </button>
          )}
        </Field>

        <Field label="Email">
          <span className="text-[13px]" style={{ color: 'var(--n500)' }}>
            {user?.email ?? 'Loading…'}
          </span>
        </Field>

        <Field label="Bio">
          <textarea
            value={bioDraft}
            onChange={(e) => {
              if (e.target.value.length <= 280) setBioDraft(e.target.value)
            }}
            onBlur={handleSaveBio}
            rows={3}
            placeholder="A short description about you…"
            className="w-full max-w-lg rounded-md border bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-1"
            style={{ borderColor: 'var(--n200)', color: 'var(--n950)' }}
          />
          <div
            className="mt-1 text-[10px]"
            style={{ color: bioDraft.length >= 260 ? 'var(--err)' : 'var(--n400)' }}
          >
            {bioDraft.length} / 280
          </div>
        </Field>
        {settings ? null : null}
      </section>

      {/* Work Patterns */}
      <section>
        <SectionHeading>Work Patterns</SectionHeading>
        {hasPatterns ? (
          <div className="rounded-lg border bg-white p-4" style={{ borderColor: 'var(--n200)' }}>
            <Pattern label="Peak hours" value={formatHours(productiveStart, productiveEnd)} />
            <Pattern label="Work style" value={workStyle ?? '—'} />
            <Pattern
              label="AI acceptance"
              value={aiAcceptance !== null ? `${Math.round(aiAcceptance * 100)}%` : '—'}
            />
            <Pattern
              label="Avg session"
              value={avgSession !== null ? `${Math.round(avgSession)} minutes` : '—'}
            />
            <Pattern label="Collaboration" value={collabStyle ?? '—'} />
            <p
              className="mt-3 pt-3 text-[10px] italic"
              style={{ color: 'var(--n400)', borderTop: '1px solid var(--n150)' }}
            >
              Learned from your activity · Updated hourly
            </p>
          </div>
        ) : (
          <p
            className="rounded-lg border bg-white p-4 text-[12px] italic"
            style={{ borderColor: 'var(--n200)', color: 'var(--n500)' }}
          >
            Follow hasn&rsquo;t learned your patterns yet. Keep working and check back.
          </p>
        )}
      </section>

      {/* Connected Accounts */}
      <section>
        <SectionHeading>Connected Accounts</SectionHeading>
        <div className="rounded-lg border bg-white" style={{ borderColor: 'var(--n200)' }}>
          {['google', 'github', 'email'].map((provider, idx) => {
            const connected = accounts.some((a) => a.provider === provider)
            return (
              <div
                key={provider}
                className="flex items-center justify-between px-4 py-3"
                style={{ borderTop: idx > 0 ? '1px solid var(--n150)' : undefined }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: connected ? 'var(--ok, #22C55E)' : 'var(--n300)',
                    }}
                  />
                  <span className="text-[13px] capitalize" style={{ color: 'var(--n950)' }}>
                    {provider}
                  </span>
                </div>
                <span
                  className="text-[11px]"
                  style={{ color: connected ? 'var(--n500)' : 'var(--n400)' }}
                >
                  {connected ? 'Connected' : 'Not connected'}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {/* Danger Zone */}
      <section>
        <SectionHeading danger>Danger Zone</SectionHeading>
        <div className="rounded-lg border bg-white p-4" style={{ borderColor: '#FCA5A5' }}>
          <div className="flex items-center justify-between pb-4">
            <div>
              <div className="text-[13px] font-medium" style={{ color: 'var(--n950)' }}>
                Export your data
              </div>
              <div className="text-[11px]" style={{ color: 'var(--n500)' }}>
                Download a JSON file with all your documents, conversations, and AI state.
              </div>
            </div>
            <button
              onClick={handleExport}
              className="rounded-md border bg-white px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-gray-50"
              style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
            >
              Export
            </button>
          </div>
          <div
            className="flex items-center justify-between pt-4"
            style={{ borderTop: '1px solid var(--n150)' }}
          >
            <div>
              <div className="text-[13px] font-medium" style={{ color: 'var(--err)' }}>
                Delete account
              </div>
              <div className="text-[11px]" style={{ color: 'var(--n500)' }}>
                Permanently remove your account and anonymize your data.
              </div>
            </div>
            <button
              onClick={() => setDeleteOpen(true)}
              className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white transition-colors"
              style={{ backgroundColor: 'var(--err)' }}
            >
              Delete
            </button>
          </div>
        </div>
      </section>

      {deleteOpen && (
        <DeleteModal
          email={user?.email ?? ''}
          value={deleteConfirm}
          onChange={setDeleteConfirm}
          onCancel={() => {
            setDeleteOpen(false)
            setDeleteConfirm('')
          }}
          onConfirm={() => deleteMe.mutate()}
          disabled={deleteConfirm !== (user?.email ?? '_') || deleteMe.isPending}
        />
      )}
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getNested(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj
  for (const k of keys) {
    if (cur && typeof cur === 'object' && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k]
    } else {
      return null
    }
  }
  return cur
}

function getNestedString(obj: unknown, ...keys: string[]): string | null {
  const v = getNested(obj, ...keys)
  return typeof v === 'string' ? v : null
}

function getNestedNumber(obj: unknown, ...keys: string[]): number | null {
  const v = getNested(obj, ...keys)
  return typeof v === 'number' ? v : null
}

function formatHours(start: number | null, end: number | null): string {
  if (start === null || end === null) return '—'
  const fmt = (h: number) => {
    const hour = h % 12 || 12
    const ampm = h >= 12 ? 'PM' : 'AM'
    return `${hour}${ampm}`
  }
  return `${fmt(start)} – ${fmt(end)}`
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="mb-2">
      <h1
        className="text-[28px] leading-tight"
        style={{
          fontFamily: 'Newsreader, Georgia, serif',
          color: 'var(--n950)',
          fontWeight: 500,
        }}
      >
        {title}
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--n500)' }}>
        {subtitle}
      </p>
    </header>
  )
}

function SectionHeading({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <h2
      className="mb-3 text-[11px] font-semibold uppercase tracking-wider"
      style={{ color: danger ? 'var(--err)' : 'var(--n500)' }}
    >
      {children}
    </h2>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
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

function Pattern({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-[12px]" style={{ color: 'var(--n500)' }}>
        {label}
      </span>
      <span className="text-[13px]" style={{ color: 'var(--n950)' }}>
        {value}
      </span>
    </div>
  )
}

function DeleteModal({
  email,
  value,
  onChange,
  onCancel,
  onConfirm,
  disabled,
}: {
  email: string
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
          Delete your account
        </h3>
        <p className="mb-4 text-[13px]" style={{ color: 'var(--n500)' }}>
          This will anonymize your account data. Type your email{' '}
          <span className="font-mono text-[12px]" style={{ color: 'var(--n950)' }}>
            {email}
          </span>{' '}
          to confirm.
        </p>
        <input
          type="email"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={email}
          className="mb-4 w-full rounded-md border bg-white px-3 py-2 text-[13px] focus:outline-none"
          style={{ borderColor: 'var(--n200)', color: 'var(--n950)' }}
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
            Delete account
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProfileSettingsBody
