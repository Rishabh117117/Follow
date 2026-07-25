/**
 * Loader — loads feature modules by requesting script injection from the service worker.
 *
 * Each feature module is a separate IIFE bundle. Features are injected via
 * chrome.scripting.executeScript (from service worker) and register themselves
 * on the __followFeatures global. This keeps the detector bundle tiny.
 */

import type { FeatureKey, PageType } from '@/lib/constants'
import type { DetectedPage } from '@/lib/google-doc-utils'
import { coordinator } from '@/core/coordinator'
import { signalPipeline } from '@/core/signal-pipeline'
import { sendToBackground } from '@/core/message-bus'
import { SIGNAL_BATCH_INTERVAL, DEFAULT_API_BASE_URL, STORAGE_KEYS } from '@/lib/constants'

interface LoadedFeature {
  key: string
  cleanup?: () => void
}

const loadedFeatures = new Map<string, LoadedFeature>()
let coordinatorStarted = false

/** Cached auth for synchronous use in beforeunload */
let cachedApiBaseUrl = DEFAULT_API_BASE_URL
let cachedAuthToken: string | undefined
let cachedUserId: string | undefined
let cachedWorkspaceId: string | undefined

// Pre-cache auth credentials so flushSync can use them synchronously
chrome.storage?.local?.get(
  [STORAGE_KEYS.API_BASE_URL, STORAGE_KEYS.AUTH_TOKEN, STORAGE_KEYS.USER_ID, STORAGE_KEYS.WORKSPACE_ID],
  (result) => {
    if (result[STORAGE_KEYS.API_BASE_URL]) cachedApiBaseUrl = result[STORAGE_KEYS.API_BASE_URL]
    if (result[STORAGE_KEYS.AUTH_TOKEN]) cachedAuthToken = result[STORAGE_KEYS.AUTH_TOKEN]
    if (result[STORAGE_KEYS.USER_ID]) cachedUserId = result[STORAGE_KEYS.USER_ID]
    if (result[STORAGE_KEYS.WORKSPACE_ID]) cachedWorkspaceId = result[STORAGE_KEYS.WORKSPACE_ID]
  }
)

/** Feature script paths relative to extension root */
const FEATURE_SCRIPTS: Record<string, string> = {
  'gws-tracking': 'dist/features/gws-tracking.js',
  'smart-doc': 'dist/features/smart-doc.js',
  'chat': 'dist/features/chat.js',
  'doc-intel': 'dist/features/doc-intel.js',
  'ai-writing': 'dist/features/ai-writing.js',
  'web-tracking': 'dist/features/web-tracking.js',
}

/**
 * Request the service worker to inject a feature script into this tab.
 * Uses chrome.scripting.executeScript via message to run in ISOLATED world
 * (so chrome.storage, chrome.runtime etc. are available).
 */
async function injectFeature(featureKey: string): Promise<boolean> {
  const script = FEATURE_SCRIPTS[featureKey]
  if (!script) return false

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'INJECT_FEATURE_SCRIPT',
      payload: { script },
    })
    return result?.success ?? false
  } catch (err) {
    console.warn(`[Follow] Failed to inject ${featureKey}:`, err)
    return false
  }
}

/**
 * Determine which features to load based on page type and toggles.
 */
export async function loadFeatures(
  pageType: PageType,
  toggles: Record<FeatureKey, boolean>,
  gwsPage?: DetectedPage
): Promise<void> {
  const isGWS = pageType.startsWith('google-')

  // Start the coordinator if any features need it
  const anyEnabled = Object.values(toggles).some(Boolean)
  if (anyEnabled && !coordinatorStarted) {
    startCoordinator()
  }

  // Store page context for feature modules to read
  ;(window as unknown as Record<string, unknown>).__followContext = {
    pageType,
    gwsPage,
    toggles,
  }

  // ─── Follow Chat (works on any page) ─────────────────────────────
  if (toggles.follow_chat && !loadedFeatures.has('chat')) {
    await injectFeature('chat')
    loadedFeatures.set('chat', { key: 'chat' })
  }

  // ─── Track Document (GWS: doc tracking + smart-doc, Web: page signals) ──
  if (toggles.track_document) {
    if (isGWS && gwsPage) {
      if (!loadedFeatures.has('gws-tracking')) {
        await injectFeature('gws-tracking')
        loadedFeatures.set('gws-tracking', { key: 'gws-tracking' })
      }
      if (!loadedFeatures.has('smart-doc')) {
        await injectFeature('smart-doc')
        loadedFeatures.set('smart-doc', { key: 'smart-doc' })
      }
    }
    if (!isGWS && !loadedFeatures.has('web-tracking')) {
      await injectFeature('web-tracking')
      loadedFeatures.set('web-tracking', { key: 'web-tracking' })
    }
  }

  // ─── Follow Web (non-GWS: web tracking + floating F dot) ──────────
  if (!isGWS && toggles.follow_web) {
    if (!loadedFeatures.has('web-tracking')) {
      await injectFeature('web-tracking')
      loadedFeatures.set('web-tracking', { key: 'web-tracking' })
    }
    if (!loadedFeatures.has('chat')) {
      await injectFeature('chat')
      loadedFeatures.set('chat', { key: 'chat' })
    }
  }

  // ─── Write & Analyze (GWS only: ai-writing + doc-intel) ─────────
  if (isGWS && toggles.write_and_analyze) {
    if (!loadedFeatures.has('ai-writing')) {
      await injectFeature('ai-writing')
      loadedFeatures.set('ai-writing', { key: 'ai-writing' })
    }
    if (!loadedFeatures.has('doc-intel')) {
      await injectFeature('doc-intel')
      loadedFeatures.set('doc-intel', { key: 'doc-intel' })
    }
  }

  // Unload features that are no longer needed
  for (const [key, feature] of loadedFeatures) {
    const shouldBeLoaded = isFeatureNeeded(key, pageType, toggles)
    if (!shouldBeLoaded) {
      feature.cleanup?.()
      // Dispatch cleanup event for the feature
      document.dispatchEvent(new CustomEvent(`follow-unload-${key}`))
      loadedFeatures.delete(key)

      // Deactivate smart doc when tracking is turned off
      if (key === 'gws-tracking' && gwsPage) {
        sendToBackground({
          type: 'SMART_DOC_DEACTIVATE',
          payload: { externalDocId: gwsPage.googleDocId },
        }).catch(() => {})
      }
    }
  }

  // Stop coordinator if nothing needs it
  if (!anyEnabled && coordinatorStarted) {
    coordinator.destroy()
    coordinatorStarted = false
  }
}

function isFeatureNeeded(key: string, pageType: PageType, toggles: Record<FeatureKey, boolean>): boolean {
  const isGWS = pageType.startsWith('google-')
  switch (key) {
    case 'chat': return !!toggles.follow_chat || (!isGWS && !!toggles.follow_web)
    case 'gws-tracking': return isGWS && !!toggles.track_document
    case 'smart-doc': return isGWS && !!toggles.track_document
    case 'web-tracking': return !isGWS && (!!toggles.track_document || !!toggles.follow_web)
    case 'ai-writing': return isGWS && !!toggles.write_and_analyze
    case 'doc-intel': return isGWS && !!toggles.write_and_analyze
    default: return false
  }
}

function startCoordinator(): void {
  coordinatorStarted = true
  coordinator.start()
  coordinator.register({
    id: 'signal-flush',
    interval: SIGNAL_BATCH_INTERVAL,
    visibilityRequired: false,
    execute: () => signalPipeline.flush(),
  })
}

/**
 * Unload all features and clean up.
 */
export function unloadAllFeatures(): void {
  for (const [key] of loadedFeatures) {
    document.dispatchEvent(new CustomEvent(`follow-unload-${key}`))
  }
  loadedFeatures.clear()
  // Flush remaining signals via fetch+keepalive before destroying
  signalPipeline.destroy(cachedApiBaseUrl, cachedAuthToken, cachedUserId, cachedWorkspaceId)
  coordinator.destroy()
  coordinatorStarted = false
}
