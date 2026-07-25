/**
 * Detector — tiny content script entry point (<5KB compiled).
 *
 * This is the ONLY content script injected on all pages.
 * It detects page type, reads feature toggles, and delegates
 * to the loader for lazy-loading feature modules.
 */

import { classifyPage, detectGoogleWorkspacePage } from '@/lib/google-doc-utils'
import { STORAGE_KEYS, type FeatureKey, type PageType } from '@/lib/constants'
import { loadFeatures, unloadAllFeatures } from './loader'

let currentPageType: PageType | null = null
let initialized = false

async function init(): Promise<void> {
  if (initialized) return
  initialized = true
  console.log('[Follow Detector] init() starting')

  const url = window.location.href

  // Skip chrome:// and extension pages
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return

  currentPageType = classifyPage(url)
  const gwsPage = detectGoogleWorkspacePage(url)
  console.log('[Follow Detector] pageType:', currentPageType, 'gwsPage:', gwsPage?.pageType)

  // Read feature toggles (auto-enable follow_chat on GWS pages if no toggles set)
  let toggles: Record<FeatureKey, boolean> = {}
  try {
    const storageResult = await chrome.storage.local.get(STORAGE_KEYS.FEATURE_TOGGLES)
    toggles = storageResult[STORAGE_KEYS.FEATURE_TOGGLES] || {}
    console.log('[Follow Detector] toggles from storage:', JSON.stringify(toggles))
  } catch (err) {
    console.error('[Follow Detector] chrome.storage.local.get FAILED:', err)
  }

  // If no toggles configured at all, set sensible defaults
  const hasAnyToggle = Object.values(toggles).some(Boolean)
  if (!hasAnyToggle) {
    toggles = { follow_chat: true, track_document: true, write_and_analyze: true, follow_web: true } as Record<FeatureKey, boolean>
    // Persist defaults so popup shows correct state
    await chrome.storage.local.set({ [STORAGE_KEYS.FEATURE_TOGGLES]: toggles })
  }

  // Load features based on page type and active toggles
  await loadFeatures(currentPageType, toggles, gwsPage ?? undefined)

  // Listen for toggle changes from popup/background
  chrome.runtime?.onMessage?.addListener((msg: { type: string; payload?: Record<string, unknown> }, _sender, sendResponse) => {
    if (msg.type === 'FEATURE_TOGGLE_CHANGED' && msg.payload) {
      const newToggles = msg.payload.toggles as Record<FeatureKey, boolean>
      loadFeatures(currentPageType!, newToggles, gwsPage ?? undefined)
    }

    if (msg.type === 'COMMAND' && msg.payload) {
      const { command } = msg.payload as { command: string }
      document.dispatchEvent(new CustomEvent('follow-command', { detail: { command } }))
    }

    if (msg.type === 'CONTEXT_MENU_ASK_FOLLOW' && msg.payload) {
      document.dispatchEvent(new CustomEvent('follow-ask', { detail: msg.payload }))
    }

    if (msg.type === 'TOGGLE_DOC_INTEL') {
      document.dispatchEvent(new CustomEvent('follow-toggle-doc-intel'))
    }

    if (msg.type === 'SMART_DOC_ACTIVATED' && msg.payload) {
      document.dispatchEvent(new CustomEvent('follow-smart-doc-active', { detail: msg.payload }))
    }

    if (msg.type === 'SMART_DOC_DEACTIVATED' && msg.payload) {
      document.dispatchEvent(new CustomEvent('follow-smart-doc-deactivated', { detail: msg.payload }))
    }

    if (msg.type === 'GET_COLLABORATORS') {
      // Read collaborator names from DOM (Google Docs cursor name elements)
      const names: string[] = []
      document.querySelectorAll('.kix-cursor-name').forEach(el => {
        const name = el.textContent?.trim()
        if (name) names.push(name)
      })
      sendResponse({ success: true, data: { collaborators: names } })
      return true // Keep channel open for async
    }
  })

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    unloadAllFeatures()
  })
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
