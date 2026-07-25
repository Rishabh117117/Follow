'use client'

/**
 * useSessionTracking — webapp-side hook for the unified sessions lifecycle
 * (2026-04-29). Drives `session.started` / `session.ended` events on the
 * API side, which the queue bridge subscribes to for Archivist + Profiler
 * scheduling.
 *
 *   - Generates a per-tab uuid once per page load (kept in sessionStorage so
 *     a refresh = same tab id = `replaced` close + fresh open, not a ghost).
 *   - POST /api/sessions on mount once a workspaceId is known.
 *   - POST /api/sessions/:id/heartbeat every 60s.
 *   - POST /api/sessions/:id/close via navigator.sendBeacon on beforeunload.
 *
 * Mount this once at the top of the authenticated app shell, not on every
 * page — multiple instances would each open their own session row.
 */

import { useEffect, useRef } from 'react'
import { API_BASE, authFetch } from '@/lib/api-client'

const HEARTBEAT_INTERVAL_MS = 60_000
const TAB_ID_STORAGE_KEY = 'follow.sessionTabId'

function getTabId(): string {
  if (typeof window === 'undefined') return ''
  let id = sessionStorage.getItem(TAB_ID_STORAGE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(TAB_ID_STORAGE_KEY, id)
  }
  return id
}

interface UseSessionTrackingOpts {
  /** Active workspaceId. Hook is a no-op until this is set. */
  workspaceId: string | null | undefined
  /** Optional scope info to freeze on session start. */
  scopeSnapshot?: {
    indexes?: string[]
    contributors?: string[]
    tags?: string[]
    timeWindow?: { start: string; end: string }
  } | null
  /** Set to false to disable the hook (e.g. for unauthenticated routes). */
  enabled?: boolean
}

export function useSessionTracking(opts: UseSessionTrackingOpts): void {
  const { workspaceId, scopeSnapshot, enabled = true } = opts
  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (!workspaceId) return
    if (typeof window === 'undefined') return

    let cancelled = false
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null

    const open = async () => {
      try {
        const res = await authFetch(`/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId,
            tabId: getTabId(),
            scopeSnapshot: scopeSnapshot ?? null,
          }),
        })
        if (!res.ok) return
        const json = (await res.json()) as { data?: { sessionId?: string } }
        if (cancelled) return
        const sessionId = json.data?.sessionId
        if (!sessionId) return
        sessionIdRef.current = sessionId

        heartbeatTimer = setInterval(() => {
          // Best-effort, don't await; if it fails the idle reaper will close
          // the session after 20 min.
          void authFetch(`/api/sessions/${sessionId}/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }).catch(() => {})
        }, HEARTBEAT_INTERVAL_MS)
      } catch {
        /* never break the page on session open failure */
      }
    }

    const closeOnUnload = () => {
      const sid = sessionIdRef.current
      if (!sid) return
      // sendBeacon survives the unload; fetch wouldn't.
      try {
        const url = `${API_BASE}/api/sessions/${sid}/close`
        const blob = new Blob([JSON.stringify({ reason: 'explicit' })], {
          type: 'application/json',
        })
        navigator.sendBeacon(url, blob)
      } catch {
        /* ignore */
      }
    }

    void open()
    window.addEventListener('beforeunload', closeOnUnload)
    window.addEventListener('pagehide', closeOnUnload)

    return () => {
      cancelled = true
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      window.removeEventListener('beforeunload', closeOnUnload)
      window.removeEventListener('pagehide', closeOnUnload)
      // Don't fire close on unmount — only on actual page unload. A route
      // change inside the app shouldn't close the session.
    }
    // eslint-disable-next-line -- exhaustive-deps intentionally omits the async callbacks; root eslint lacks the react-hooks plugin (web uses `next lint`)
  }, [workspaceId, enabled])
}
