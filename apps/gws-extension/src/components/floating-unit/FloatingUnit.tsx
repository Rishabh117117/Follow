/**
 * Port of floating-unit.tsx — dot, collapsed, expanded states.
 * Adapted for Chrome Extension: no TipTap, absolute URLs, shadow DOM rendering.
 *
 * Three visual states:
 *   dot      — 38x38 circle, #6366F1, "F", bottom-4 right-4
 *   collapsed — 760px bar, white bg, centered bottom-4
 *   expanded  — full chat panel with messages above bar
 */

import React, { useEffect, useState, useCallback } from 'react'
import { useFloatingUnitStore } from '@/stores/floating-unit-store'
import { useSmartDocStore } from '@/stores/smart-doc-store'
import { useExtensionStore, type ConnectionStatus } from '@/stores/extension-store'
import { useOverlayStore } from '@/stores/overlay-store'
import { UnitChatPanel } from './UnitChatPanel'
import { COLORS } from '@/lib/constants'
import type { GoogleDocType } from '@/lib/google-doc-utils'
import { fetchAIStateSummary, markTeamUpdatesSurfaced } from '@/services/provenance-service'

interface FloatingUnitProps {
  googleDocId?: string
  docType?: GoogleDocType
}

export function FloatingUnit({ googleDocId, docType }: FloatingUnitProps) {
  const { panelState, restore, collapse, minimize, expand, togglePanel } =
    useFloatingUnitStore()
  const { followDocId } = useSmartDocStore()

  // Ambient intelligence state
  const [tensionCount, setTensionCount] = useState(0)
  const [tensionHasHigh, setTensionHasHigh] = useState(false)
  const [tensionHasMedium, setTensionHasMedium] = useState(false)
  const [teamUpdates, setTeamUpdates] = useState<Array<{ fromUserName: string; memory: string; surfaced: boolean }>>([])
  const [showWhisper, setShowWhisper] = useState(false)

  // E-1.2 connection + auth state
  const { connectionStatus, setConnectionStatus, authExpired, setAuthExpired } = useExtensionStore()
  const collaborators = useOverlayStore((s) => s.collaborators)
  const insertionToast = useOverlayStore((s) => s.insertionToast)
  const dismissInsertionToast = useOverlayStore((s) => s.dismissInsertionToast)

  // Listen for connection status + auth expired broadcasts from the service worker.
  useEffect(() => {
    const handler = (msg: { type?: string; payload?: { status?: ConnectionStatus } }) => {
      if (msg?.type === 'CONNECTION_STATUS_CHANGED' && msg.payload?.status) {
        setConnectionStatus(msg.payload.status)
      } else if (msg?.type === 'AUTH_EXPIRED') {
        setAuthExpired(true)
      }
    }
    try {
      chrome.runtime?.onMessage?.addListener(handler as Parameters<typeof chrome.runtime.onMessage.addListener>[0])
    } catch {
      // not in extension context
    }
    return () => {
      try {
        chrome.runtime?.onMessage?.removeListener(handler as Parameters<typeof chrome.runtime.onMessage.removeListener>[0])
      } catch {
        // ignore
      }
    }
  }, [setConnectionStatus, setAuthExpired])

  const handleSignInAgain = useCallback(() => {
    chrome.runtime.openOptionsPage?.() ||
      chrome.tabs?.create?.({ url: chrome.runtime.getURL('popup/popup.html') })
  }, [])

  const connectionDotColor =
    connectionStatus === 'connected' ? '#22C55E' :
    connectionStatus === 'reconnecting' ? '#F59E0B' :
    '#EF4444'

  // Fetch AI state for tension badge + whisper
  useEffect(() => {
    if (!followDocId) return

    const fetchState = async () => {
      const storage = await chrome.storage?.local?.get?.('follow_workspace_id').catch(() => ({}))
      const wsId = (storage as any)?.follow_workspace_id || 'default'
      const result = await fetchAIStateSummary(wsId, followDocId)
      setTensionCount(result.activeTensionCount)
      setTensionHasHigh(result.tensions.some((t) => t.severity === 'high'))
      setTensionHasMedium(
        result.tensions.some((t) => t.severity === 'medium' && !t.tentative)
      )
      if (result.hasUnsurfacedTeamUpdates) {
        setTeamUpdates(result.newFromTeam.filter((m) => !m.surfaced))
        setShowWhisper(true)
      }
    }

    fetchState()
    const interval = setInterval(fetchState, 30_000)
    return () => clearInterval(interval)
  }, [followDocId])

  // Auto-dismiss whisper after 8s
  useEffect(() => {
    if (!showWhisper) return
    const timer = setTimeout(() => {
      setShowWhisper(false)
      chrome.storage?.local?.get?.('follow_workspace_id').then((s: any) => {
        markTeamUpdatesSurfaced(s?.follow_workspace_id || 'default')
      }).catch(() => {})
    }, 8000)
    return () => clearTimeout(timer)
  }, [showWhisper])

  // ─── Dot state ───
  if (panelState === 'dot') {
    const showAmberPulse = tensionHasMedium || tensionHasHigh
    return (
      <div className="follow-interactive" style={{ position: 'fixed', bottom: 16, right: 16 }}>
        <button
          onClick={() => restore()}
          className="follow-animate-scale-in"
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: COLORS.primary,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(99,102,241,0.4)',
            border: 'none',
            cursor: 'pointer',
            transition: 'transform 150ms ease',
            fontSize: 13,
            fontWeight: 700,
            position: 'relative',
          }}
          onMouseEnter={(e) => { (e.currentTarget.style.transform = 'scale(1.10)') }}
          onMouseLeave={(e) => { (e.currentTarget.style.transform = 'scale(1)') }}
          title="Open Follow (Cmd+J)"
        >
          {/* E-3.2: amber pulse ring when medium+ severity tension exists */}
          {showAmberPulse && (
            <span
              aria-hidden
              style={{
                position: 'absolute', inset: -2, borderRadius: '50%',
                background: tensionHasHigh ? 'rgba(220,38,38,0.28)' : 'rgba(245,158,11,0.28)',
                animation: 'ping 1.6s ease-out infinite',
                pointerEvents: 'none',
              }}
            />
          )}
          F
          {/* E-1.2: connection status dot (bottom-right of unit) */}
          <span
            aria-hidden
            style={{
              position: 'absolute', bottom: -1, right: -1,
              width: 8, height: 8, borderRadius: '50%',
              background: connectionDotColor,
              border: '1.5px solid white',
              animation: connectionStatus === 'reconnecting' ? 'pulse 1.2s ease-in-out infinite' : 'none',
            }}
            title={`API ${connectionStatus}`}
          />
          {/* Tension badge */}
          {tensionCount > 0 && (
            <span style={{
              position: 'absolute', top: -2, right: -2,
              width: 14, height: 14, borderRadius: 7,
              background: tensionHasHigh ? '#DC2626' : '#D97706',
              color: 'white', fontSize: 8, fontFamily: 'JetBrains Mono, monospace',
              fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {tensionCount > 9 ? '9+' : tensionCount}
            </span>
          )}
        </button>
      </div>
    )
  }

  // ─── Collapsed / Expanded states ───
  return (
    <div style={{ position: 'relative' }}>
      {/* Entry whisper */}
      {showWhisper && teamUpdates.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 80,
            right: 16,
            maxWidth: 300,
            background: 'white',
            border: '1px solid #e5e5e5',
            borderRadius: 10,
            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            zIndex: 2147483640,
            animation: 'fadeIn 300ms ease-out',
          }}
          className="follow-interactive"
        >
          <span style={{ fontSize: 11, fontFamily: 'Georgia, serif', color: '#404040', flex: 1 }}>
            {teamUpdates.length === 1
              ? `${teamUpdates[0]!.fromUserName} made changes recently`
              : `${teamUpdates.length} updates from your team`}
          </span>
          <button
            onClick={() => setShowWhisper(false)}
            style={{ fontSize: 12, color: '#d4d4d4', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* E-1.2 Auth expired banner */}
      {authExpired && (
        <div style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          maxWidth: 420, background: '#FEF3C7', border: '1px solid #F59E0B',
          borderRadius: 10, padding: '10px 14px', display: 'flex',
          alignItems: 'center', gap: 10, zIndex: 2147483640,
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        }}>
          <span style={{ fontSize: 13, color: '#92400E', flex: 1 }}>
            Session expired. Sign in again to continue tracking.
          </span>
          <button
            onClick={handleSignInAgain}
            style={{
              padding: '5px 10px', borderRadius: 6,
              background: '#0A0A0A', color: 'white', fontSize: 11,
              fontWeight: 500, border: 'none', cursor: 'pointer',
            }}
          >Sign in again</button>
          <button
            onClick={() => setAuthExpired(false)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#92400E' }}
            aria-label="Dismiss"
          >✕</button>
        </div>
      )}

      {/* E-1.3 Collaborator avatars (expanded header overlay) */}
      {collaborators.length > 0 && (
        <div
          style={{
            position: 'fixed', bottom: 120, right: 20, zIndex: 2147483641,
            background: 'white', borderRadius: 16, padding: '4px 10px 4px 6px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)', display: 'flex',
            alignItems: 'center', gap: 4, border: '1px solid #E5E7EB',
          }}
          title={`Collaborators: ${collaborators.join(', ')}`}
        >
          <div style={{ display: 'flex', marginLeft: 4 }}>
            {collaborators.slice(0, 3).map((name, i) => (
              <div
                key={name}
                style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: ['#2563EB', '#DC2626', '#16A34A', '#7C3AED'][i % 4],
                  color: 'white', fontSize: 9, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1.5px solid white', marginLeft: i === 0 ? 0 : -6,
                }}
              >{name[0]?.toUpperCase() || '?'}</div>
            ))}
          </div>
          {collaborators.length > 3 && (
            <span style={{ fontSize: 10, color: '#6B7280', marginLeft: 2 }}>
              +{collaborators.length - 3}
            </span>
          )}
        </div>
      )}

      {/* E-2 Insertion failure toast */}
      {insertionToast && (
        <div style={{
          position: 'fixed', bottom: 160, left: '50%', transform: 'translateX(-50%)',
          maxWidth: 360, background: '#0A0A0A', color: 'white',
          borderRadius: 10, padding: '10px 14px', display: 'flex',
          alignItems: 'center', gap: 10, zIndex: 2147483642,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        }}>
          <span style={{ fontSize: 12, flex: 1 }}>{insertionToast.message}</span>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(insertionToast.content)
              } catch {
                // clipboard may be locked
              }
            }}
            style={{
              padding: '5px 10px', borderRadius: 6, background: '#6366F1',
              color: 'white', fontSize: 11, fontWeight: 500, border: 'none', cursor: 'pointer',
            }}
          >Copy to clipboard</button>
          <button
            onClick={dismissInsertionToast}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'white' }}
            aria-label="Dismiss"
          >✕</button>
        </div>
      )}

      <UnitChatPanel googleDocId={googleDocId} docType={docType} />
    </div>
  )
}
