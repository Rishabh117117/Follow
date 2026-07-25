'use client'

/**
 * IndexingBanner (STABILIZE-3)
 *
 * Prominent toast at the bottom-right of the workspace while the Desktop
 * Agent is uploading files. Auto-hides when indexing completes (records
 * catches up to raw files) or the user dismisses it.
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { authFetch } from '@/lib/api-client'

interface QueueStats {
  pending: number
  processing: number
  completed: number
  failed: number
  cancelled: number
  total: number
  paused: boolean
  completedLastMin: number
  completedLast5Min: number
  avgJobDurationMs: number
  medianJobDurationMs: number
  enqueuedLastMin: number
  enqueuedLast5Min: number
  throughputJobsPerSec: number
  netPendingChangePerSec: number
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h}h ${m}m`
}

function formatEta(ms: number | null): string {
  if (ms === null || ms <= 0) return 'estimating…'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `~${sec}s left`
  if (sec < 3600) return `~${Math.round(sec / 60)}m left`
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return `~${h}h ${m}m left`
}

interface HealthIndex {
  filesIndexed?: number
  rawFiles: number
}

export function IndexingBanner() {
  const [dismissed, setDismissed] = useState(false)

  // Queue stats give us throughput + in-flight counts.
  const queue = useQuery({
    queryKey: ['indexing-banner', 'stats'],
    queryFn: async () => {
      const res = await authFetch(`/api/index-queue/stats`, { cache: 'no-store' })
      const stats = (await res.json())?.data as QueueStats | null
      return { stats }
    },
    refetchInterval: 2_000,
    retry: false,
  })

  // Health gives us the authoritative persistent counter: filesIndexed.
  const health = useQuery({
    queryKey: ['indexing-banner', 'health-index'],
    queryFn: async () => {
      const res = await authFetch(`/api/health`, { cache: 'no-store' })
      const j = await res.json()
      return (j?.index ?? { rawFiles: 0, filesIndexed: 0 }) as HealthIndex
    },
    refetchInterval: 3_000,
    retry: false,
  })

  const stats = queue.data?.stats
  const totalPending = stats?.pending ?? 0
  const totalProcessing = stats?.processing ?? 0
  const totalRemaining = totalPending + totalProcessing

  const filesIndexed = health.data?.filesIndexed ?? 0
  const rawFiles = health.data?.rawFiles ?? 0
  const totalFiles = Math.max(filesIndexed + totalRemaining, rawFiles, 1)

  // Elapsed time counter
  const startRef = useRef<number | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (totalRemaining > 0 && startRef.current === null) startRef.current = Date.now()
    if (totalRemaining === 0 && startRef.current !== null) startRef.current = null
  }, [totalRemaining])
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

  // Re-arm dismissal when a fresh batch arrives after the queue was empty.
  const prevRemainingRef = useRef(0)
  useEffect(() => {
    if (prevRemainingRef.current === 0 && totalRemaining > 0) setDismissed(false)
    prevRemainingRef.current = totalRemaining
  }, [totalRemaining])

  // Progress from persistent DB counter — never resets.
  const pct = Math.min(100, Math.round((filesIndexed / totalFiles) * 100))

  // ── Throughput-based ETA ──
  // The API gives us jobs/sec computed over a rolling window of real
  // completions — no need for medians or chunk math. ETA = remaining / rate.
  const throughput = stats?.throughputJobsPerSec ?? 0 // jobs/sec across all workers
  const enqueueRate = stats?.enqueuedLastMin ? stats.enqueuedLastMin / 60 : 0 // jobs/sec being added
  // Net drain rate. If positive, we're catching up; if zero or negative, we're falling behind.
  const netDrainPerSec = throughput - enqueueRate

  let aggregateEtaMs: number | null = null
  let etaQualifier = ''
  if (totalRemaining === 0) {
    aggregateEtaMs = 0
  } else if (throughput > 0) {
    if (netDrainPerSec > 0.01) {
      // Catching up: ETA = remaining / netDrain
      aggregateEtaMs = Math.round((totalRemaining / netDrainPerSec) * 1000)
    } else {
      // Falling behind or break-even: best we can offer is "ETA at current
      // throughput, ignoring new enqueues". Mark it as such.
      aggregateEtaMs = Math.round((totalRemaining / throughput) * 1000)
      etaQualifier = enqueueRate > throughput ? ' (still uploading)' : ''
    }
  }

  const indexing = totalRemaining > 0 && pct < 100
  if (!indexing || dismissed) return null

  const elapsedSec = startRef.current ? Math.floor((now - startRef.current) / 1000) : 0
  const elapsedLabel = formatElapsed(elapsedSec)
  const etaLabel = formatEta(aggregateEtaMs) + etaQualifier

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 320,
        background: '#fff',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 12,
        boxShadow: '0 10px 32px rgba(0,0,0,0.12)',
        padding: 14,
        zIndex: 90,
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              display: 'inline-block',
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: '#b7791f',
              boxShadow: '0 0 0 3px #b7791f33',
              animation: 'indexing-pulse 1.2s ease-in-out infinite',
            }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--n950,#111)',
            }}
          >
            Indexing your files
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: 16,
            color: 'var(--n400,#9c968d)',
            cursor: 'pointer',
            padding: 2,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div
        style={{
          fontSize: 11,
          color: 'var(--n500,#807a70)',
          marginBottom: 8,
          lineHeight: 1.45,
        }}
      >
        <strong style={{ color: 'var(--n950,#111)' }}>{filesIndexed.toLocaleString()}</strong> of{' '}
        {totalFiles.toLocaleString()} files indexed · {totalProcessing} processing · {totalPending}{' '}
        queued
        <br />
        <span style={{ color: '#b7791f' }}>
          {elapsedLabel} elapsed · {etaLabel}
        </span>
        {throughput > 0 && (
          <>
            <br />
            <span
              style={{
                color: 'var(--n400,#9c968d)',
                fontFamily: 'ui-monospace,monospace',
                fontSize: 10,
              }}
            >
              {throughput.toFixed(2)} files/s done · {enqueueRate.toFixed(2)} files/s added
            </span>
          </>
        )}
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: 'rgba(183,121,31,0.15)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: '#b7791f',
            transition: 'width 600ms ease',
          }}
        />
      </div>

      <div
        style={{
          marginTop: 8,
          fontSize: 10,
          color: 'var(--n400,#9c968d)',
          fontFamily: 'ui-monospace, Menlo, monospace',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>{pct}%</span>
        <span>
          {filesIndexed.toLocaleString()}/{totalFiles.toLocaleString()} files
        </span>
      </div>

      <style jsx>{`
        @keyframes indexing-pulse {
          0%,
          100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.25);
            opacity: 0.7;
          }
        }
      `}</style>
    </div>
  )
}
