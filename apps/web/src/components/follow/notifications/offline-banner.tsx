'use client'

/**
 * Offline indicator. Fixed top banner that appears when the browser reports
 * offline, or when the realtime WebSocket has been disconnected for 5+ seconds.
 * Dismissible — reappears after 60s if still offline.
 */

import { useEffect, useState } from 'react'

const REDISPLAY_MS = 60_000
const WS_DISCONNECT_GRACE_MS = 5_000

type Status = 'online' | 'offline'

export function OfflineBanner() {
  const [status, setStatus] = useState<Status>('online')
  const [dismissed, setDismissed] = useState(false)

  // Browser network status
  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => setStatus(navigator.onLine ? 'online' : 'offline')
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // WebSocket disconnect listener (fires custom event from realtime client)
  useEffect(() => {
    if (typeof window === 'undefined') return
    let graceTimer: ReturnType<typeof setTimeout> | null = null

    function onDisconnect() {
      if (graceTimer) clearTimeout(graceTimer)
      graceTimer = setTimeout(() => setStatus('offline'), WS_DISCONNECT_GRACE_MS)
    }
    function onConnect() {
      if (graceTimer) {
        clearTimeout(graceTimer)
        graceTimer = null
      }
      if (navigator.onLine) setStatus('online')
    }

    window.addEventListener('follow:ws-disconnect', onDisconnect)
    window.addEventListener('follow:ws-connect', onConnect)
    return () => {
      if (graceTimer) clearTimeout(graceTimer)
      window.removeEventListener('follow:ws-disconnect', onDisconnect)
      window.removeEventListener('follow:ws-connect', onConnect)
    }
  }, [])

  // Auto-undismiss after 60s if still offline
  useEffect(() => {
    if (!dismissed) return
    const t = setTimeout(() => setDismissed(false), REDISPLAY_MS)
    return () => clearTimeout(t)
  }, [dismissed])

  if (status === 'online' || dismissed) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-0 right-0 top-0 z-[100] flex items-center justify-center gap-3 px-4 py-2 text-[13px] font-medium shadow"
      style={{
        background: '#FEF3C7',
        color: '#78350F',
        borderBottom: '1px solid #F59E0B',
      }}
    >
      <span aria-hidden>⚠️</span>
      <span>You&apos;re offline. Changes will sync when reconnected.</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="ml-2 rounded px-2 py-0.5 text-[12px] font-semibold transition-colors hover:bg-amber-200"
        aria-label="Dismiss offline notice"
      >
        ×
      </button>
    </div>
  )
}
