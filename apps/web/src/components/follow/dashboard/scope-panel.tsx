'use client'

/**
 * ScopePanel — workspace-level scope surface.
 *
 * Scope is keyed by (userId, workspaceId), not by space, so it lives in the
 * sidebar (or any workspace-level surface) rather than inside the per-project
 * dashboard card. Switching projects does not change the active scope.
 *
 * Three input modes as a collapsible stack:
 *   • Visual builder    — render boundaries as rows
 *   • Natural language  — POST /api/scope/parse-nl → preview → save
 *   • JSON              — read-only serialized view
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api-client'

export interface ScopeBoundary {
  dimension: string
  op: string
  value?: unknown
  values?: unknown[]
  window?: { type: 'relative' | 'absolute'; days?: number; from?: string; to?: string }
  name?: string
}

export interface ScopeState {
  scope: {
    scope_id?: string
    name?: string
    mode?: 'live' | 'static'
    persists_until?: string
    boundaries: ScopeBoundary[]
  } | null
  lifecycle: { active: boolean; paused: boolean; ended: boolean; mode: 'live' | 'static' }
}

export type LifecycleState = 'unscoped' | 'active' | 'live' | 'paused' | 'ended'

export function ScopePanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(defaultOpen)
  const [visualOpen, setVisualOpen] = useState(true)
  const [nlOpen, setNlOpen] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [nlText, setNlText] = useState('')
  const [nlWarning, setNlWarning] = useState<string | null>(null)
  const [nlPreview, setNlPreview] = useState<ScopeBoundary[] | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['scope-active'],
    queryFn: async () => (await api.get<ScopeState>('/api/scope/active')).data,
    staleTime: 10_000,
  })

  const boundaries = data?.scope?.boundaries ?? []
  const lifecycle = data?.lifecycle ?? {
    active: false,
    paused: false,
    ended: false,
    mode: 'static' as const,
  }
  const lifecycleState: LifecycleState = lifecycle.ended
    ? 'ended'
    : lifecycle.paused
      ? 'paused'
      : !lifecycle.active
        ? 'unscoped'
        : lifecycle.mode === 'live'
          ? 'live'
          : 'active'

  const setScope = useMutation({
    mutationFn: async (input: { boundaries: ScopeBoundary[]; mode: 'live' | 'static' }) =>
      (await api.post<ScopeState>('/api/scope', { action: 'set', ...input })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scope-active'] }),
  })

  const parseNl = useMutation({
    mutationFn: async (text: string) =>
      (
        await api.post<{ boundaries: ScopeBoundary[]; warning: string | null }>(
          '/api/scope/parse-nl',
          { text }
        )
      ).data,
    onSuccess: (res) => {
      setNlWarning(res?.warning ?? null)
      setNlPreview(res?.boundaries ?? [])
    },
  })

  const togglePause = useMutation({
    mutationFn: async () => {
      const path = lifecycle.paused ? '/api/scope/resume' : '/api/scope/pause'
      return (await api.post<ScopeState>(path, {})).data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scope-active'] }),
  })

  const scopeJson = data?.scope ?? {
    scope_id: 'workspace_scope',
    name: 'Unscoped',
    mode: 'static' as const,
    persists_until: 'session_end',
    boundaries: [],
  }

  // Compact sidebar header — shows lifecycle + boundary count.
  return (
    <div className="border-t border-[var(--n150,#e5e2de)] bg-white/50">
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-[11px]"
        onClick={() => setOpen((o) => !o)}
        data-testid="scope-panel-toggle"
      >
        <span className="text-neutral-400">{open ? '▾' : '▸'}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Scope
        </span>
        <LifecycleBadge state={lifecycleState} />
        <span className="ml-auto text-neutral-500">
          {isLoading ? '…' : `${boundaries.length}`}
        </span>
      </div>

      {open ? (
        <div className="flex flex-col gap-1.5 px-2.5 pb-3">
          {lifecycle.active ? (
            <button
              onClick={() => togglePause.mutate()}
              className="self-start rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] text-neutral-600"
            >
              {lifecycle.paused ? '▶ Resume' : '⏸ Pause'}
            </button>
          ) : null}

          <SubCard
            open={visualOpen}
            onToggle={() => setVisualOpen((o) => !o)}
            icon="⊞"
            title="Visual"
            meta={`${boundaries.length}`}
          >
            {boundaries.length === 0 ? (
              <Hint label="No boundaries. Use NL or add manually." />
            ) : (
              <div className="flex flex-col gap-1">
                {boundaries.map((b, i) => (
                  <BoundaryRow key={`${b.dimension}-${i}`} boundary={b} />
                ))}
              </div>
            )}
          </SubCard>

          <SubCard
            open={nlOpen}
            onToggle={() => setNlOpen((o) => !o)}
            icon="✨"
            title="NL"
            meta="MICRO_MODEL"
          >
            <textarea
              value={nlText}
              onChange={(e) => setNlText(e.target.value)}
              placeholder="e.g. high-confidence facts from the last 30 days about pricing"
              className="h-16 w-full resize-none rounded border border-neutral-200 bg-white p-2 text-[11px]"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                disabled={!nlText.trim() || parseNl.isPending}
                onClick={() => parseNl.mutate(nlText.trim())}
                className="rounded bg-[#6C63FF] px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-40"
              >
                {parseNl.isPending ? 'Parsing…' : 'Parse'}
              </button>
              {nlWarning ? (
                <span className="text-[10px] text-amber-700">{nlWarning}</span>
              ) : null}
            </div>

            {nlPreview ? (
              <div className="mt-2 rounded border border-neutral-200 bg-neutral-50 p-2">
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-neutral-500">
                  Preview ({nlPreview.length})
                </div>
                {nlPreview.length === 0 ? (
                  <div className="text-[10px] text-neutral-500">No boundaries extracted.</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {nlPreview.map((b, i) => (
                      <BoundaryRow key={`p-${i}`} boundary={b} />
                    ))}
                  </div>
                )}
                <div className="mt-2 flex gap-1.5">
                  <button
                    disabled={nlPreview.length === 0 || setScope.isPending}
                    onClick={() => {
                      setScope.mutate(
                        { boundaries: nlPreview, mode: lifecycle.mode ?? 'static' },
                        { onSuccess: () => setNlPreview(null) }
                      )
                    }}
                    className="rounded bg-[#6C63FF] px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-40"
                  >
                    {setScope.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => setNlPreview(null)}
                    className="rounded border border-neutral-200 bg-white px-2 py-0.5 text-[10px] text-neutral-600"
                  >
                    Discard
                  </button>
                </div>
              </div>
            ) : null}
          </SubCard>

          <SubCard
            open={jsonOpen}
            onToggle={() => setJsonOpen((o) => !o)}
            icon="{ }"
            title="JSON"
          >
            <pre className="overflow-x-auto rounded bg-neutral-900 p-2 font-mono text-[9px] leading-snug text-neutral-100">
              {JSON.stringify(scopeJson, null, 2)}
            </pre>
          </SubCard>
        </div>
      ) : null}
    </div>
  )
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

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
  children: React.ReactNode
}) {
  return (
    <div
      className="overflow-hidden rounded border border-neutral-200"
      style={{ background: open ? 'white' : '#FBFAF7' }}
    >
      <div
        className="flex cursor-pointer items-center gap-1.5 px-2 py-1.5"
        style={{ borderBottom: open ? '1px solid #EAEAE8' : 'none' }}
        onClick={onToggle}
      >
        <span className="text-[10px] text-neutral-400">{open ? '▾' : '▸'}</span>
        <span className="text-[11px]">{icon}</span>
        <span className="text-[11px] font-semibold">{title}</span>
        {meta ? <span className="ml-auto text-[10px] text-neutral-500">{meta}</span> : null}
      </div>
      {open ? <div className="px-2 py-2">{children}</div> : null}
    </div>
  )
}

function BoundaryRow({ boundary }: { boundary: ScopeBoundary }) {
  const value = boundary.window
    ? JSON.stringify(boundary.window)
    : boundary.values
      ? JSON.stringify(boundary.values)
      : String(boundary.value ?? '')
  return (
    <div className="flex items-center gap-1.5 rounded border border-neutral-200 bg-neutral-50 px-1.5 py-1 font-mono text-[10px]">
      <span className="font-semibold text-[#6C63FF]">{boundary.dimension}</span>
      <span className="text-neutral-500">{boundary.op}</span>
      <span className="flex-1 truncate text-neutral-900">{value}</span>
    </div>
  )
}

function Hint({ label }: { label: string }) {
  return (
    <div className="rounded border border-dashed border-neutral-300 bg-neutral-50 px-2 py-2 text-center text-[10px] text-neutral-500">
      {label}
    </div>
  )
}

function LifecycleBadge({ state }: { state: LifecycleState }) {
  const styles: Record<LifecycleState, { bg: string; color: string; label: string }> = {
    unscoped: { bg: '#F1F0EC', color: '#6B6B68', label: '○' },
    active: { bg: '#DBEAFE', color: '#1D4ED8', label: '●' },
    live: { bg: '#DCFCE7', color: '#047857', label: '●' },
    paused: { bg: '#FEF3C7', color: '#B45309', label: '●' },
    ended: { bg: '#F1F0EC', color: '#6B6B68', label: '○' },
  }
  const s = styles[state]
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label} {state}
    </span>
  )
}
