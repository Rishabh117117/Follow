'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api-client'
import type { UserSettings } from '@workspace/shared/types'

interface MeData {
  profile: {
    settings: UserSettings
    promptPreferences: {
      maxPromptsPerHour?: number
      quietHoursStart?: number | null
      quietHoursEnd?: number | null
    }
  }
  statePersistent: Record<string, unknown> | null
}

interface KnownFact {
  fact: string
  confidence: number
  source?: string
}

const DEV_WORKSPACE_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012'

function getPersistentWorkspace(): string {
  if (typeof window === 'undefined') return DEV_WORKSPACE_ID
  const m = window.location.pathname.match(/workspace\/([0-9a-f-]+)/i)
  return m?.[1] ?? DEV_WORKSPACE_ID
}

export default function AiSettingsPage() {
  const qc = useQueryClient()
  const workspaceId = getPersistentWorkspace()

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeData>('/api/users/me'),
  })

  const [clearOpen, setClearOpen] = useState(false)

  const patchSettings = useMutation({
    mutationFn: (settings: Partial<UserSettings>) =>
      api.patch('/api/users/me', { settings }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })

  const patchPreferences = useMutation({
    mutationFn: (prefs: Record<string, unknown>) =>
      api.patch(`/api/prompting/profile/preferences?workspaceId=${workspaceId}`, prefs),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })

  const deleteFact = useMutation({
    mutationFn: (idx: number) =>
      api.delete(`/api/ai-state/knowledge/${idx}?workspaceId=${workspaceId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })

  const clearAll = useMutation({
    mutationFn: () => api.delete(`/api/ai-state?workspaceId=${workspaceId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      setClearOpen(false)
    },
  })

  const settings = me?.data?.profile.settings ?? {}
  const prefs = me?.data?.profile.promptPreferences ?? {}
  const persistent = (me?.data?.statePersistent ?? {}) as Record<string, unknown>
  const knownFacts = Array.isArray(persistent['longTermKnowledge'])
    ? (persistent['longTermKnowledge'] as KnownFact[])
    : []

  const memoryEnabled = settings.memoryEnabled ?? true
  const maxPromptsPerHour = prefs.maxPromptsPerHour ?? 3
  const quietStart = prefs.quietHoursStart ?? null
  const quietEnd = prefs.quietHoursEnd ?? null

  return (
    <div className="space-y-10">
      <header>
        <h1
          className="text-[28px] leading-tight"
          style={{
            fontFamily: 'Newsreader, Georgia, serif',
            color: 'var(--n950)',
            fontWeight: 500,
          }}
        >
          AI & Memory
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--n500)' }}>
          Control what Follow remembers and when it interrupts you.
        </p>
      </header>

      {/* Memory toggle */}
      <section>
        <SectionHeading>AI Memory</SectionHeading>
        <div
          className="flex items-center justify-between rounded-lg border bg-white px-4 py-3"
          style={{ borderColor: 'var(--n200)' }}
        >
          <div>
            <div className="text-[13px]" style={{ color: 'var(--n950)' }}>
              Follow&rsquo;s AI Memory
            </div>
            <div className="text-[11px]" style={{ color: 'var(--n500)' }}>
              Learn from your activity to provide better suggestions over time.
            </div>
          </div>
          <Toggle
            checked={memoryEnabled}
            onChange={(v) => patchSettings.mutate({ memoryEnabled: v })}
          />
        </div>
      </section>

      {/* Proactive suggestions */}
      <section>
        <SectionHeading>Proactive Suggestions</SectionHeading>
        <div
          className="rounded-lg border bg-white p-4"
          style={{ borderColor: 'var(--n200)' }}
        >
          <label
            className="mb-1 block text-[12px]"
            style={{ color: 'var(--n950)' }}
          >
            Max suggestions per hour: <strong>{maxPromptsPerHour}</strong>
          </label>
          <input
            type="range"
            min={1}
            max={5}
            value={maxPromptsPerHour}
            onChange={(e) =>
              patchPreferences.mutate({ maxPromptsPerHour: Number(e.target.value) })
            }
            className="w-full max-w-md"
          />

          <div className="mt-5">
            <div className="mb-1 text-[12px]" style={{ color: 'var(--n950)' }}>
              Quiet hours
            </div>
            <div className="mb-2 text-[11px]" style={{ color: 'var(--n500)' }}>
              Follow won&rsquo;t interrupt you during these hours.
            </div>
            <div className="flex items-center gap-2">
              <select
                value={quietStart ?? ''}
                onChange={(e) =>
                  patchPreferences.mutate({
                    quietHoursStart: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                className="rounded-md border bg-white px-2 py-1 text-[12px]"
                style={{ borderColor: 'var(--n300)' }}
              >
                <option value="">—</option>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {formatHour(h)}
                  </option>
                ))}
              </select>
              <span className="text-[12px]" style={{ color: 'var(--n500)' }}>
                to
              </span>
              <select
                value={quietEnd ?? ''}
                onChange={(e) =>
                  patchPreferences.mutate({
                    quietHoursEnd: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                className="rounded-md border bg-white px-2 py-1 text-[12px]"
                style={{ borderColor: 'var(--n300)' }}
              >
                <option value="">—</option>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {formatHour(h)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Known facts */}
      <section>
        <SectionHeading>What Follow Knows</SectionHeading>
        {knownFacts.length > 0 ? (
          <div
            className="rounded-lg border bg-white"
            style={{ borderColor: 'var(--n200)' }}
          >
            {knownFacts.map((fact, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 px-4 py-3"
                style={{ borderTop: idx > 0 ? '1px solid var(--n150)' : undefined }}
              >
                <span
                  className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: confidenceColor(fact.confidence) }}
                />
                <div className="flex-1">
                  <div className="text-[13px]" style={{ color: 'var(--n950)' }}>
                    {fact.fact}
                  </div>
                  <div className="text-[10px]" style={{ color: 'var(--n400)' }}>
                    {Math.round(fact.confidence * 100)}% confidence
                    {fact.source ? ` · ${fact.source}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => deleteFact.mutate(idx)}
                  className="rounded-md p-1 text-[14px] transition-colors hover:bg-gray-100"
                  style={{ color: 'var(--n400)' }}
                  title="Delete"
                  aria-label="Delete fact"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p
            className="rounded-lg border bg-white p-4 text-[12px] italic"
            style={{ borderColor: 'var(--n200)', color: 'var(--n500)' }}
          >
            Follow hasn&rsquo;t learned any facts yet.
          </p>
        )}
      </section>

      {/* Clear memory */}
      <section>
        <SectionHeading danger>Clear Memory</SectionHeading>
        <div
          className="flex items-center justify-between rounded-lg border bg-white p-4"
          style={{ borderColor: '#FCA5A5' }}
        >
          <div>
            <div className="text-[13px] font-medium" style={{ color: 'var(--err)' }}>
              Clear all memory
            </div>
            <div className="text-[11px]" style={{ color: 'var(--n500)' }}>
              Permanently erase everything Follow has learned about you.
            </div>
          </div>
          <button
            onClick={() => setClearOpen(true)}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white"
            style={{ backgroundColor: 'var(--err)' }}
          >
            Clear
          </button>
        </div>
      </section>

      {clearOpen && (
        <ConfirmModal
          title="Clear all memory?"
          body="This will reset all 3 state layers. Follow will forget everything it has learned about you. This cannot be undone."
          confirmLabel="Clear memory"
          onCancel={() => setClearOpen(false)}
          onConfirm={() => clearAll.mutate()}
          disabled={clearAll.isPending}
        />
      )}
    </div>
  )
}

function formatHour(h: number): string {
  const hour = h % 12 || 12
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${hour}${ampm}`
}

function confidenceColor(c: number): string {
  if (c > 0.9) return '#22C55E'
  if (c > 0.7) return '#F59E0B'
  return '#EF4444'
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative h-[22px] w-[38px] flex-shrink-0 rounded-full transition-colors"
      style={{ backgroundColor: checked ? 'var(--n950)' : 'var(--n300)' }}
      role="switch"
      aria-checked={checked}
    >
      <span
        className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white transition-transform"
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
      />
    </button>
  )
}

function SectionHeading({
  children,
  danger,
}: {
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <h2
      className="mb-3 text-[11px] font-semibold uppercase tracking-wider"
      style={{ color: danger ? 'var(--err)' : 'var(--n500)' }}
    >
      {children}
    </h2>
  )
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
  disabled,
}: {
  title: string
  body: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
  disabled?: boolean
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
          {title}
        </h3>
        <p className="mb-5 text-[13px]" style={{ color: 'var(--n500)' }}>
          {body}
        </p>
        <div className="flex gap-2 justify-end">
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
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
