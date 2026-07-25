/**
 * Main app shell — routes to Floating Unit, overlays, panels.
 * Rendered inside the shadow DOM on Google Workspace pages.
 *
 * Feature gating: Each overlay is conditionally rendered based on
 * its corresponding feature toggle from the popup.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Providers } from './providers'
import { FloatingUnit } from '@/components/floating-unit/FloatingUnit'
import { SmartDocBadge } from '@/components/smart-doc/SmartDocBadge'
import { SelectionMenu } from '@/components/overlays/SelectionMenu'
import { GhostDraftOverlay } from '@/components/overlays/GhostDraft'
import { HighlightRevisionOverlay } from '@/components/overlays/HighlightRevision'
import { ChatDraftOverlay } from '@/components/overlays/ChatDraftOverlay'
import { DocIntelMarksOverlay, DocIntelFilterBar } from '@/components/overlays/DocIntelMarks'
import { PreviewCardOverlay } from '@/components/overlays/PreviewCard'
import { SettleAnimationOverlay } from '@/components/overlays/SettleAnimation'
import { ProvenancePanel } from '@/components/overlays/ProvenancePanel'
import { AnnotationPreviewPanel, AnnotationHoverCard } from '@/components/overlays/AnnotationPreviewPanel'
import { StrandView } from '@/components/overlays/StrandView'
import { PresenceCursors } from '@/components/overlays/PresenceCursors'
import { AddonBridge } from '@/services/addon-bridge'
import { useSmartDocStore } from '@/stores/smart-doc-store'
import { useExtensionStore } from '@/stores/extension-store'
import { useFloatingUnitStore } from '@/stores/floating-unit-store'
import { useFeatureToggleStore } from '@/stores/feature-toggle-store'
import { useOverlayStore, type PendingAnnotation } from '@/stores/overlay-store'
import type { FeatureKey } from '@/lib/constants'
import type { GoogleDocType } from '@/lib/google-doc-utils'

interface AppProps {
  googleDocId: string
  docType: GoogleDocType
  shadowRoot: ShadowRoot
  initialToggles?: Record<FeatureKey, boolean>
}

export function App({ googleDocId, docType, shadowRoot, initialToggles }: AppProps) {
  const isActivated = useSmartDocStore((s) => s.isActivated)
  const followDocId = useSmartDocStore((s) => s.followDocId)

  // Feature toggle state
  const toggles = useFeatureToggleStore((s) => s.toggles)
  const chatEnabled = toggles.chat_in_document
  const trackEnabled = toggles.track_document
  const analysisEnabled = toggles.document_analysis
  const writeEnabled = toggles.write_with_ai
  const collabEnabled = toggles.collaborate

  const [strandViewOpen, setStrandViewOpen] = useState(false)
  const annotationCount = useOverlayStore((s) => s.pendingAnnotations.length)

  // Hover card state for Grammarly-style annotation popover
  const [hoverCard, setHoverCard] = useState<{
    annotation: PendingAnnotation
    position: { top: number; left: number }
  } | null>(null)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Apply initial toggles on mount
  useEffect(() => {
    if (initialToggles) {
      const store = useFeatureToggleStore.getState()
      for (const [key, value] of Object.entries(initialToggles)) {
        if (value) store.setToggle(key as FeatureKey, value)
      }
    }
  }, [])

  // Listen for feature toggle changes from content script
  useEffect(() => {
    const mountPoint = shadowRoot.getElementById('follow-app')
    if (!mountPoint) return

    const handleToggleChange = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.feature && typeof detail?.enabled === 'boolean') {
        useFeatureToggleStore.getState().setToggle(detail.feature, detail.enabled)
      }
      // If full toggles map is provided, apply all
      if (detail?.toggles) {
        for (const [key, value] of Object.entries(detail.toggles)) {
          useFeatureToggleStore.getState().setToggle(key as FeatureKey, value as boolean)
        }
      }
    }

    mountPoint.addEventListener('follow-feature-toggle-changed', handleToggleChange)
    return () => mountPoint.removeEventListener('follow-feature-toggle-changed', handleToggleChange)
  }, [shadowRoot])

  // Listen for smart doc activation events from content script
  useEffect(() => {
    const mountPoint = shadowRoot.getElementById('follow-app')
    if (!mountPoint) return

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.id) {
        useSmartDocStore.getState().activate({
          followDocId: detail.id,
          googleDocId,
          strandId: detail.strandId,
          strandName: detail.strandName,
        })
      }
    }

    const deactivateHandler = () => {
      useSmartDocStore.getState().deactivate()
    }

    mountPoint.addEventListener('follow-smart-doc-active', handler)
    mountPoint.addEventListener('follow-smart-doc-deactivated', deactivateHandler)
    return () => {
      mountPoint.removeEventListener('follow-smart-doc-active', handler)
      mountPoint.removeEventListener('follow-smart-doc-deactivated', deactivateHandler)
    }
  }, [googleDocId, shadowRoot])

  // Hover detection for Grammarly-style insight cards
  useEffect(() => {
    if (!analysisEnabled) return
    const annotations = useOverlayStore.getState().pendingAnnotations
    if (annotations.length === 0) return

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target || target.nodeType !== 1) return

      const span = target.closest?.('span[style*="background-color"]') as HTMLElement | null
      if (!span) {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = setTimeout(() => setHoverCard(null), 300)
        return
      }

      const spanText = span.textContent?.trim() || ''
      if (!spanText) return

      const currentAnnotations = useOverlayStore.getState().pendingAnnotations
      const match = currentAnnotations.find((a) => {
        const searchStr = a.spanText.slice(0, 50).trim()
        return spanText.includes(searchStr) || searchStr.includes(spanText.slice(0, 50))
      })

      if (match) {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
        const rect = span.getBoundingClientRect()
        setHoverCard({
          annotation: match,
          position: {
            top: rect.bottom + 6,
            left: Math.min(rect.left, window.innerWidth - 300),
          },
        })
      }
    }

    const handleMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null
      if (related?.closest?.('.follow-interactive')) return
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = setTimeout(() => setHoverCard(null), 400)
    }

    document.addEventListener('mouseover', handleMouseOver, true)
    document.addEventListener('mouseout', handleMouseOut, true)
    return () => {
      document.removeEventListener('mouseover', handleMouseOver, true)
      document.removeEventListener('mouseout', handleMouseOut, true)
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    }
  }, [annotationCount, analysisEnabled])

  // Keyboard shortcuts — gated by feature toggles
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey

      // Cmd+J: Toggle Floating Unit — only if chat_in_document is enabled
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'j') {
        if (!chatEnabled) return
        e.preventDefault()
        useFloatingUnitStore.getState().togglePanel()
        return
      }

      // Cmd+Shift+P: Toggle Provenance Panel — only if track_document is enabled
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        if (!trackEnabled) return
        e.preventDefault()
        const store = useFloatingUnitStore.getState()
        if (store.activeMode === 'memory') {
          store.setActiveMode('chat')
          store.collapse()
        } else {
          store.setActiveMode('memory')
        }
        return
      }

      // Escape: Dismiss active overlay
      if (e.key === 'Escape') {
        const overlayState = useOverlayStore.getState()

        if (overlayState.pendingAnnotations.length > 0) {
          useOverlayStore.getState().clearAnnotations()
          return
        }
        if (overlayState.activePreviewCardId) {
          useOverlayStore.getState().setActivePreviewCard(null)
          return
        }
        if (overlayState.selectedText) {
          useOverlayStore.getState().setSelection(null, null)
          return
        }
        if (overlayState.ghostDrafts.length > 0) {
          const draft = overlayState.ghostDrafts[0]
          if (draft) useOverlayStore.getState().removeGhostDraft(draft.id)
          return
        }
        if (strandViewOpen) {
          setStrandViewOpen(false)
          return
        }

        // Collapse chat
        const floatingState = useFloatingUnitStore.getState()
        if (floatingState.panelState !== 'dot') {
          floatingState.minimize()
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [strandViewOpen, chatEnabled, trackEnabled])

  // Chrome commands from service worker
  useEffect(() => {
    const handler = (msg: { type: string; payload?: Record<string, string> }) => {
      if (msg.type === 'COMMAND') {
        if (msg.payload?.command === 'toggle-follow' && chatEnabled) {
          useFloatingUnitStore.getState().togglePanel()
        } else if (msg.payload?.command === 'toggle-provenance' && trackEnabled) {
          const pStore = useFloatingUnitStore.getState()
          if (pStore.activeMode === 'memory') {
            pStore.setActiveMode('chat')
            pStore.collapse()
          } else {
            pStore.setActiveMode('memory')
          }
        }
      }

      // Right-click "Ask Follow..." context menu
      if (msg.type === 'CONTEXT_MENU_ASK_FOLLOW' && msg.payload?.selectedText) {
        window.dispatchEvent(
          new CustomEvent('follow-prefill-chat', {
            detail: { text: msg.payload.selectedText },
          })
        )
        if (chatEnabled) {
          useFloatingUnitStore.getState().expand()
        }
      }
    }

    chrome.runtime?.onMessage?.addListener(handler)
    return () => chrome.runtime?.onMessage?.removeListener(handler)
  }, [chatEnabled, trackEnabled])

  // AddonBridge — poll for addon-triggered actions (only when chat is active)
  useEffect(() => {
    if (!isActivated || !followDocId || !chatEnabled) return

    const bridge = new AddonBridge(followDocId, googleDocId, docType, (action) => {
      switch (action) {
        case 'open_provenance':
          if (trackEnabled) {
            useFloatingUnitStore.getState().setActiveMode('memory')
          }
          break
        case 'open_thread_speaker':
          if (chatEnabled) {
            useFloatingUnitStore.getState().expand()
            useFloatingUnitStore.getState().setActiveMode('chat')
          }
          break
        case 'analyze_document':
          if (chatEnabled) {
            useFloatingUnitStore.getState().expand()
          }
          break
        case 'add_source':
        case 'create_strand':
          if (chatEnabled) {
            useFloatingUnitStore.getState().expand()
          }
          break
      }
    })

    bridge.start()
    return () => bridge.stop()
  }, [isActivated, followDocId, chatEnabled])

  return (
    <Providers googleDocId={googleDocId} docType={docType}>
      {/* Floating Chat — only when chat_in_document is enabled */}
      {chatEnabled && (
        <FloatingUnit googleDocId={googleDocId} docType={docType} />
      )}

      {/* Document Badge — only when track_document is enabled */}
      {trackEnabled && isActivated && <SmartDocBadge />}

      {/* Selection Menu — when write_with_ai OR chat_in_document is enabled */}
      {(writeEnabled || chatEnabled) && (
        <SelectionMenu docType={docType} googleDocId={googleDocId} />
      )}

      {/* Document Analysis overlays — only when document_analysis is enabled */}
      {analysisEnabled && (
        <>
          <DocIntelMarksOverlay />
          <DocIntelFilterBar />
          <PreviewCardOverlay />
          <AnnotationPreviewPanel googleDocId={googleDocId} />
          {hoverCard && (
            <AnnotationHoverCard
              annotation={hoverCard.annotation}
              position={hoverCard.position}
              onClose={() => setHoverCard(null)}
            />
          )}
        </>
      )}

      {/* Write with AI overlays — only when write_with_ai is enabled */}
      {writeEnabled && (
        <>
          <GhostDraftOverlay />
          <HighlightRevisionOverlay />
          <ChatDraftOverlay />
          <SettleAnimationOverlay />
        </>
      )}

      {/* Track Document panels — only when track_document is enabled */}
      {trackEnabled && isActivated && (
        <>
          <ProvenancePanel />
          <StrandView isOpen={strandViewOpen} onClose={() => setStrandViewOpen(false)} />
        </>
      )}

      {/* Collaborate — only when collaborate is enabled */}
      {collabEnabled && <PresenceCursors />}
    </Providers>
  )
}
