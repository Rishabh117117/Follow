/**
 * Follow Unified Extension — Background Service Worker
 *
 * Lightweight entry point that:
 * 1. Registers context menus on install
 * 2. Sets up chrome.alarms for background signal flush
 * 3. Routes keyboard commands to content scripts
 * 4. Delegates all message handling to message-router.ts
 * 5. Handles MV3 wake/sleep lifecycle properly
 */

import { registerContextMenus } from './context-menus'
import { handleMessage } from './message-router'
import { STORAGE_KEYS } from '@/lib/constants'

// ─── Lifecycle ───────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    registerContextMenus()

    // Check auth status on install
    const data = await chrome.storage.local.get(STORAGE_KEYS.AUTH_TOKEN)
    if (!data[STORAGE_KEYS.AUTH_TOKEN]) {
      chrome.action.setBadgeText({ text: '!' })
      chrome.action.setBadgeBackgroundColor({ color: '#6366F1' })
    }
  }

  // Set up alarms for background work (MV3-safe, persists across wake/sleep)
  chrome.alarms.create('signal-flush', { periodInMinutes: 1 })
})

// ─── Alarms (MV3 wake-safe timers) ──────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'signal-flush') {
    // Check if there's a pending offline queue to flush
    const stored = await chrome.storage.local.get('follow_offline_signal_queue')
    const queue = stored['follow_offline_signal_queue']
    if (Array.isArray(queue) && queue.length > 0) {
      // Re-attempt flush by forwarding to any active content script
      // The content script's signal pipeline handles the actual flush
      console.log('[SW] Offline queue has', queue.length, 'signals — will flush on next tab activation')
    }
  }
})

// ─── Message Routing ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(handleMessage)

// ─── Context Menu Click Handler ──────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return

  switch (info.menuItemId) {
    case 'ask-follow':
      if (info.selectionText) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'CONTEXT_MENU_ASK_FOLLOW',
          payload: { selectedText: info.selectionText },
        })
      }
      break

    case 'capture-to-workspace':
      chrome.tabs.sendMessage(tab.id, {
        type: 'CAPTURE_PAGE',
        payload: {
          sourceUrl: info.pageUrl || tab.url,
          title: tab.title,
          content: info.selectionText || undefined,
        },
      })
      break

    case 'analyze-pdf':
      if (info.linkUrl || tab.url) {
        const pdfUrl = info.linkUrl || tab.url
        // Open in the webapp's PDF viewer
        const authData = await chrome.storage.local.get(STORAGE_KEYS.API_BASE_URL)
        const apiUrl = (authData[STORAGE_KEYS.API_BASE_URL] as string) || 'http://localhost:3001'
        const webUrl = apiUrl.replace(':3001', ':3000')
        chrome.tabs.create({ url: `${webUrl}/pdf-viewer?url=${encodeURIComponent(pdfUrl!)}` })
      }
      break
  }
})

// ─── Keyboard Commands ──────────────────────────────────────────────────

chrome.commands?.onCommand?.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return

  switch (command) {
    case 'toggle-follow':
    case 'toggle-provenance':
      chrome.tabs.sendMessage(tab.id, { type: 'COMMAND', payload: { command } })
      break
    case 'toggle-doc-intel':
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_DOC_INTEL' })
      break
  }
})

// ─── Web Navigation Signals (tab_switch, page_navigate) ─────────────────

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId)
    // Store for content scripts that want to emit tab_switch signals
    await chrome.storage.session.set({
      activeTabInfo: { tabId: activeInfo.tabId, url: tab.url, title: tab.title, timestamp: Date.now() },
    })
  } catch {
    // Tab may have been closed
  }
})

chrome.idle.onStateChanged.addListener((state) => {
  // Store idle state for content scripts
  chrome.storage.session.set({ idleState: state }).catch(() => {})
})
