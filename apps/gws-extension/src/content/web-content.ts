/**
 * Follow GWS Extension — Web Content Script (non-Google-Workspace pages)
 *
 * Lightweight entry point for "Chat in Web" feature.
 * IMPORTANT: This script runs on ALL URLs. It must be as lightweight as possible.
 * - Does NOT create shadow DOM until chat_in_web is actually enabled
 * - Does NOT import React or any heavy modules until needed
 * - Only reads a single toggle from chrome.storage
 */

import { STORAGE_KEYS } from '@/lib/constants'
import type { FeatureKey } from '@/lib/constants'

let mounted = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let root: any = null
let mountPoint: HTMLElement | null = null

async function mountChat() {
  if (mounted) return

  // Lazy-create shadow DOM only when actually needed
  const { createShadowHost, getMountPoint } = await import('./shadow-host')
  createShadowHost()
  mountPoint = getMountPoint()
  if (!mountPoint) return

  const { createRoot } = await import('react-dom/client')
  const { createElement } = await import('react')
  const { WebChatApp } = await import('@/app/WebChatApp')

  root = createRoot(mountPoint)
  root.render(createElement(WebChatApp))
  mounted = true
}

function unmountChat() {
  if (!mounted || !root) return
  root.unmount()
  root = null
  mounted = false

  // Remove shadow host element
  const host = document.getElementById('follow-gws-root')
  if (host) host.remove()
  mountPoint = null
}

async function init() {
  // Quick check: is chat_in_web enabled?
  const result = await chrome.storage.local.get(STORAGE_KEYS.FEATURE_TOGGLES)
  const toggles = result[STORAGE_KEYS.FEATURE_TOGGLES] || {}

  // Only mount if already enabled — otherwise just listen for toggle changes
  if (toggles.chat_in_web) {
    await mountChat()
  }

  // Listen for toggle changes from service worker
  chrome.runtime?.onMessage?.addListener(
    (msg: { type: string; payload?: { feature?: FeatureKey; enabled?: boolean } }) => {
      if (msg.type === 'FEATURE_TOGGLE_CHANGED' && msg.payload?.feature === 'chat_in_web') {
        if (msg.payload.enabled) {
          mountChat()
        } else {
          unmountChat()
        }
      }
    }
  )

  window.addEventListener('beforeunload', () => {
    unmountChat()
  })
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
