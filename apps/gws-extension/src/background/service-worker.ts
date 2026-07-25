/**
 * Follow GWS Extension — Background Service Worker
 *
 * Handles:
 * 1. Extension install/update lifecycle
 * 2. Auth token management (chrome.storage.local)
 * 3. Message routing between content scripts and popup
 * 4. Badge text updates (signal count, connection status)
 * 5. Signal batch forwarding to Follow backend
 */

import { STORAGE_KEYS, DEFAULT_API_BASE_URL, type FeatureKey } from '@/lib/constants'
import type { ExtensionMessage, ExtensionResponse } from '@/lib/message-passing'

// ─── Lifecycle ───────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Check if user has auth token — if not, open onboarding
    const data = await chrome.storage.local.get(STORAGE_KEYS.AUTH_TOKEN)
    if (!data[STORAGE_KEYS.AUTH_TOKEN]) {
      chrome.action.setBadgeText({ text: '!' })
      chrome.action.setBadgeBackgroundColor({ color: '#6366F1' })
    }
  }

  // Register right-click context menu for selected text
  chrome.contextMenus.create({
    id: 'ask-follow',
    title: 'Ask Follow...',
    contexts: ['selection'],
    documentUrlPatterns: ['https://docs.google.com/*'],
  })
})

// Handle context menu click — open Follow chat with the selected text
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'ask-follow' && tab?.id && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'CONTEXT_MENU_ASK_FOLLOW',
      payload: { selectedText: info.selectionText },
    })
  }
})

// ─── Chrome commands (keyboard shortcuts from manifest) ──────────────────

chrome.commands?.onCommand?.addListener(async (command) => {
  if (command === 'toggle-follow') {
    // Forward to content script in active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'COMMAND', payload: { command: 'toggle-follow' } })
    }
  } else if (command === 'toggle-provenance') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'COMMAND', payload: { command: 'toggle-provenance' } })
    }
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────────

async function getApiBaseUrl(): Promise<string> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.API_BASE_URL)
  return (data[STORAGE_KEYS.API_BASE_URL] as string) || DEFAULT_API_BASE_URL
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.AUTH_TOKEN,
    STORAGE_KEYS.USER_ID,
    STORAGE_KEYS.WORKSPACE_ID,
  ])

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const token = data[STORAGE_KEYS.AUTH_TOKEN] as string | undefined
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const userId = data[STORAGE_KEYS.USER_ID] as string | undefined
  if (userId) {
    headers['x-user-id'] = userId
  }

  const workspaceId = data[STORAGE_KEYS.WORKSPACE_ID] as string | undefined
  if (workspaceId) {
    headers['x-workspace-id'] = workspaceId
  }

  return headers
}

// ─── Connection status + fetch retry ─────────────────────────────────────

type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'
let currentConnectionStatus: ConnectionStatus = 'connected'

function broadcastConnectionStatus(status: ConnectionStatus): void {
  if (status === currentConnectionStatus) return
  currentConnectionStatus = status
  try {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (!tab.id) continue
        if (!tab.url?.includes('docs.google.com')) continue
        try {
          chrome.tabs.sendMessage(tab.id, {
            type: 'CONNECTION_STATUS_CHANGED',
            payload: { status },
          })
        } catch {
          // Content script may not be loaded
        }
      }
    })
  } catch {
    // No tabs permission
  }
}

function broadcastAuthExpired(): void {
  try {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (!tab.id || !tab.url?.includes('docs.google.com')) continue
        try {
          chrome.tabs.sendMessage(tab.id, { type: 'AUTH_EXPIRED' })
        } catch {
          // best effort
        }
      }
    })
  } catch {
    // ignore
  }
}

class AuthError extends Error {
  constructor() {
    super('Auth expired')
    this.name = 'AuthError'
  }
}

/**
 * fetchWithRetry — wraps fetch with exponential backoff (1s, 3s, 9s) and
 * connection status broadcasting. 401 triggers AUTH_EXPIRED and does not retry.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastErr: unknown = new Error('fetchWithRetry: no attempts')
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options)
      if (res.status === 401) {
        broadcastAuthExpired()
        throw new AuthError()
      }
      if (!res.ok && res.status >= 500) {
        throw new Error(`HTTP ${res.status}`)
      }
      broadcastConnectionStatus('connected')
      return res
    } catch (e) {
      lastErr = e
      if (e instanceof AuthError) throw e
      broadcastConnectionStatus(i < maxRetries - 1 ? 'reconnecting' : 'disconnected')
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, Math.pow(3, i) * 1000))
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('API unreachable after retries')
}

// ─── Signal batch forwarding ─────────────────────────────────────────────

async function forwardSignalBatch(
  externalDocId: string,
  signals: unknown[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const baseUrl = await getApiBaseUrl()
    const headers = await getAuthHeaders()

    const res = await fetchWithRetry(`${baseUrl}/api/gws/documents/${externalDocId}/signals`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ signals }),
    })

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` }
    }
    return { success: true }
  } catch (err) {
    if (err instanceof AuthError) {
      return { success: false, error: 'auth_expired' }
    }
    return { success: false, error: (err as Error).message }
  }
}

// ─── Document activation ────────────────────────────────────────────────

async function activateSmartDoc(payload: {
  externalDocId: string
  docType: string
  title: string
  workspaceId: string
  strandId?: string
}): Promise<ExtensionResponse> {
  try {
    const baseUrl = await getApiBaseUrl()
    const headers = await getAuthHeaders()

    const res = await fetch(`${baseUrl}/api/gws/documents`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const text = await res.text()
      return { success: false, error: `HTTP ${res.status}: ${text}` }
    }

    const data = await res.json()

    // Store in active smart docs
    const stored = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_SMART_DOCS)
    const activeDocs = (stored[STORAGE_KEYS.ACTIVE_SMART_DOCS] as Record<string, unknown>) || {}
    activeDocs[payload.externalDocId] = data.data
    await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_SMART_DOCS]: activeDocs })

    return { success: true, data: data.data }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

async function getSmartDocStatus(externalDocId: string): Promise<ExtensionResponse> {
  try {
    // Check local cache first
    const stored = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_SMART_DOCS)
    const activeDocs = (stored[STORAGE_KEYS.ACTIVE_SMART_DOCS] as Record<string, unknown>) || {}
    if (activeDocs[externalDocId]) {
      return { success: true, data: activeDocs[externalDocId] }
    }

    // Check backend
    const baseUrl = await getApiBaseUrl()
    const headers = await getAuthHeaders()

    const res = await fetch(`${baseUrl}/api/gws/documents/${externalDocId}`, {
      headers,
    })

    if (!res.ok) {
      return { success: true, data: null }
    }

    const data = await res.json()
    if (data.data) {
      // Cache locally
      activeDocs[externalDocId] = data.data
      await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_SMART_DOCS]: activeDocs })
    }

    return { success: true, data: data.data }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

async function deactivateSmartDoc(externalDocId: string): Promise<ExtensionResponse> {
  try {
    const baseUrl = await getApiBaseUrl()
    const headers = await getAuthHeaders()

    const res = await fetch(`${baseUrl}/api/gws/documents/${externalDocId}`, {
      method: 'DELETE',
      headers,
    })

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` }
    }

    // Remove from local cache
    const stored = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_SMART_DOCS)
    const activeDocs = (stored[STORAGE_KEYS.ACTIVE_SMART_DOCS] as Record<string, unknown>) || {}
    delete activeDocs[externalDocId]
    await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_SMART_DOCS]: activeDocs })

    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

// ─── Message Router ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (response: ExtensionResponse) => void) => {
    const handleAsync = async () => {
      switch (message.type) {
        case 'AUTH_TOKEN_SET': {
          const { token, userId, workspaceId, apiBaseUrl } = message.payload as {
            token: string
            userId: string
            workspaceId: string
            apiBaseUrl?: string
          }
          await chrome.storage.local.set({
            [STORAGE_KEYS.AUTH_TOKEN]: token,
            [STORAGE_KEYS.USER_ID]: userId,
            [STORAGE_KEYS.WORKSPACE_ID]: workspaceId,
            ...(apiBaseUrl ? { [STORAGE_KEYS.API_BASE_URL]: apiBaseUrl } : {}),
          })
          chrome.action.setBadgeText({ text: '' })
          sendResponse({ success: true })
          break
        }

        case 'AUTH_TOKEN_GET': {
          const data = await chrome.storage.local.get([
            STORAGE_KEYS.AUTH_TOKEN,
            STORAGE_KEYS.USER_ID,
            STORAGE_KEYS.WORKSPACE_ID,
            STORAGE_KEYS.API_BASE_URL,
          ])
          sendResponse({
            success: true,
            data: {
              token: data[STORAGE_KEYS.AUTH_TOKEN],
              userId: data[STORAGE_KEYS.USER_ID],
              workspaceId: data[STORAGE_KEYS.WORKSPACE_ID],
              apiBaseUrl: data[STORAGE_KEYS.API_BASE_URL] || DEFAULT_API_BASE_URL,
            },
          })
          break
        }

        case 'AUTH_TOKEN_CLEAR': {
          await chrome.storage.local.remove([
            STORAGE_KEYS.AUTH_TOKEN,
            STORAGE_KEYS.USER_ID,
            STORAGE_KEYS.WORKSPACE_ID,
            STORAGE_KEYS.ACTIVE_SMART_DOCS,
          ])
          chrome.action.setBadgeText({ text: '!' })
          chrome.action.setBadgeBackgroundColor({ color: '#6366F1' })
          sendResponse({ success: true })
          break
        }

        case 'SMART_DOC_ACTIVATE': {
          const activatePayload = message.payload as {
            externalDocId: string
            docType: string
            title: string
            workspaceId: string
            strandId?: string
          }
          // Fill in workspaceId from storage if content script didn't provide one
          if (!activatePayload.workspaceId) {
            const wsData = await chrome.storage.local.get(STORAGE_KEYS.WORKSPACE_ID)
            activatePayload.workspaceId = (wsData[STORAGE_KEYS.WORKSPACE_ID] as string) || ''
          }
          const result = await activateSmartDoc(activatePayload)

          // Notify the active tab's content script so the React app updates
          if (result.success && result.data) {
            try {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
              if (tab?.id) {
                chrome.tabs.sendMessage(tab.id, {
                  type: 'SMART_DOC_ACTIVATED',
                  payload: {
                    ...(result.data as Record<string, unknown>),
                    googleDocId: activatePayload.externalDocId,
                    docType: activatePayload.docType,
                  },
                })
              }
            } catch {
              // Best-effort notification
            }
          }

          sendResponse(result)
          break
        }

        case 'SMART_DOC_DEACTIVATE': {
          const { externalDocId: deactDocId } = message.payload as { externalDocId: string }
          const result = await deactivateSmartDoc(deactDocId)

          // Notify the active tab's content script
          if (result.success) {
            try {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
              if (tab?.id) {
                chrome.tabs.sendMessage(tab.id, {
                  type: 'SMART_DOC_DEACTIVATED',
                  payload: { externalDocId: deactDocId },
                })
              }
            } catch {
              // Best-effort
            }
          }

          sendResponse(result)
          break
        }

        case 'SMART_DOC_STATUS': {
          const { externalDocId } = message.payload as { externalDocId: string }
          const result = await getSmartDocStatus(externalDocId)
          sendResponse(result)
          break
        }

        case 'SIGNAL_BATCH': {
          const { externalDocId, signals } = message.payload as {
            externalDocId: string
            signals: unknown[]
          }
          const result = await forwardSignalBatch(externalDocId, signals)
          sendResponse(result)
          break
        }

        case 'GET_CONNECTION_STATUS': {
          const data = await chrome.storage.local.get(STORAGE_KEYS.AUTH_TOKEN)
          const hasToken = !!data[STORAGE_KEYS.AUTH_TOKEN]
          sendResponse({ success: true, data: { connected: hasToken } })
          break
        }

        case 'CONTENT_SYNC': {
          // Forward content snapshot to backend for AI context.
          // docType ('docs' | 'sheets' | 'slides') + auxiliary fields
          // (sheetName, slideIndex) let buildGWSDocumentContext pick the right builder.
          const {
            externalDocId: syncDocId,
            content,
            paragraphCount,
            docType: syncDocType,
            sheetName,
            slideIndex,
          } = message.payload as {
            externalDocId: string
            content: string
            paragraphCount: number
            docType?: 'docs' | 'sheets' | 'slides'
            sheetName?: string
            slideIndex?: number
          }
          try {
            const baseUrl = await getApiBaseUrl()
            const headers = await getAuthHeaders()
            await fetch(`${baseUrl}/api/gws/documents/${syncDocId}/content`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                content,
                revisionId: `snapshot-${Date.now()}`,
                docType: syncDocType,
                sheetName,
                slideIndex,
                paragraphCount,
              }),
            })
            sendResponse({ success: true })
          } catch {
            sendResponse({ success: false, error: 'Content sync failed' })
          }
          break
        }

        case 'GET_SMART_DOC_INFO': {
          // Forward to content script in the active tab so the popup can read
          // the per-tab smart-doc-store snapshot (title, recording, signalCount, lastSignalAt).
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (!tab?.id) {
              sendResponse({ success: true, data: null })
              break
            }
            const info = await new Promise<unknown>((resolve) => {
              try {
                chrome.tabs.sendMessage(tab.id!, { type: 'GET_SMART_DOC_INFO' }, (res: unknown) => {
                  if (chrome.runtime.lastError) resolve(null)
                  else resolve(res)
                })
              } catch {
                resolve(null)
              }
            })
            if (info && typeof info === 'object' && 'data' in (info as Record<string, unknown>)) {
              sendResponse(info as ExtensionResponse)
            } else {
              sendResponse({ success: true, data: null })
            }
          } catch (err) {
            sendResponse({ success: false, error: (err as Error).message })
          }
          break
        }

        case 'GET_ACTIVE_TAB_DOC': {
          // Query active tab to get its URL for the popup
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          sendResponse({
            success: true,
            data: { url: tab?.url, title: tab?.title },
          })
          break
        }

        // ─── Badge updates (G8: offline queue status) ─────────────────────

        case 'BADGE_UPDATE': {
          const { text: badgeText, color: badgeColor } = message.payload as {
            text: string
            color: string
          }
          chrome.action.setBadgeText({ text: badgeText })
          if (badgeColor) chrome.action.setBadgeBackgroundColor({ color: badgeColor })
          sendResponse({ success: true })
          break
        }

        // ─── G7: Addon Bridge Polling ────────────────────────────────────

        case 'ADDON_ACTION_POLL': {
          const { followDocId: pollDocId } = message.payload as { followDocId: string }
          try {
            const baseUrl = await getApiBaseUrl()
            const headers = await getAuthHeaders()
            const res = await fetch(`${baseUrl}/api/gws/documents/${pollDocId}/addon-actions`, { headers })
            if (res.ok) {
              const data = await res.json()
              sendResponse({ success: true, data })
            } else {
              sendResponse({ success: true, data: { action: null } })
            }
          } catch {
            sendResponse({ success: true, data: { action: null } })
          }
          break
        }

        case 'QUEUE_ADDON_ACTION': {
          // E-2: queue an insertion action (INSERT_AFTER_PARAGRAPH / REPLACE_TEXT_RANGE)
          // against the active document's pendingActions list. Returns an actionId
          // that the insertion-service polls via CHECK_ADDON_ACTION_STATUS.
          const { action } = message.payload as { action: Record<string, unknown> }
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            const url = tab?.url || ''
            const match = url.match(/\/(?:document|spreadsheets|presentation)\/d\/([^/]+)/)
            const googleDocId = match?.[1]
            if (!googleDocId) {
              sendResponse({ success: false, error: 'No active Google document' })
              break
            }

            const baseUrl = await getApiBaseUrl()
            const headers = await getAuthHeaders()
            const res = await fetch(`${baseUrl}/api/gws/documents/${googleDocId}/addon-actions`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ action }),
            })
            if (!res.ok) {
              sendResponse({ success: false, error: `HTTP ${res.status}` })
              break
            }
            const json = await res.json()
            // Cache the docId alongside the actionId so CHECK can find it later
            const actionId = json.data?.actionId as string | undefined
            if (actionId) {
              const store = await chrome.storage.local.get('follow_pending_action_map')
              const map = (store.follow_pending_action_map as Record<string, string>) || {}
              map[actionId] = googleDocId
              await chrome.storage.local.set({ follow_pending_action_map: map })
            }
            sendResponse({ success: true, data: { queued: true, actionId } })
          } catch (err) {
            sendResponse({ success: false, error: (err as Error).message })
          }
          break
        }

        case 'CHECK_ADDON_ACTION_STATUS': {
          const { actionId } = message.payload as { actionId: string }
          try {
            const store = await chrome.storage.local.get('follow_pending_action_map')
            const map = (store.follow_pending_action_map as Record<string, string>) || {}
            const googleDocId = map[actionId]
            if (!googleDocId) {
              // Fall back to active tab
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
              const url = tab?.url || ''
              const match = url.match(/\/(?:document|spreadsheets|presentation)\/d\/([^/]+)/)
              if (!match?.[1]) {
                sendResponse({ success: false, error: 'Unknown action document' })
                break
              }
            }
            const docId = googleDocId || ''
            const baseUrl = await getApiBaseUrl()
            const headers = await getAuthHeaders()
            const res = await fetch(
              `${baseUrl}/api/gws/documents/${docId}/addon-actions/${actionId}`,
              { headers }
            )
            if (!res.ok) {
              sendResponse({ success: false, error: `HTTP ${res.status}` })
              break
            }
            const json = await res.json()
            const data = json.data as
              | { completed?: boolean; failed?: boolean; success?: boolean; error?: string }
              | undefined
            // If terminal, remove the cached mapping
            if (data?.completed || data?.failed) {
              const map2 = { ...map }
              delete map2[actionId]
              await chrome.storage.local.set({ follow_pending_action_map: map2 })
            }
            sendResponse({ success: true, data: data || {} })
          } catch (err) {
            sendResponse({ success: false, error: (err as Error).message })
          }
          break
        }

        case 'ADDON_ACTION_CLEAR': {
          const { followDocId: clearDocId } = message.payload as { followDocId: string }
          try {
            const baseUrl = await getApiBaseUrl()
            const headers = await getAuthHeaders()
            await fetch(`${baseUrl}/api/gws/documents/${clearDocId}/addon-actions`, {
              method: 'DELETE',
              headers,
            })
            sendResponse({ success: true })
          } catch {
            sendResponse({ success: false, error: 'Failed to clear action' })
          }
          break
        }

        // ─── G7: Provenance Data Fetching ────────────────────────────────

        case 'FETCH_PROVENANCE': {
          const { externalDocId: provDocId } = message.payload as { externalDocId: string }
          try {
            const baseUrl = await getApiBaseUrl()
            const headers = await getAuthHeaders()
            const res = await fetch(`${baseUrl}/api/gws/documents/${provDocId}/threads`, { headers })
            const data = await res.json()
            sendResponse({ success: true, data: data.data })
          } catch (err) {
            sendResponse({ success: false, error: (err as Error).message })
          }
          break
        }

        // ─── FE-3: Real provenance data handlers ───

        case 'FETCH_PROVENANCE_DATA': {
          const { workspaceId: fpWs, documentId: fpDoc, sectionFilter: fpSec } = message.payload as {
            workspaceId: string; documentId: string; sectionFilter?: string | null
          }
          try {
            const baseUrl = await getApiBaseUrl()
            const headers = await getAuthHeaders()
            const [indexRes, sharedRes, stateRes] = await Promise.all([
              fetch(`${baseUrl}/api/index/query`, {
                method: 'POST', headers,
                body: JSON.stringify({ workspaceId: fpWs, documentId: fpDoc, weightProfile: 'history', limit: 80, includeEpisodes: true, targetSection: fpSec || undefined }),
              }).then(r => r.json()).catch(() => ({ data: null })),
              fetch(`${baseUrl}/api/shared-state/${fpDoc}`, { headers }).then(r => r.json()).catch(() => ({ data: null })),
              fetch(`${baseUrl}/api/ai-state?workspaceId=${fpWs}&documentId=${fpDoc}`, { headers }).then(r => r.json()).catch(() => ({ data: null })),
            ])
            const results = indexRes.data?.results || []
            const epMap = indexRes.data?.episodes || {}
            const grouped = new Map<string, any[]>()
            for (const r of results) { if (!r.episodeId) continue; const l = grouped.get(r.episodeId) || []; l.push(r); grouped.set(r.episodeId, l) }
            const episodes = [...grouped.entries()].map(([epId, evts]) => {
              const ep = (epMap as Record<string, any>)[epId]
              const sorted = evts.sort((a: any, b: any) => new Date(a.timestamp || a.eventTime).getTime() - new Date(b.timestamp || b.eventTime).getTime())
              return { id: epId, title: ep?.title || 'Untitled episode', startTime: sorted[0]?.timestamp || '', endTime: sorted[sorted.length - 1]?.timestamp || '', userNames: [...new Set(evts.map((e: any) => e.userName).filter(Boolean))], surfaces: [...new Set(evts.map((e: any) => e.threadType))], hasKeyChange: evts.some((e: any) => e.isKeyChange), primarySection: ep?.primarySection || null, eventCount: evts.length, events: evts.map((e: any) => ({ label: e.label || 'Unknown', threadType: e.threadType, timestamp: e.timestamp || e.eventTime, isKeyChange: e.isKeyChange || false, isAIInvolved: e.isAIInvolved || false, hasEvidence: e.hasEvidence || false })) }
            }).sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime())
            sendResponse({ success: true, data: { episodes, sharedState: sharedRes.data || null, aiState: stateRes.data ? { tensions: stateRes.data.event?.activeTensions || [], newFromTeam: stateRes.data.session?.newFromTeam || [] } : null } })
          } catch (err) { sendResponse({ success: false, error: (err as Error).message }) }
          break
        }

        case 'FETCH_PARAGRAPH_PROVENANCE': {
          const { workspaceId: ppWs, documentId: ppDoc, sectionRef: ppSec } = message.payload as { workspaceId: string; documentId: string; sectionRef: string }
          try {
            const baseUrl = await getApiBaseUrl()
            const headers = await getAuthHeaders()
            const res = await fetch(`${baseUrl}/api/index/query`, { method: 'POST', headers, body: JSON.stringify({ workspaceId: ppWs, documentId: ppDoc, targetSection: ppSec, weightProfile: 'focused', includeEvidence: true, limit: 10 }) }).then(r => r.json())
            const evts = res.data?.results || []
            const lastEdit = evts.find((e: any) => e.threadType === 'doc')
            const srcEv = evts.find((e: any) => e.evidence?.evidenceType === 'source_introduced')
            const aiEv = evts.find((e: any) => e.isAIInvolved)
            sendResponse({ success: true, data: { lastEditor: lastEdit ? { name: lastEdit.userName, timestamp: lastEdit.timestamp || lastEdit.eventTime } : null, source: srcEv?.evidence?.sourceSnapshot ? { title: srcEv.evidence.sourceSnapshot.title, browseDuration: srcEv.evidence.sourceSnapshot.browseDuration } : null, aiInvolvement: aiEv ? { type: aiEv.evidence?.evidenceType === 'ai_accepted' ? 'accepted' : 'involved', detail: aiEv.evidence?.chatExchange ? 'content assist' : 'grammar assist' } : null, evidenceVerified: evts.some((e: any) => e.hasEvidence) } })
          } catch (err) { sendResponse({ success: false, error: (err as Error).message }) }
          break
        }

        case 'MARK_TEAM_UPDATES_SURFACED': {
          const { workspaceId: muWs } = message.payload as { workspaceId: string }
          try {
            const baseUrl = await getApiBaseUrl()
            const headers = await getAuthHeaders()
            await fetch(`${baseUrl}/api/ai-state/mark-surfaced`, { method: 'POST', headers, body: JSON.stringify({ workspaceId: muWs }) })
            sendResponse({ success: true, data: { marked: true } })
          } catch (err) { sendResponse({ success: false, error: (err as Error).message }) }
          break
        }

        case 'FETCH_AI_STATE_SUMMARY': {
          const { workspaceId: asWs, documentId: asDoc } = message.payload as { workspaceId: string; documentId: string }
          try {
            const baseUrl = await getApiBaseUrl()
            const headers = await getAuthHeaders()
            const res = await fetch(`${baseUrl}/api/ai-state?workspaceId=${asWs}&documentId=${asDoc}`, { headers }).then(r => r.json())
            sendResponse({ success: true, data: { tensions: res.data?.event?.activeTensions || [], newFromTeam: res.data?.session?.newFromTeam || [] } })
          } catch (err) { sendResponse({ success: false, error: (err as Error).message }) }
          break
        }

        case 'FETCH_DOC_TEXT': {
          // Fetch Google Doc text via export endpoint (background SW has cookies + host_permissions)
          const { googleDocId: fetchDocId } = message.payload as { googleDocId: string }
          try {
            const exportUrl = `https://docs.google.com/document/d/${fetchDocId}/export?format=txt`
            const res = await fetch(exportUrl, { credentials: 'include' })
            if (res.ok) {
              const text = await res.text()
              sendResponse({ success: true, data: { text } })
            } else {
              sendResponse({ success: false, error: `Export returned ${res.status}` })
            }
          } catch (err) {
            sendResponse({ success: false, error: (err as Error).message })
          }
          break
        }

        case 'FETCH_DOC_STATS': {
          const { externalDocId: statsDocId } = message.payload as { externalDocId: string }
          try {
            const baseUrl = await getApiBaseUrl()
            const headers = await getAuthHeaders()
            const res = await fetch(`${baseUrl}/api/gws/documents/${statsDocId}/stats`, { headers })
            const data = await res.json()
            sendResponse({ success: true, data: data.data })
          } catch (err) {
            sendResponse({ success: false, error: (err as Error).message })
          }
          break
        }

        case 'FETCH_THREAD_EVENTS': {
          const { externalDocId: evtDocId, threadId, limit: evtLimit, before: evtBefore } =
            message.payload as {
              externalDocId: string
              threadId: string
              limit?: number
              before?: string
            }
          try {
            const baseUrl = await getApiBaseUrl()
            const headers = await getAuthHeaders()
            const params = new URLSearchParams()
            if (evtLimit) params.set('limit', String(evtLimit))
            if (evtBefore) params.set('before', evtBefore)
            const qs = params.toString()
            const res = await fetch(
              `${baseUrl}/api/gws/documents/${evtDocId}/threads/${threadId}/events${qs ? `?${qs}` : ''}`,
              { headers }
            )
            const data = await res.json()
            sendResponse({ success: true, data })
          } catch (err) {
            sendResponse({ success: false, error: (err as Error).message })
          }
          break
        }

        // ─── G8: Unified Activity Feed ───────────────────────────────────

        case 'FETCH_STRAND_ACTIVITY': {
          const { strandId: actStrandId, limit: actLimit, before: actBefore } =
            message.payload as { strandId: string; limit?: number; before?: string }
          try {
            const baseUrl = await getApiBaseUrl()
            const headers = await getAuthHeaders()
            const params = new URLSearchParams()
            if (actLimit) params.set('limit', String(actLimit))
            if (actBefore) params.set('before', actBefore)
            const qs = params.toString()
            const res = await fetch(
              `${baseUrl}/api/gws/strands/${actStrandId}/activity${qs ? `?${qs}` : ''}`,
              { headers }
            )
            const data = await res.json()
            sendResponse({ success: true, data })
          } catch (err) {
            sendResponse({ success: false, error: (err as Error).message })
          }
          break
        }

        case 'FETCH_STRANDS': {
          const { workspaceId: strandWsId } = message.payload as { workspaceId: string }
          try {
            const baseUrl = await getApiBaseUrl()
            const headers = await getAuthHeaders()
            const res = await fetch(
              `${baseUrl}/api/strands?workspaceId=${strandWsId}`,
              { headers }
            )
            const data = await res.json()
            sendResponse({ success: true, data: data.data })
          } catch (err) {
            sendResponse({ success: false, error: (err as Error).message })
          }
          break
        }

        case 'FETCH_DOC_MEMORY': {
          const { followDocId: memDocId } = message.payload as { followDocId: string }
          try {
            const baseUrl = await getApiBaseUrl()
            const headers = await getAuthHeaders()
            const res = await fetch(`${baseUrl}/api/doc-memory/${memDocId}`, { headers })
            const data = await res.json()
            sendResponse({ success: true, data: data.data })
          } catch (err) {
            sendResponse({ success: false, error: (err as Error).message })
          }
          break
        }

        case 'GET_GOOGLE_AUTH_TOKEN': {
          try {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
              if (chrome.runtime.lastError || !token) {
                sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'No token' })
              } else {
                sendResponse({ success: true, data: { token } })
              }
            })
          } catch (err) {
            sendResponse({ success: false, error: (err as Error).message })
          }
          break
        }

        case 'GET_GOOGLE_AUTH_TOKEN_SILENT': {
          try {
            chrome.identity.getAuthToken({ interactive: false }, (token) => {
              if (chrome.runtime.lastError || !token) {
                sendResponse({ success: false, error: 'Not connected' })
              } else {
                sendResponse({ success: true, data: { token } })
              }
            })
          } catch (err) {
            sendResponse({ success: false, error: (err as Error).message })
          }
          break
        }

        // ─── Feature Toggle System ─────────────────────────────────────

        case 'FEATURE_TOGGLES_GET': {
          const toggleData = await chrome.storage.local.get(STORAGE_KEYS.FEATURE_TOGGLES)
          sendResponse({
            success: true,
            data: toggleData[STORAGE_KEYS.FEATURE_TOGGLES] || {},
          })
          break
        }

        case 'FEATURE_TOGGLE_CHANGED': {
          const { feature, enabled } = message.payload as {
            feature: string
            enabled: boolean
          }

          // Read current toggles, update, and persist
          const currentData = await chrome.storage.local.get(STORAGE_KEYS.FEATURE_TOGGLES)
          const currentToggles = (currentData[STORAGE_KEYS.FEATURE_TOGGLES] as Record<string, boolean>) || {}
          currentToggles[feature] = enabled
          await chrome.storage.local.set({ [STORAGE_KEYS.FEATURE_TOGGLES]: currentToggles })

          // Update badge with active feature count
          const activeCount = Object.values(currentToggles).filter(Boolean).length
          chrome.action.setBadgeText({ text: activeCount > 0 ? String(activeCount) : '' })
          chrome.action.setBadgeBackgroundColor({ color: '#6366F1' })

          // Forward toggle change to active tab's content script
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (tab?.id) {
              chrome.tabs.sendMessage(tab.id, {
                type: 'FEATURE_TOGGLE_CHANGED',
                payload: { feature, enabled, toggles: currentToggles },
              })
            }
          } catch {
            // Content script may not be loaded yet
          }

          // If chat_in_web is being enabled, inject web-content script into active tab
          if (feature === 'chat_in_web' && enabled) {
            try {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
              if (tab?.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.includes('docs.google.com')) {
                await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  files: ['dist/content/web-content.js'],
                })
              }
            } catch {
              // Tab may not support script injection
            }
          }

          // If track_document is being enabled, auto-activate document tracking
          if (feature === 'track_document' && enabled) {
            try {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
              if (tab?.url) {
                // Parse Google Doc URL to get doc ID
                const docMatch = tab.url.match(/\/document\/d\/([^/]+)/)
                const sheetMatch = tab.url.match(/\/spreadsheets\/d\/([^/]+)/)
                const slideMatch = tab.url.match(/\/presentation\/d\/([^/]+)/)
                const googleDocId = docMatch?.[1] || sheetMatch?.[1] || slideMatch?.[1]
                const docType = docMatch ? 'google_docs' : sheetMatch ? 'google_sheets' : slideMatch ? 'google_slides' : null

                if (googleDocId && docType) {
                  // Check if already active
                  const statusResult = await getSmartDocStatus(googleDocId)
                  if (!statusResult.data) {
                    // Auto-activate
                    const wsData = await chrome.storage.local.get(STORAGE_KEYS.WORKSPACE_ID)
                    const workspaceId = (wsData[STORAGE_KEYS.WORKSPACE_ID] as string) || ''
                    const title = tab.title?.replace(/ - Google (Docs|Sheets|Slides)$/, '') || 'Untitled'

                    await activateSmartDoc({
                      externalDocId: googleDocId,
                      docType,
                      title,
                      workspaceId,
                    })
                    console.log('[Follow SW] Auto-activated Document tracking for track_document toggle')
                  }
                }
              }
            } catch (err) {
              console.warn('[Follow SW] Auto-activation failed:', err)
            }
          }

          sendResponse({ success: true })
          break
        }

        default:
          sendResponse({ success: false, error: `Unknown message type: ${message.type}` })
      }
    }

    handleAsync()
    // Return true to indicate async response
    return true
  }
)
