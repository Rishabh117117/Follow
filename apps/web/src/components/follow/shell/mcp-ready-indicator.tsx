'use client'

/**
 * McpReadyIndicator (STABILIZE-3)
 *
 * Sits at the bottom of the dashboard sidebar. Polls the API for:
 *   - How many items are indexed (from /api/health → index.records / rawFiles)
 *   - Whether the MCP server has any live Claude client connected
 *   - Whether the current user has an MCP API key provisioned
 *
 * States:
 *   gray  "MCP: not set up"       — no API key for this user
 *   amber "Indexing N files…"     — key exists, records still 0 or growing
 *   green "MCP ready ✓"           — ≥1 indexed record, key exists
 *
 * Clicking opens a small popover showing a copyable claude_desktop_config.json
 * snippet the user can paste into Claude Desktop to talk to *their* Follow
 * workspace via MCP.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, authFetch } from '@/lib/api-client'

interface HealthPayload {
  status: string
  checks: Record<string, { status: string }>
  mcp: {
    tools: number
    activeSessions: number
    clients: Array<{ name: string; transport: string; lastSeen: string; callCount: number }>
  }
  index: {
    records: number
    rawFiles: number
    /** Files with at least one chunk stored — monotonic, persistent across restarts. */
    filesIndexed?: number
    chunks?: number
    edges: number
    contradictions: number
  }
  config: { publicUrl: string | null }
}

interface AgentStatus {
  connected: boolean
  keyPrefix?: string
}

interface QueueStats {
  pending: number
  processing: number
  completed: number
  failed: number
  cancelled: number
  total: number
  paused: boolean
  /** Queue is in the "stopped" state (persists across restarts). */
  stopped: boolean
  /** How many sources were snapshotted at stop time — available for jump-start. */
  stoppedSnapshotSize: number
  /** Running total of actual USD billed across visible jobs. */
  spentUsd: number
  /** Forward estimate of remaining pending+processing USD. */
  estimatedRemainingUsd: number
  completedLastMin: number
  completedLast5Min: number
  enqueuedLastMin: number
  enqueuedLast5Min: number
  throughputJobsPerSec: number
  netPendingChangePerSec: number
  medianJobDurationMs: number
  avgJobDurationMs: number
}

export function McpReadyIndicator() {
  const [open, setOpen] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [provisionedKey, setProvisionedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  // Polls every 5s while open, every 20s otherwise
  const health = useQuery({
    queryKey: ['mcp-indicator', 'health'],
    queryFn: async () => {
      const res = await authFetch('/api/health', { cache: 'no-store' })
      return (await res.json()) as HealthPayload
    },
    refetchInterval: open ? 5_000 : 20_000,
    retry: false,
  })

  // Does this user have a desktop-agent key?
  const agentStatus = useQuery({
    queryKey: ['mcp-indicator', 'agent-status'],
    queryFn: async () => {
      const res = await api.get<AgentStatus>('/api/agents/status')
      return res.data ?? { connected: false }
    },
    refetchInterval: open ? 10_000 : 30_000,
    retry: false,
  })

  // Live queue state — source of truth for "is indexing actually happening".
  // The legacy `index.records` counter lags; queue stats tell us whether work
  // is in flight right now, what the throughput is, and whether it's paused.
  const queueStats = useQuery({
    queryKey: ['mcp-indicator', 'queue-stats'],
    queryFn: async () => {
      const res = await authFetch('/api/index-queue/stats', { cache: 'no-store' })
      return ((await res.json())?.data ?? null) as QueueStats | null
    },
    refetchInterval: open ? 2_000 : 10_000,
    retry: false,
  })

  const hasKey = agentStatus.data?.connected === true
  const rawFiles = health.data?.index.rawFiles ?? 0
  const chunks = health.data?.index.chunks ?? 0
  const filesIndexed = health.data?.index.filesIndexed ?? 0
  const sessions = health.data?.mcp.activeSessions ?? 0
  const publicUrl = health.data?.config.publicUrl ?? null

  const qs = queueStats.data
  const pending = qs?.pending ?? 0
  const processing = qs?.processing ?? 0
  const remaining = pending + processing
  const throughput = qs?.throughputJobsPerSec ?? 0
  const enqueueRate = qs?.enqueuedLastMin ? qs.enqueuedLastMin / 60 : 0
  const netDrain = throughput - enqueueRate
  const paused = qs?.paused ?? false
  const stopped = qs?.stopped ?? false
  const snapshotSize = qs?.stoppedSnapshotSize ?? 0
  const spentUsd = qs?.spentUsd ?? 0
  const estRemainingUsd = qs?.estimatedRemainingUsd ?? 0

  // ── Persistent progress accounting ─────────────────────────────────────
  // `filesIndexed` is a DB count (DISTINCT source_id in document_chunks) —
  // monotonic, survives API restarts, survives the queue array being pruned.
  // This is the authoritative "how much work has actually been done" number.
  //
  // Total = max of (files already indexed + work remaining) and rawFiles ever
  // uploaded. Ensures the denominator never shrinks under the numerator and
  // captures files still in the queue but not yet in document_chunks.
  const totalFiles = Math.max(filesIndexed + remaining, rawFiles, 1)
  const pct = Math.min(100, Math.round((filesIndexed / totalFiles) * 100))

  // ── Anti-flicker state hold ────────────────────────────────────────────
  const HOLD_MS = 5_000
  const lastBusyAtRef = useRef<number>(0)
  if (remaining > 0 || paused || stopped) lastBusyAtRef.current = Date.now()
  const recentlyBusy = Date.now() - lastBusyAtRef.current < HOLD_MS

  const state: 'gray' | 'amber' | 'green' = useMemo(() => {
    if (!hasKey) return 'gray'
    if (rawFiles === 0) return 'amber'
    // A stopped queue is not "ready" — it's awaiting a user decision.
    // Keep amber so the Stopped label + Jump start button stay visible.
    if (remaining > 0 || recentlyBusy || stopped || paused) return 'amber'
    return 'green'
  }, [hasKey, rawFiles, remaining, recentlyBusy, stopped, paused])

  const label: string = useMemo(() => {
    if (state === 'gray') return 'MCP: not set up'
    if (state === 'amber') {
      // Stop is stronger than pause — show it first so the user can't misread
      // a full halt as a pause that'll auto-resume.
      if (stopped) {
        return snapshotSize > 0
          ? `Stopped · ${snapshotSize} in snapshot`
          : `Stopped · ${remaining} queued`
      }
      if (paused) return `Paused · ${remaining} queued`
      if (remaining > 0) return `Indexing ${remaining} file${remaining === 1 ? '' : 's'}…`
      if (rawFiles > 0) return 'Processing…'
      return 'Waiting for files…'
    }
    return 'MCP ready'
  }, [state, remaining, rawFiles, paused, stopped, snapshotSize])

  // Format the ETA from throughput + net drain (same approach as Banner/Index tab)
  const etaLabel = useMemo(() => {
    if (stopped) return 'stopped'
    if (remaining === 0) return 'idle'
    if (paused) return 'paused'
    if (throughput <= 0) return 'measuring…'
    const rate = netDrain > 0.01 ? netDrain : throughput
    const sec = remaining / rate
    const suffix = netDrain <= 0.01 && enqueueRate > throughput ? ' (uploading)' : ''
    if (sec < 60) return `~${Math.round(sec)}s${suffix}`
    if (sec < 3600) return `~${Math.round(sec / 60)}m${suffix}`
    return `~${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m${suffix}`
  }, [remaining, paused, stopped, throughput, netDrain, enqueueRate])

  // Click outside to close
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // When the popover opens, mint a fresh desktop-agent key so we can show
  // the full config JSON (the raw key is returned only once by provision).
  useEffect(() => {
    if (!open || !hasKey || provisionedKey) return
    ;(async () => {
      try {
        const res = await authFetch('/api/agents/provision', { method: 'POST' })
        if (!res.ok) return
        const body = (await res.json()) as { data?: { apiKey: string } }
        if (body.data?.apiKey) setProvisionedKey(body.data.apiKey)
      } catch {
        /* noop */
      }
    })()
  }, [open, hasKey, provisionedKey])

  const mcpEndpoint = publicUrl || 'http://localhost:3001'
  const claudeDesktopConfig = provisionedKey
    ? JSON.stringify(
        {
          mcpServers: {
            follow: {
              url: `${mcpEndpoint}/mcp`,
              headers: {
                Authorization: `Bearer ${provisionedKey}`,
              },
            },
          },
        },
        null,
        2
      )
    : null

  const copy = async () => {
    if (!claudeDesktopConfig) return
    await navigator.clipboard.writeText(claudeDesktopConfig)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const dotBg =
    state === 'green' ? '#2d8a4e' : state === 'amber' ? '#b7791f' : 'var(--n300, #b8b3ab)'

  return (
    <div style={{ position: 'relative' }} ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mcp-strip-btn"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 6,
          width: '100%',
          padding: state === 'amber' ? '10px 14px 12px' : '8px 14px',
          background: open
            ? 'rgba(108,99,255,0.06)'
            : state === 'amber'
              ? 'rgba(183,121,31,0.05)'
              : 'transparent',
          border: 'none',
          borderTop: '1px solid var(--n150, #e5e2de)',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'Inter, sans-serif',
          transition: 'background 120ms ease',
        }}
        title="Click to view stats and queue controls"
        aria-expanded={open}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              display: 'inline-block',
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: dotBg,
              flexShrink: 0,
              boxShadow: state === 'amber' ? '0 0 0 3px #b7791f33' : undefined,
              animation: state === 'amber' ? 'mcp-pulse 1.2s ease-in-out infinite' : undefined,
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--n800, #332e25)', fontWeight: 500, flex: 1 }}>
            {label}
          </span>
          {state === 'green' && (
            <span style={{ fontSize: 10, color: 'var(--n500, #807a70)' }}>
              {sessions > 0 ? `${sessions} live` : 'idle'}
            </span>
          )}
          {state === 'amber' && (
            <span
              style={{
                fontSize: 10,
                fontFamily: 'ui-monospace, Menlo, monospace',
                color: stopped ? '#b53f3f' : paused ? '#807a70' : '#b7791f',
              }}
            >
              {stopped ? 'stopped' : paused ? 'paused' : `${pct}% · ${etaLabel}`}
            </span>
          )}
          {/* Explicit affordance — small chevron rotates when the popover is open. */}
          <span
            aria-hidden
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              marginLeft: 2,
              color: 'var(--n500, #807a70)',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 150ms ease',
              fontSize: 10,
            }}
          >
            ▲
          </span>
        </div>

        {/* Inline progress bar while indexing */}
        {state === 'amber' && totalFiles > 1 && (
          <div
            style={{
              height: 3,
              borderRadius: 2,
              background: 'rgba(183,121,31,0.15)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: paused ? '#b8b3ab' : '#b7791f',
                transition: 'width 600ms ease',
              }}
            />
          </div>
        )}
      </button>

      <style jsx>{`
        @keyframes mcp-pulse {
          0%,
          100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.2);
            opacity: 0.7;
          }
        }
        :global(.mcp-strip-btn:hover) {
          background: rgba(108, 99, 255, 0.04) !important;
        }
      `}</style>

      {open && (
        <div
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: 'calc(100% + 6px)',
            background: '#fff',
            borderRadius: 10,
            border: '1px solid var(--n150, #e5e2de)',
            boxShadow: '0 10px 28px rgba(0,0,0,0.1)',
            padding: 14,
            zIndex: 80,
            fontFamily: 'Inter, sans-serif',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: dotBg,
              }}
            />
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--n950, #111)' }}>{label}</div>
          </div>

          {/* Prominent "done / total" hero — the single most useful number. */}
          {hasKey && totalFiles > 1 && (
            <div
              style={{
                background: 'var(--n50, #f5f4f2)',
                border: '1px solid var(--n150, #e5e2de)',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
                <span
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    color: 'var(--n950,#111)',
                    fontFamily: 'ui-monospace, Menlo, monospace',
                  }}
                >
                  {filesIndexed.toLocaleString()}
                </span>
                <span style={{ fontSize: 12, color: 'var(--n500,#807a70)' }}>
                  of {totalFiles.toLocaleString()} files indexed
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 11,
                    fontFamily: 'ui-monospace, Menlo, monospace',
                    color: state === 'amber' ? '#b7791f' : '#2d8a4e',
                    fontWeight: 500,
                  }}
                >
                  {pct}%
                </span>
              </div>
              <div
                style={{
                  height: 4,
                  borderRadius: 2,
                  background: 'rgba(0,0,0,0.06)',
                  overflow: 'hidden',
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: paused ? '#b8b3ab' : state === 'amber' ? '#b7791f' : '#2d8a4e',
                    transition: 'width 600ms ease',
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--n500,#807a70)',
                  fontFamily: 'ui-monospace, Menlo, monospace',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  {processing} processing · {pending} queued
                </span>
                <span>{remaining > 0 ? `${remaining} to go` : 'caught up'}</span>
              </div>
            </div>
          )}

          {/* Detail stats grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              marginBottom: 12,
              fontSize: 11,
              color: 'var(--n500, #807a70)',
            }}
          >
            <Stat label="Chunks stored" value={chunks.toLocaleString()} />
            <Stat label="Raw files uploaded" value={rawFiles.toLocaleString()} />
            <Stat label="Live MCP clients" value={sessions} />
            <Stat
              label="Server"
              value={health.data?.status === 'healthy' ? 'ok' : health.data?.status || '—'}
              color={health.data?.status === 'healthy' ? '#2d8a4e' : '#b7791f'}
            />
          </div>

          {/* Queue controls — also render while stopped so the user can jump-start
              even when `remaining` is 0 (jobs were cancelled, snapshot holds them). */}
          {hasKey && (remaining > 0 || paused || stopped) && (
            <QueueControls
              paused={paused}
              stopped={stopped}
              snapshotSize={snapshotSize}
              spentUsd={spentUsd}
              estRemainingUsd={estRemainingUsd}
              onChange={() => queueStats.refetch()}
            />
          )}

          {/* Throughput line — real numbers from the queue, not a static "nothing indexed" claim */}
          {hasKey && (remaining > 0 || throughput > 0) && (
            <div
              style={{
                fontSize: 10,
                fontFamily: 'ui-monospace, Menlo, monospace',
                color: 'var(--n500, #807a70)',
                marginBottom: 10,
                lineHeight: 1.5,
              }}
            >
              {throughput.toFixed(2)} files/s done · {enqueueRate.toFixed(2)} files/s added · ETA{' '}
              {etaLabel}
              {qs?.medianJobDurationMs
                ? ` · median ${Math.round(qs.medianJobDurationMs / 1000)}s/file`
                : ''}
            </div>
          )}

          {state === 'gray' && (
            <div style={{ fontSize: 11, color: 'var(--n500, #807a70)', lineHeight: 1.5 }}>
              No Desktop Agent key provisioned yet. Visit{' '}
              <a href="/settings/agents" style={{ color: '#6C63FF', textDecoration: 'underline' }}>
                Settings → Desktop Agent
              </a>{' '}
              to connect.
            </div>
          )}

          {/* Empty-state copy only when truly empty (no files uploaded, nothing in flight) */}
          {state === 'amber' && rawFiles === 0 && remaining === 0 && (
            <div style={{ fontSize: 11, color: 'var(--n500, #807a70)', lineHeight: 1.5 }}>
              Your agent key is live but no files have been uploaded yet. Add files in the main
              panel or drop a folder path in{' '}
              <a href="/settings/agents" style={{ color: '#6C63FF', textDecoration: 'underline' }}>
                Settings → Desktop Agent
              </a>
              .
            </div>
          )}

          {state === 'green' && claudeDesktopConfig && (
            <>
              <div style={{ fontSize: 11, color: 'var(--n500, #807a70)', marginBottom: 6 }}>
                Paste this into your <code>claude_desktop_config.json</code>:
              </div>
              <pre
                style={{
                  background: 'var(--n50, #f5f4f2)',
                  border: '1px solid var(--n150, #e5e2de)',
                  borderRadius: 6,
                  padding: 8,
                  fontSize: 10,
                  fontFamily: 'ui-monospace, Menlo, monospace',
                  color: 'var(--n800, #332e25)',
                  margin: 0,
                  whiteSpace: 'pre',
                  overflow: 'auto',
                  maxHeight: 160,
                }}
              >
                {showKey
                  ? claudeDesktopConfig
                  : claudeDesktopConfig.replace(/(Bearer )(wsp_[a-f0-9]{6})[a-f0-9]+/, '$1$2…')}
              </pre>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={copy}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    background: '#6C63FF',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 11,
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  {copied ? 'Copied ✓' : 'Copy config'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  style={{
                    padding: '6px 10px',
                    background: 'transparent',
                    border: '1px solid var(--n200, #d4d0ca)',
                    borderRadius: 6,
                    fontSize: 11,
                    color: 'var(--n600, #666054)',
                    cursor: 'pointer',
                  }}
                >
                  {showKey ? 'Hide key' : 'Show key'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function QueueControls({
  paused,
  stopped,
  snapshotSize,
  spentUsd,
  estRemainingUsd,
  onChange,
}: {
  paused: boolean
  stopped: boolean
  snapshotSize: number
  spentUsd: number
  estRemainingUsd: number
  onChange: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const call = async (action: 'pause' | 'resume' | 'stop' | 'jump-start') => {
    setBusy(true)
    setErr(null)
    try {
      const res = await authFetch(`/api/index-queue/${action}`, { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        throw new Error(body?.error?.message || `${action} failed (HTTP ${res.status})`)
      }
      onChange()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const confirmStop = () => {
    if (
      window.confirm(
        'Stop and cancel every pending/processing index job?\n\nThe queue will stay stopped across app restarts until you press "Jump start".'
      )
    ) {
      void call('stop')
    }
  }

  // Three distinct presentations. Stopped is the loudest — it's the one the
  // user has to act on, and it must NOT look like a pause.
  const bg = stopped
    ? 'rgba(181,63,63,0.10)'
    : paused
      ? 'rgba(184,179,171,0.15)'
      : 'rgba(183,121,31,0.08)'
  const borderColor = stopped
    ? 'rgba(181,63,63,0.35)'
    : paused
      ? 'var(--n200, #d4d0ca)'
      : 'rgba(183,121,31,0.3)'
  const statusLabel = stopped ? '⏹ Stopped' : paused ? '⏸ Paused' : '▶ Running'

  const formatUsd = (v: number) => {
    if (v >= 1) return '$' + v.toFixed(2)
    if (v >= 0.01) return '$' + v.toFixed(3)
    return '$' + v.toFixed(5)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: 10,
        padding: 8,
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        alignItems: 'center',
      }}
    >
      <span style={{ fontSize: 11, color: 'var(--n800,#332e25)', flex: 1, fontWeight: 500 }}>
        {statusLabel}
        {stopped && snapshotSize > 0 && (
          <span style={{ color: 'var(--n500,#807a70)', fontWeight: 400 }}>
            {' · '}
            {snapshotSize} in snapshot
          </span>
        )}
      </span>
      {stopped ? (
        <button
          type="button"
          onClick={() => void call('jump-start')}
          disabled={busy}
          style={controlBtnStyle('primary')}
          title="Re-enqueue the snapshotted sources and resume indexing"
        >
          {busy ? '…' : 'Jump start'}
        </button>
      ) : paused ? (
        <button
          type="button"
          onClick={() => void call('resume')}
          disabled={busy}
          style={controlBtnStyle('primary')}
        >
          {busy ? '…' : 'Resume'}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void call('pause')}
          disabled={busy}
          style={controlBtnStyle('ghost')}
        >
          {busy ? '…' : 'Pause'}
        </button>
      )}
      {!stopped && (
        <button
          type="button"
          onClick={confirmStop}
          disabled={busy}
          style={controlBtnStyle('danger')}
          title="Cancel every queued and running job. State persists across restarts."
        >
          Stop all
        </button>
      )}
      {(spentUsd > 0 || estRemainingUsd > 0) && (
        <div
          style={{
            width: '100%',
            fontSize: 10,
            color: 'var(--n500,#807a70)',
            fontFamily: 'ui-monospace, Menlo, monospace',
            marginTop: 4,
          }}
        >
          spent <strong style={{ color: 'var(--n800,#332e25)' }}>{formatUsd(spentUsd)}</strong>
          {estRemainingUsd > 0 && ` · est remaining ${formatUsd(estRemainingUsd)}`}
        </div>
      )}
      {err && (
        <div style={{ width: '100%', fontSize: 10, color: '#b53f3f', marginTop: 6 }}>{err}</div>
      )}
    </div>
  )
}

function controlBtnStyle(kind: 'primary' | 'ghost' | 'danger'): CSSProperties {
  const base: CSSProperties = {
    padding: '4px 10px',
    fontSize: 11,
    borderRadius: 4,
    cursor: 'pointer',
    fontWeight: 500,
    border: '1px solid transparent',
  }
  if (kind === 'primary')
    return { ...base, background: '#6C63FF', color: '#fff', borderColor: '#6C63FF' }
  if (kind === 'danger')
    return {
      ...base,
      background: 'transparent',
      color: '#b53f3f',
      borderColor: 'rgba(181,63,63,0.35)',
    }
  return {
    ...base,
    background: 'transparent',
    color: 'var(--n700,#4a443a)',
    borderColor: 'var(--n200,#d4d0ca)',
  }
}

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div
      style={{
        background: 'var(--n50, #f5f4f2)',
        borderRadius: 6,
        padding: '6px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: color ?? 'var(--n800, #332e25)',
          fontFamily: 'ui-monospace, Menlo, monospace',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 9,
          color: 'var(--n400, #9c968d)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
    </div>
  )
}
