'use client'

import { useEffect, useRef, useCallback } from 'react'
import { DEV_USER } from '@workspace/shared/constants'
import type { SignalType } from '@workspace/shared/types'
import { API_BASE, authFetch } from '@/lib/api-client'
import { useDocumentContextStore } from '@/stores/document-context-store'
import { useFloatingUnitStore } from '@/stores/floating-unit-store'

const FLUSH_INTERVAL_MS = 5_000
const IDLE_THRESHOLD_MS = 5_000
const SCROLL_DEBOUNCE_MS = 500

interface SignalRecord {
  type: SignalType
  sessionId: string
  timestamp: string
  url?: string
  domain?: string
  title?: string
  metadata: Record<string, unknown>
}

interface UseSignalCaptureOptions {
  workspaceId: string
  userId?: string
}

/**
 * Captures user activity signals (visibility, scroll, idle, selection, doc edits)
 * and batches them every 5s to POST /api/capture/realtime.
 *
 * Always runs (unlike heartbeat which only runs during Live recording).
 * Signals flow: ClickHouse thread_signals → RealtimeScheduler → thread_events.
 *
 * Automatically includes fileId from the floating unit store when the user is
 * editing a document, enabling auto-creation of per-document strands.
 */
export function useSignalCapture({ workspaceId, userId }: UseSignalCaptureOptions) {
  const effectiveUserId = userId || DEV_USER.id
  const sessionIdRef = useRef<string>('')
  const bufferRef = useRef<SignalRecord[]>([])
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastActivityRef = useRef<number>(Date.now())
  const wasIdleRef = useRef(false)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScrollDepthRef = useRef(0)

  // Generate stable session ID on mount
  useEffect(() => {
    sessionIdRef.current = crypto.randomUUID()
  }, [])

  const pushSignal = useCallback((type: SignalType, metadata: Record<string, unknown> = {}) => {
    // Enrich with current document section context
    const docCtx = useDocumentContextStore.getState()
    const enrichedMetadata = docCtx.currentSectionTitle
      ? {
          ...metadata,
          sectionIndex: docCtx.currentSectionIndex,
          sectionTitle: docCtx.currentSectionTitle,
        }
      : metadata

    // Enrich with fileId from the floating unit store (document-scoped signals)
    const chatFileId = useFloatingUnitStore.getState().chatFileId
    const finalMetadata = chatFileId
      ? { ...enrichedMetadata, fileId: chatFileId }
      : enrichedMetadata

    bufferRef.current.push({
      type,
      sessionId: sessionIdRef.current,
      timestamp: new Date().toISOString(),
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      domain: typeof window !== 'undefined' ? window.location.hostname : undefined,
      title: typeof document !== 'undefined' ? document.title : undefined,
      metadata: finalMetadata,
    })
  }, [])

  // Flush buffered signals to the API
  const flush = useCallback(async () => {
    if (bufferRef.current.length === 0) return

    const signals = bufferRef.current.splice(0)

    try {
      await authFetch(`/api/capture/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': effectiveUserId,
          'x-workspace-id': workspaceId,
        },
        body: JSON.stringify({
          workspaceId,
          userId: effectiveUserId,
          sessionId: sessionIdRef.current,
          source: 'in_app',
          timestamp: new Date().toISOString(),
          signals,
        }),
      })
    } catch {
      // Put signals back for retry (cap at 100 to prevent memory growth)
      bufferRef.current.unshift(...signals)
      if (bufferRef.current.length > 100) {
        bufferRef.current = bufferRef.current.slice(-50)
      }
    }
  }, [workspaceId, effectiveUserId])

  // Visibility change listener
  useEffect(() => {
    const onVisibility = () => {
      pushSignal('visibility', {
        visibilityState: document.visibilityState,
      })
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [pushSignal])

  // Scroll listener (debounced)
  useEffect(() => {
    const onScroll = () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
      scrollTimerRef.current = setTimeout(() => {
        const depth = Math.round(
          (window.scrollY /
            Math.max(document.documentElement.scrollHeight - window.innerHeight, 1)) *
            100
        )
        // Only emit if depth changed significantly (>5%)
        if (Math.abs(depth - lastScrollDepthRef.current) >= 5) {
          lastScrollDepthRef.current = depth
          pushSignal('scroll', { scrollDepth: depth })
        }
      }, SCROLL_DEBOUNCE_MS)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    }
  }, [pushSignal])

  // Selection change listener
  useEffect(() => {
    const onSelection = () => {
      const sel = window.getSelection()
      const text = sel?.toString() ?? ''
      if (text.length > 0) {
        pushSignal('selection', {
          selectionLength: text.length,
          selectionPreview: text.slice(0, 100),
        })
      }
    }
    document.addEventListener('selectionchange', onSelection)
    return () => document.removeEventListener('selectionchange', onSelection)
  }, [pushSignal])

  // Idle detection — track activity and emit idle/active transitions
  useEffect(() => {
    const onActivity = () => {
      lastActivityRef.current = Date.now()
      if (wasIdleRef.current) {
        wasIdleRef.current = false
        pushSignal('idle_state', { idle: false })
      }
    }

    const idleCheck = setInterval(() => {
      if (Date.now() - lastActivityRef.current > IDLE_THRESHOLD_MS && !wasIdleRef.current) {
        wasIdleRef.current = true
        pushSignal('idle_state', { idle: true })
      }
    }, 1_000)

    window.addEventListener('mousemove', onActivity, { passive: true })
    window.addEventListener('keydown', onActivity, { passive: true })
    window.addEventListener('click', onActivity, { passive: true })

    return () => {
      clearInterval(idleCheck)
      window.removeEventListener('mousemove', onActivity)
      window.removeEventListener('keydown', onActivity)
      window.removeEventListener('click', onActivity)
    }
  }, [pushSignal])

  // Page navigation detection (URL changes within the SPA)
  useEffect(() => {
    let lastPath = typeof window !== 'undefined' ? window.location.pathname : ''

    const check = setInterval(() => {
      const currentPath = window.location.pathname
      if (currentPath !== lastPath) {
        pushSignal('page_navigate', {
          from: lastPath,
          to: currentPath,
        })
        lastPath = currentPath
      }
    }, 1_000)

    return () => clearInterval(check)
  }, [pushSignal])

  // Flush interval
  useEffect(() => {
    flushIntervalRef.current = setInterval(flush, FLUSH_INTERVAL_MS)
    return () => {
      if (flushIntervalRef.current) clearInterval(flushIntervalRef.current)
    }
  }, [flush])

  // sendBeacon on unload
  useEffect(() => {
    const onUnload = () => {
      if (bufferRef.current.length === 0) return
      const signals = bufferRef.current.splice(0)
      navigator.sendBeacon(
        `${API_BASE}/api/capture/realtime`,
        JSON.stringify({
          workspaceId,
          userId: effectiveUserId,
          sessionId: sessionIdRef.current,
          source: 'in_app',
          timestamp: new Date().toISOString(),
          signals,
        })
      )
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [workspaceId, effectiveUserId])

  // Listen for provenance signals from commit handler (Sprint M3)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        type: string
        action: string
        metadata: Record<string, unknown>
      }
      const signalType = detail.action as SignalType
      pushSignal(signalType, detail.metadata)
    }
    window.addEventListener('provenance-signal', handler)
    return () => window.removeEventListener('provenance-signal', handler)
  }, [pushSignal])

  // Emit an initial page_navigate on mount
  useEffect(() => {
    pushSignal('page_navigate', { to: window.location.pathname, initial: true })
  }, [pushSignal])

  return { pushSignal }
}
