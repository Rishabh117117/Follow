'use client'

import type React from 'react'
import { useQuery } from '@tanstack/react-query'
import { authFetch } from '../../../lib/api-client'
import type { ItemType } from '@/stores/follow-dashboard-store'

// ─── Source pills ──────────────────────────────────────────────────────────

export const SOURCE_CONFIG: Record<string, { bg: string; fg: string; label: string }> = {
  claude: { bg: 'rgba(108,99,255,0.15)', fg: '#6C63FF', label: 'Claude' },
  chatgpt: { bg: 'rgba(16,163,127,0.15)', fg: '#10a37f', label: 'ChatGPT' },
  'follow-web': { bg: 'rgba(108,99,255,0.15)', fg: '#6C63FF', label: 'Follow' },
  'follow-notebook': { bg: 'rgba(108,99,255,0.15)', fg: '#6C63FF', label: 'Notebook' },
  local: { bg: 'rgba(45,138,78,0.15)', fg: '#2d8a4e', label: 'Local' },
  gws: { bg: 'rgba(14,116,144,0.15)', fg: '#0e7490', label: 'Google' },
  upload: { bg: 'rgba(183,121,31,0.15)', fg: '#b7791f', label: 'Upload' },
}

// ─── Unified item types ────────────────────────────────────────────────────

export interface UnifiedItem {
  id: string
  it: ItemType
  title: string
  source: string
  time: string
  preview?: string
  confidence?: number
  raw: Record<string, unknown>
}

// Sprint MCP-3: per-raw-file indexing status returned by
// GET /api/index/items/status?ids=
export interface IndexFileStatus {
  upload: 'uploaded' | 'missing'
  index: 'not_indexed' | 'queued' | 'indexing' | 'indexed' | 'failed' | 'cancelled'
  phase?: string
  chunksDone?: number
  chunksTotal?: number
  etaMs?: number | null
  jobId?: string
  errorMessage?: string
}

export function formatTime(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return d.toLocaleDateString()
}

/**
 * Normalize a conversation title for grouping purposes. Strips trailing
 * `(v2)`, `(v3)`, … suffixes (test scripts append these manually when
 * re-running save_conversation) and collapses whitespace. Two conversations
 * with titles "foo" and "foo (v2)" share the same normalized key and are
 * clubbed into one sidebar row.
 */
export function normalizeGroupTitle(title: string): string {
  return title
    .replace(/\s*\(v\d+\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// ─── Watched-folders hook ─────────────────────────────────────────────────
//
// The Desktop Agent launcher (on :4000) owns `follow-agent.config.json` and
// is the source of truth for which folders are being followed. We poll it
// lightly so the "Stop following" button's armed/disarmed state stays
// honest even when another client modifies the config (e.g. the settings
// page or a manual edit).

export interface WatchedFolder {
  path: string
  preset?: string
  recursive?: boolean
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

// Global auto-index flag. Persisted server-side in data/queue-state.json so
// a restart doesn't silently un-pause indexing. The query polls lightly so
// changes made by another client (the dev console, another tab) reflect
// here within ~5s.
export function useAutoIndex() {
  return useQuery({
    queryKey: ['auto-index'],
    queryFn: async () => {
      const res = await authFetch('/api/index-queue/auto-index', { cache: 'no-store' })
      if (!res.ok) return { enabled: true }
      const body = (await res.json()) as { data?: { enabled?: boolean } }
      return { enabled: body.data?.enabled !== false }
    },
    refetchInterval: 5_000,
    staleTime: 2_000,
  })
}

export function useWatchedFolders() {
  const launcherBase =
    (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_LAUNCHER_URL) ||
    'http://localhost:4000'
  // Surface fetch errors so the UI can distinguish "no folders watched"
  // from "launcher unreachable" — the earlier silent-catch version rendered
  // both cases as "Auto-update off", which lied to the user.
  return useQuery<{ folders: WatchedFolder[]; reachable: boolean }>({
    queryKey: ['agent-watched-folders'],
    queryFn: async () => {
      try {
        const res = await fetch(`${launcherBase}/api/agent/sources`, { cache: 'no-store' })
        if (!res.ok) {
          console.warn('[useWatchedFolders] launcher responded', res.status)
          return { folders: [], reachable: false }
        }
        const body = (await res.json()) as { folders?: WatchedFolder[] }
        return { folders: body.folders ?? [], reachable: true }
      } catch (e) {
        console.warn('[useWatchedFolders] fetch failed:', (e as Error).message)
        return { folders: [], reachable: false }
      }
    },
    refetchInterval: 8_000,
    staleTime: 3_000,
  })
}

// Global queue state (paused / stopped) — poll lightly. Used to show a
// warning banner when the user is about to take a folder-scoped action
// that won't have any live effect because the global queue is already
// blocking the worker.
export function useQueueControl() {
  return useQuery({
    queryKey: ['queue-control'],
    queryFn: async () => {
      const res = await authFetch('/api/index-queue/control', { cache: 'no-store' })
      if (!res.ok) return { paused: false, stopped: false, autoIndex: true }
      const body = (await res.json()) as {
        data?: { paused?: boolean; stopped?: boolean; autoIndex?: boolean }
      }
      return {
        paused: body.data?.paused === true,
        stopped: body.data?.stopped === true,
        autoIndex: body.data?.autoIndex !== false,
      }
    },
    refetchInterval: 5_000,
    staleTime: 2_000,
  })
}

/**
 * Classify `path` against the current watched-folder list:
 *   - 'watched'   : path is literally a watched root, safe to unwatch here
 *   - 'inside'    : path is a descendant of a watched root — must go up to
 *                   unwatch; we tell the user which root covers them
 *   - 'contains'  : path is an ancestor of one or more watched roots;
 *                   unwatching here makes no sense (the root is deeper)
 *   - 'none'      : no watched root relates to this path
 */
export function classifyWatchedPath(
  folders: WatchedFolder[],
  path: string
): {
  state: 'watched' | 'inside' | 'contains' | 'none'
  match?: WatchedFolder
  contained?: WatchedFolder[]
} {
  if (folders.length === 0) return { state: 'none' }
  const nPath = normalizePath(path)
  for (const f of folders) {
    const nf = normalizePath(f.path)
    if (nf === nPath) return { state: 'watched', match: f }
  }
  for (const f of folders) {
    const nf = normalizePath(f.path)
    if (nPath && (nPath === nf || nPath.startsWith(nf + '/'))) {
      return { state: 'inside', match: f }
    }
  }
  const contained = folders.filter((f) => {
    const nf = normalizePath(f.path)
    return nPath === '' || nf.startsWith(nPath + '/') // nPath is ancestor of nf
  })
  if (contained.length > 0) return { state: 'contains', contained }
  return { state: 'none' }
}

// ─── Index status polling (Sprint MCP-3) ────────────────────────────────────

/**
 * Batch-polls /api/index/items/status for a set of raw-file ids. Backs off
 * automatically: 1.5s while any file is non-terminal (queued/indexing),
 * otherwise 15s just to catch external changes.
 */
export function useIndexStatus(ids: string[]): Record<string, IndexFileStatus> {
  const { data } = useQuery({
    queryKey: ['index-status', ids.slice().sort().join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const qs = encodeURIComponent(ids.join(','))
      const res = await authFetch(`/api/index/items/status?ids=${qs}`, {})
      if (!res.ok) return {} as Record<string, IndexFileStatus>
      const body = (await res.json()) as { data?: Record<string, IndexFileStatus> }
      return body.data ?? {}
    },
    refetchInterval: (query) => {
      const current = (query.state.data ?? {}) as Record<string, IndexFileStatus>
      const anyActive = Object.values(current).some(
        (s) => s.index === 'queued' || s.index === 'indexing'
      )
      return anyActive ? 1500 : 15_000
    },
  })
  return data ?? {}
}

export function phaseLabel(status: IndexFileStatus): string {
  switch (status.index) {
    case 'indexed':
      return 'Indexed'
    case 'queued':
      return 'Queued'
    case 'indexing': {
      const done = status.chunksDone ?? 0
      const total = status.chunksTotal ?? 0
      if (total > 0) {
        const pct = Math.round((done / total) * 100)
        return `Indexing ${pct}%${status.phase ? ' · ' + status.phase : ''}`
      }
      return status.phase ? `Indexing · ${status.phase}` : 'Indexing'
    }
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    case 'not_indexed':
    default:
      return 'Not indexed'
  }
}

export function phaseColor(status: IndexFileStatus): { bg: string; fg: string } {
  switch (status.index) {
    case 'indexed':
      return { bg: 'rgba(45,138,78,0.12)', fg: '#2d8a4e' }
    case 'indexing':
    case 'queued':
      return { bg: 'rgba(183,121,31,0.15)', fg: '#b7791f' }
    case 'failed':
      return { bg: 'rgba(197,48,48,0.12)', fg: '#c53030' }
    default:
      return { bg: 'var(--n100, #f0eeeb)', fg: 'var(--n500, #807a70)' }
  }
}

export function watchPillStyle(
  kind: 'active' | 'inherited' | 'contains' | 'none'
): React.CSSProperties {
  const palette = {
    active: { bg: 'rgba(45,138,78,0.10)', fg: '#2d8a4e', border: 'rgba(45,138,78,0.30)' },
    inherited: { bg: 'rgba(108,99,255,0.10)', fg: '#6C63FF', border: 'rgba(108,99,255,0.30)' },
    contains: { bg: 'rgba(183,121,31,0.10)', fg: '#b7791f', border: 'rgba(183,121,31,0.30)' },
    none: { bg: 'var(--n100,#f0eeeb)', fg: 'var(--n500,#807a70)', border: 'var(--n200,#d8d4cf)' },
  }[kind]
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    fontSize: 10,
    borderRadius: 999,
    background: palette.bg,
    color: palette.fg,
    border: '1px solid ' + palette.border,
    fontFamily: 'ui-monospace,monospace',
    whiteSpace: 'nowrap',
    fontWeight: 500,
  }
}

export function crumbBtn(active: boolean): React.CSSProperties {
  return {
    padding: '3px 8px',
    border: 'none',
    background: active ? 'var(--n100, #f0eeeb)' : 'transparent',
    borderRadius: 4,
    fontSize: 12,
    color: active ? 'var(--n800, #332e25)' : 'var(--n600, #6b6358)',
    cursor: 'pointer',
    fontWeight: active ? 500 : 400,
    fontFamily: 'inherit',
  }
}

export const headerPrimaryBtn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 500,
  border: 'none',
  borderRadius: 6,
  background: '#6C63FF',
  color: '#fff',
  cursor: 'pointer',
}

export const headerSecondaryBtn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  border: '1px solid var(--n200, #d8d4cf)',
  borderRadius: 6,
  background: '#fff',
  color: 'var(--n700, #494339)',
  cursor: 'pointer',
}
