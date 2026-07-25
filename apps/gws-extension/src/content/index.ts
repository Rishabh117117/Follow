/**
 * Follow GWS Extension — Content Script Entry Point (Google Workspace pages)
 *
 * Performance-first initialization:
 * 1. Detects page type (lightweight, no DOM queries on editor)
 * 2. Loads feature toggles from chrome.storage
 * 3. If NO toggles are enabled: do nothing, just listen for toggle changes
 * 4. If any toggle is enabled: mount React app inside shadow DOM
 * 5. Signal trackers only start when track_document is explicitly enabled
 * 6. Canvas selection tracker only starts when track/write features need it
 */

import { detectPage } from './page-detector'
import { fetchDocumentText } from './dom-bridge'
import { createShadowHost, getMountPoint } from './shadow-host'
import { sendToBackground } from '@/lib/message-passing'
import { STORAGE_KEYS } from '@/lib/constants'
import type { FeatureKey } from '@/lib/constants'
import type { GoogleDocType } from '@/lib/google-doc-utils'
import { signalEmitter } from '@/services/signal-emitter'
import { useSmartDocStore } from '@/stores/smart-doc-store'
import { RevisionPoller } from '@/services/revision-poller'
import { SheetsTracker } from '@/services/sheets-tracker'
import { SlidesTracker } from '@/services/slides-tracker'
import { CollaboratorTracker } from '@/services/collaborator-tracker'
import { SelectionTracker } from '@/services/selection-tracker'
import { startCanvasSelectionTracker } from '@/services/canvas-selection-tracker'

let activeTrackers: { stop: () => void }[] = []
let isTrackingActive = false
let stopCanvasTracker: (() => void) | null = null
let reactRoot: { unmount: () => void } | null = null
let isMounted = false

function startTracking(
  followDocId: string,
  googleDocId: string,
  docType: 'docs' | 'sheets' | 'slides'
): void {
  if (isTrackingActive) return
  isTrackingActive = true

  signalEmitter.start(followDocId)

  const collabTracker = new CollaboratorTracker(followDocId, googleDocId)
  collabTracker.start()
  activeTrackers.push(collabTracker)

  if (docType === 'docs') {
    const revPoller = new RevisionPoller(followDocId, googleDocId)
    revPoller.start()
    activeTrackers.push(revPoller)

    const selTracker = new SelectionTracker(followDocId, googleDocId)
    selTracker.start()
    activeTrackers.push(selTracker)
  } else if (docType === 'sheets') {
    const sheetsTracker = new SheetsTracker(followDocId, googleDocId)
    sheetsTracker.start()
    activeTrackers.push(sheetsTracker)
  } else {
    const slidesTracker = new SlidesTracker(followDocId, googleDocId)
    slidesTracker.start()
    activeTrackers.push(slidesTracker)
  }
}

function stopTracking(): void {
  for (const tracker of activeTrackers) {
    tracker.stop()
  }
  activeTrackers = []
  signalEmitter.stop()
  isTrackingActive = false
}

/**
 * Start canvas selection tracker if not already running.
 * Only needed for track_document and write_with_ai features.
 */
function ensureCanvasTracker(): void {
  if (!stopCanvasTracker) {
    stopCanvasTracker = startCanvasSelectionTracker()
  }
}

/**
 * Check if any feature toggle is enabled.
 */
function hasAnyToggleEnabled(toggles: Record<string, boolean>): boolean {
  return Object.values(toggles).some(Boolean)
}

/**
 * Mount the React app inside shadow DOM. Only called once.
 */
async function mountReactApp(
  googleDocId: string,
  docType: GoogleDocType,
  initialToggles: Record<FeatureKey, boolean>
): Promise<HTMLElement | null> {
  if (isMounted) return getMountPoint()
  isMounted = true

  const shadow = createShadowHost()
  const mountPoint = getMountPoint()
  if (!mountPoint) return null

  const { createRoot } = await import('react-dom/client')
  const { createElement } = await import('react')
  const { App } = await import('@/app/App')

  const root = createRoot(mountPoint)
  root.render(
    createElement(App, {
      googleDocId,
      docType,
      shadowRoot: shadow,
      initialToggles,
    })
  )
  reactRoot = root

  return mountPoint
}

async function init() {
  // 1. Detect page type (lightweight)
  const page = detectPage()
  if (!page) return

  // 2. Load feature toggles from chrome.storage
  const storageResult = await chrome.storage.local.get(STORAGE_KEYS.FEATURE_TOGGLES)
  const initialToggles: Record<FeatureKey, boolean> = storageResult[STORAGE_KEYS.FEATURE_TOGGLES] || {}

  let mountPoint: HTMLElement | null = null

  // 3. Only mount React if at least one toggle is enabled
  if (hasAnyToggleEnabled(initialToggles)) {
    mountPoint = await mountReactApp(page.googleDocId, page.docType, initialToggles)

    // Start canvas tracker if selection-dependent features are on
    if (initialToggles.track_document || initialToggles.write_with_ai) {
      ensureCanvasTracker()
    }

    // Fetch document text only when tracking is enabled
    if (initialToggles.track_document) {
      fetchDocumentText(page.googleDocId).catch(() => {})
    }

    // If track_document is enabled, activate document tracking and start tracking
    if (initialToggles.track_document && mountPoint) {
      activateAndTrack(page.googleDocId, page.docType as 'docs' | 'sheets' | 'slides', mountPoint)
    }
  }

  // 4. Listen for feature toggle changes — mount React lazily if needed
  chrome.runtime?.onMessage?.addListener((
    msg: { type: string; payload?: Record<string, unknown> },
    _sender,
    sendResponse: (response?: unknown) => void,
  ) => {
    // Popup query: snapshot of this tab's smart-doc state
    if (msg.type === 'GET_SMART_DOC_INFO') {
      try {
        const s = useSmartDocStore.getState()
        const title = document.title.replace(/ - Google (Docs|Sheets|Slides)$/, '')
        sendResponse({
          success: true,
          data: {
            title: s.strandName || title,
            isActivated: s.isActivated,
            isRecording: s.isRecording,
            signalCount: s.signalCount,
            lastSignalAt: s.lastSignalAt,
          },
        })
      } catch (err) {
        sendResponse({ success: false, error: (err as Error).message })
      }
      return true
    }

    if (msg.type === 'FEATURE_TOGGLE_CHANGED' && msg.payload) {
      const { feature, enabled, toggles } = msg.payload as {
        feature: FeatureKey; enabled: boolean; toggles: Record<FeatureKey, boolean>
      }

      // Lazy mount: if React isn't mounted yet and a toggle was just enabled, mount it now
      if (enabled && !isMounted) {
        mountReactApp(page.googleDocId, page.docType, toggles).then((mp) => {
          mountPoint = mp
          if (mp) {
            mp.dispatchEvent(
              new CustomEvent('follow-feature-toggle-changed', {
                detail: { feature, enabled, toggles },
              })
            )
          }
          // Handle the specific toggle that was just enabled
          handleToggleChange(feature, enabled, toggles, page, mp)
        })
        return
      }

      // Forward to React tree
      if (mountPoint) {
        mountPoint.dispatchEvent(
          new CustomEvent('follow-feature-toggle-changed', {
            detail: { feature, enabled, toggles },
          })
        )
      }

      handleToggleChange(feature, enabled, toggles, page, mountPoint)
    }

    // Document lifecycle messages
    if (msg.type === 'SMART_DOC_ACTIVATED' && msg.payload && mountPoint) {
      mountPoint.dispatchEvent(
        new CustomEvent('follow-smart-doc-active', { detail: msg.payload })
      )

      const followDocId = (msg.payload.id as string) || page.googleDocId
      if (!isTrackingActive) {
        const dType = ((msg.payload.docType as string) || '').replace('google_', '') as 'docs' | 'sheets' | 'slides'
        startTracking(followDocId, page.googleDocId, dType || page.docType as 'docs' | 'sheets' | 'slides')
      }

      // Deferred content sync
      setTimeout(() => {
        fetchDocumentText(page.googleDocId).then((text) => {
          if (text && text.length > 0) {
            sendToBackground({
              type: 'CONTENT_SYNC',
              payload: { externalDocId: page.googleDocId, content: text, paragraphCount: text.split('\n').length },
            })
          }
        }).catch(() => {})
      }, 5000)
    }

    if (msg.type === 'SMART_DOC_DEACTIVATED' && mountPoint) {
      stopTracking()
      mountPoint.dispatchEvent(
        new CustomEvent('follow-smart-doc-deactivated', { detail: msg.payload })
      )
    }
  })

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    stopTracking()
    if (stopCanvasTracker) {
      stopCanvasTracker()
      stopCanvasTracker = null
    }
    // Lazy-destroy offlineQueue only if it was imported
    import('@/services/offline-queue').then(({ offlineQueue }) => {
      offlineQueue.destroy()
    }).catch(() => {})
    if (reactRoot) {
      reactRoot.unmount()
      reactRoot = null
    }
  })
}

/**
 * Handle a specific toggle change — start/stop services as needed.
 */
function handleToggleChange(
  feature: FeatureKey,
  enabled: boolean,
  toggles: Record<FeatureKey, boolean>,
  page: { googleDocId: string; docType: string },
  mountPoint: HTMLElement | null
): void {
  if (feature === 'track_document') {
    if (enabled && mountPoint) {
      ensureCanvasTracker()
      fetchDocumentText(page.googleDocId).catch(() => {})
      activateAndTrack(page.googleDocId, page.docType as 'docs' | 'sheets' | 'slides', mountPoint)
    } else {
      stopTracking()
    }
  }

  if (feature === 'write_with_ai' && enabled) {
    ensureCanvasTracker()
  }
}

/**
 * Auto-activate document tracking and start tracking when track_document is toggled on.
 */
async function activateAndTrack(
  googleDocId: string,
  docType: 'docs' | 'sheets' | 'slides',
  mountPoint: HTMLElement
): Promise<void> {
  const statusResult = await sendToBackground<{ id?: string; strandId?: string }>({
    type: 'SMART_DOC_STATUS',
    payload: { externalDocId: googleDocId },
  })

  let followDocId: string

  if (statusResult.success && statusResult.data?.id) {
    followDocId = statusResult.data.id
    mountPoint.dispatchEvent(
      new CustomEvent('follow-smart-doc-active', { detail: statusResult.data })
    )
  } else {
    const docTitle = document.title.replace(/ - Google (Docs|Sheets|Slides)$/, '') || 'Untitled'
    const activateResult = await sendToBackground<{ id?: string }>({
      type: 'SMART_DOC_ACTIVATE',
      payload: {
        externalDocId: googleDocId,
        docType: `google_${docType}`,
        title: docTitle,
        workspaceId: '',
      },
    })

    if (!activateResult.success || !activateResult.data?.id) return

    followDocId = activateResult.data.id
    mountPoint.dispatchEvent(
      new CustomEvent('follow-smart-doc-active', { detail: activateResult.data })
    )
  }

  if (!isTrackingActive) {
    startTracking(followDocId, googleDocId, docType)
  }

  // Defer content sync
  setTimeout(() => {
    fetchDocumentText(googleDocId).then((text) => {
      if (text && text.length > 0) {
        sendToBackground({
          type: 'CONTENT_SYNC',
          payload: { externalDocId: googleDocId, content: text, paragraphCount: text.split('\n').length },
        })
      }
    }).catch(() => {})
  }, 5000)
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
