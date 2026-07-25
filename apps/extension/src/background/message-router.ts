/**
 * Message Router — unified message handler for the service worker.
 *
 * Routes all chrome.runtime.onMessage to the appropriate API proxy functions.
 * Replaces both the GWS service-worker.ts switch/case and WA background.js handlers.
 */

import type { ExtensionMessage, ExtensionResponse } from '@/core/message-bus'
import { getAuth, setAuth, clearAuth, getFeatureToggles, setFeatureToggles, getActiveSmartDocs, setActiveSmartDocs } from '@/core/storage'
import { DEFAULT_API_BASE_URL, STORAGE_KEYS } from '@/lib/constants'
import * as api from './api-proxy'

type SendResponse = (response: ExtensionResponse) => void

export function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse
): boolean {
  handleAsync(message, sender, sendResponse)
  return true // Keep channel open for async
}

async function handleAsync(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse
): Promise<void> {
  switch (message.type) {
    // ─── Auth ──────────────────────────────────────────────────────────
    case 'AUTH_TOKEN_SET': {
      const { token, userId, workspaceId, apiBaseUrl, email, name, avatarUrl } = message.payload as {
        token: string; userId: string; workspaceId: string; apiBaseUrl?: string
        email?: string; name?: string; avatarUrl?: string
      }
      await setAuth({
        token, userId, workspaceId,
        apiBaseUrl: apiBaseUrl || undefined,
        email: email || null,
        name: name || null,
        avatarUrl: avatarUrl || null,
      })
      chrome.action.setBadgeText({ text: '' })
      sendResponse({ success: true })
      break
    }

    case 'AUTH_TOKEN_GET': {
      const auth = await getAuth()
      sendResponse({
        success: true,
        data: {
          token: auth.token, userId: auth.userId, workspaceId: auth.workspaceId,
          apiBaseUrl: auth.apiBaseUrl, email: auth.email, name: auth.name, avatarUrl: auth.avatarUrl,
        },
      })
      break
    }

    case 'AUTH_TOKEN_CLEAR': {
      await clearAuth()
      chrome.action.setBadgeText({ text: '!' })
      chrome.action.setBadgeBackgroundColor({ color: '#6366F1' })
      sendResponse({ success: true })
      break
    }

    // ─── Smart Doc Lifecycle ──────────────────────────────────────────
    case 'SMART_DOC_ACTIVATE': {
      const payload = message.payload as {
        externalDocId: string; docType: string; title: string; workspaceId: string; strandId?: string
      }
      // Fill in workspaceId from storage if content script didn't provide one
      if (!payload.workspaceId) {
        const auth = await getAuth()
        payload.workspaceId = auth.workspaceId || ''
      }
      const result = await api.activateSmartDoc(payload)

      if (result.success && result.data) {
        // Cache locally
        const docs = await getActiveSmartDocs()
        docs[payload.externalDocId] = result.data
        await setActiveSmartDocs(docs)

        // Notify content script
        notifyActiveTab({
          type: 'SMART_DOC_ACTIVATED',
          payload: { ...(result.data as Record<string, unknown>), googleDocId: payload.externalDocId, docType: payload.docType },
        })
      }

      sendResponse(result)
      break
    }

    case 'SMART_DOC_DEACTIVATE': {
      const { externalDocId } = message.payload as { externalDocId: string }
      const result = await api.deactivateSmartDoc(externalDocId)

      if (result.success) {
        const docs = await getActiveSmartDocs()
        delete docs[externalDocId]
        await setActiveSmartDocs(docs)
        notifyActiveTab({ type: 'SMART_DOC_DEACTIVATED', payload: { externalDocId } })
      }

      sendResponse(result)
      break
    }

    case 'SMART_DOC_STATUS': {
      const { externalDocId } = message.payload as { externalDocId: string }
      // Always check backend first to avoid stale cache (PGlite resets on restart)
      const result = await api.getSmartDocStatus(externalDocId)
      const docs = await getActiveSmartDocs()
      if (result.success && result.data) {
        docs[externalDocId] = result.data
        await setActiveSmartDocs(docs)
      } else {
        // Backend doesn't have it — clear stale cache entry
        delete docs[externalDocId]
        await setActiveSmartDocs(docs)
      }
      sendResponse(result)
      break
    }

    // ─── Signal Batches ───────────────────────────────────────────────
    case 'SIGNAL_BATCH_GWS': {
      const { externalDocId, signals } = message.payload as { externalDocId: string; signals: unknown[] }
      const result = await api.forwardGWSSignals(externalDocId, signals)
      sendResponse(result)
      break
    }

    case 'SIGNAL_BATCH_WEB': {
      const { signals } = message.payload as { signals: Array<{ signalType: string; payload: Record<string, unknown>; timestamp: string }> }
      const auth = await getAuth()
      // Map internal signal format to capture API format
      const mapped = signals.map((s) => ({
        type: s.signalType,
        timestamp: s.timestamp,
        url: (s.payload.url as string) || undefined,
        domain: (s.payload.domain as string) || undefined,
        title: (s.payload.title as string) || undefined,
        metadata: s.payload,
      }))
      const result = await api.forwardWebSignals({
        workspaceId: auth.workspaceId || '',
        userId: auth.userId || '',
        sessionId: `ext-${Date.now()}`,
        signals: mapped,
      })
      sendResponse(result)
      break
    }

    // ─── Content Sync ─────────────────────────────────────────────────
    case 'CONTENT_SYNC': {
      const { externalDocId, content } = message.payload as { externalDocId: string; content: string }
      const result = await api.syncDocContent(externalDocId, content)
      sendResponse(result)
      break
    }

    // ─── Addon Bridge ─────────────────────────────────────────────────
    case 'ADDON_ACTION_POLL': {
      const { followDocId } = message.payload as { followDocId: string }
      const result = await api.pollAddonActions(followDocId)
      sendResponse(result.success ? result : { success: true, data: { action: null } })
      break
    }

    case 'ADDON_ACTION_CLEAR': {
      const { followDocId } = message.payload as { followDocId: string }
      const result = await api.clearAddonAction(followDocId)
      sendResponse(result)
      break
    }

    // ─── Data Fetching ────────────────────────────────────────────────
    case 'FETCH_PROVENANCE': {
      const { externalDocId } = message.payload as { externalDocId: string }
      sendResponse(await api.fetchProvenance(externalDocId))
      break
    }

    case 'FETCH_DOC_STATS': {
      const { externalDocId } = message.payload as { externalDocId: string }
      sendResponse(await api.fetchDocStats(externalDocId))
      break
    }

    case 'FETCH_THREAD_EVENTS': {
      const { externalDocId, threadId, limit, before } = message.payload as {
        externalDocId: string; threadId: string; limit?: number; before?: string
      }
      sendResponse(await api.fetchThreadEvents(externalDocId, threadId, limit, before))
      break
    }

    case 'FETCH_STRAND_ACTIVITY': {
      const { strandId, limit, before } = message.payload as { strandId: string; limit?: number; before?: string }
      sendResponse(await api.fetchStrandActivity(strandId, limit, before))
      break
    }

    case 'FETCH_STRANDS': {
      const { workspaceId } = message.payload as { workspaceId: string }
      sendResponse(await api.fetchStrands(workspaceId))
      break
    }

    case 'FETCH_DOC_MEMORY': {
      const { followDocId } = message.payload as { followDocId: string }
      sendResponse(await api.fetchDocMemory(followDocId))
      break
    }

    // ─── Google Auth (launchWebAuthFlow — works for unpacked dev extensions) ──
    case 'GET_GOOGLE_AUTH_TOKEN': {
      const GOOGLE_CLIENT_ID = '502240205650-c7bgheshghniu8rt16dodn0eb1lamt0k.apps.googleusercontent.com'
      const redirectUrl = chrome.identity.getRedirectURL()
      const scopes = [
        'openid',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/presentations',
      ].join(' ')

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(redirectUrl)}&scope=${encodeURIComponent(scopes)}`

      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'Auth cancelled' })
          return
        }
        // Extract access_token from redirect URL fragment
        const hashParams = new URLSearchParams(responseUrl.split('#')[1] || '')
        const token = hashParams.get('access_token')
        if (token) {
          sendResponse({ success: true, data: { token } })
        } else {
          sendResponse({ success: false, error: 'No access token in response' })
        }
      })
      break
    }

    case 'REVOKE_GOOGLE_AUTH_TOKEN': {
      // Revoke via Google's revocation endpoint
      const auth = await getAuth()
      if (auth.token) {
        try {
          await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${auth.token}`)
        } catch { /* best effort */ }
      }
      sendResponse({ success: true })
      break
    }

    case 'GET_COLLABORATORS': {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'GET_COLLABORATORS' }, (response) => {
            sendResponse(response ?? { success: true, data: { collaborators: [] } })
          })
        } else {
          sendResponse({ success: true, data: { collaborators: [] } })
        }
      } catch {
        sendResponse({ success: true, data: { collaborators: [] } })
      }
      break
    }

    case 'GET_GOOGLE_AUTH_TOKEN_SILENT': {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (chrome.runtime.lastError || !token) {
          sendResponse({ success: false, error: 'Not connected' })
        } else {
          sendResponse({ success: true, data: { token } })
        }
      })
      break
    }

    // ─── Feature Toggles ──────────────────────────────────────────────
    case 'FEATURE_TOGGLES_GET': {
      const toggles = await getFeatureToggles()
      sendResponse({ success: true, data: toggles })
      break
    }

    case 'FEATURE_TOGGLE_CHANGED': {
      const { feature, enabled } = message.payload as { feature: string; enabled: boolean }
      const toggles = await getFeatureToggles()
      toggles[feature] = enabled
      await setFeatureToggles(toggles)

      // Update badge
      const activeCount = Object.values(toggles).filter(Boolean).length
      chrome.action.setBadgeText({ text: activeCount > 0 ? String(activeCount) : '' })
      chrome.action.setBadgeBackgroundColor({ color: '#6366F1' })

      // Deactivate smart doc when tracking is turned OFF
      if (feature === 'track_document' && !enabled) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (tab?.url) {
            const docMatch = tab.url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/)
            if (docMatch?.[2]) {
              await api.deactivateSmartDoc(docMatch[2])
              const docs = await getActiveSmartDocs()
              delete docs[docMatch[2]]
              await setActiveSmartDocs(docs)
            }
          }
        } catch (err) {
          console.warn('[Follow] Smart doc deactivation failed:', err)
        }
      }

      // Notify content script
      notifyActiveTab({ type: 'FEATURE_TOGGLE_CHANGED', payload: { feature, enabled, toggles } })

      sendResponse({ success: true })
      break
    }

    // ─── Badge ────────────────────────────────────────────────────────
    case 'BADGE_UPDATE': {
      const { text, color } = message.payload as { text: string; color: string }
      chrome.action.setBadgeText({ text })
      if (color) chrome.action.setBadgeBackgroundColor({ color })
      sendResponse({ success: true })
      break
    }

    // ─── Connection Status ────────────────────────────────────────────
    case 'GET_CONNECTION_STATUS': {
      const auth = await getAuth()
      sendResponse({ success: true, data: { connected: !!auth.token } })
      break
    }

    case 'GET_ACTIVE_TAB_DOC': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      sendResponse({ success: true, data: { url: tab?.url, title: tab?.title } })
      break
    }

    // ─── Web Capture ──────────────────────────────────────────────────
    case 'CAPTURE_PAGE': {
      const capturePayload = message.payload as {
        sourceUrl: string; title: string; content?: string
      }
      const auth = await getAuth()
      const result = await api.captureWebPage({
        workspaceId: auth.workspaceId || '',
        sourceUrl: capturePayload.sourceUrl,
        title: capturePayload.title,
        content: capturePayload.content,
        source: 'web_extension',
      })
      sendResponse(result)
      break
    }

    // ─── Doc Intel Proxy ──────────────────────────────────────────────
    case 'DOC_INTEL_REQUEST': {
      const { action, ...rest } = message.payload as { action: string; [k: string]: unknown }
      let result
      if (action === 'suggest') result = await api.docIntelSuggest(rest)
      else if (action === 'analyze') result = await api.docIntelAnalyze(rest)
      else if (action === 'synthesize') result = await api.docIntelSynthesize(rest)
      else if (action === 'regenerate') result = await api.docIntelRegenerate(rest)
      else result = { success: false, error: `Unknown doc-intel action: ${action}` }
      sendResponse(result)
      break
    }

    // ─── Feature Script Injection ────────────────────────────────────
    case 'INJECT_FEATURE_SCRIPT': {
      const { script } = message.payload as { script: string }
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.id) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: [script],
          })
          sendResponse({ success: true })
        } else {
          sendResponse({ success: false, error: 'No active tab' })
        }
      } catch (err) {
        sendResponse({ success: false, error: (err as Error).message })
      }
      break
    }

    default:
      sendResponse({ success: false, error: `Unknown message type: ${message.type}` })
  }
}

/**
 * Send a message to the active tab's content script (best-effort).
 */
async function notifyActiveTab(message: ExtensionMessage): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, message)
    }
  } catch {
    // Content script may not be loaded
  }
}
