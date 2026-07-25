/**
 * Chrome Extension message passing utilities.
 * Handles communication between content scripts, background service worker, and popup.
 */

export interface ExtensionMessage {
  type:
    | 'AUTH_TOKEN_SET'
    | 'AUTH_TOKEN_GET'
    | 'AUTH_TOKEN_CLEAR'
    | 'SMART_DOC_ACTIVATE'
    | 'SMART_DOC_DEACTIVATE'
    | 'SMART_DOC_STATUS'
    | 'SIGNAL_BATCH'
    | 'GET_CONNECTION_STATUS'
    | 'CHAT_MESSAGE'
    | 'CHAT_STREAM_START'
    | 'CHAT_STREAM_END'
    | 'GET_ACTIVE_TAB_DOC'
    | 'BADGE_UPDATE'
    | 'CONTENT_SYNC'
    | 'ADDON_ACTION_POLL'
    | 'ADDON_ACTION_CLEAR'
    | 'FETCH_PROVENANCE'
    | 'FETCH_DOC_STATS'
    | 'FETCH_THREAD_EVENTS'
    | 'FETCH_STRAND_ACTIVITY'
    | 'FETCH_STRANDS'
    | 'FETCH_DOC_MEMORY'
    // Notifications from service worker to content script
    | 'SMART_DOC_ACTIVATED'
    | 'SMART_DOC_DEACTIVATED'
    | 'GET_GOOGLE_AUTH_TOKEN'
    | 'GET_GOOGLE_AUTH_TOKEN_SILENT'
    | 'COMMAND'
    // Feature toggles
    | 'FEATURE_TOGGLE_CHANGED'
    | 'FEATURE_TOGGLES_GET'
    // FE-3: Provenance data (real episodes + shared state)
    | 'FETCH_PROVENANCE_DATA'
    | 'FETCH_PARAGRAPH_PROVENANCE'
    | 'MARK_TEAM_UPDATES_SURFACED'
    | 'FETCH_AI_STATE_SUMMARY'
    // E-1: popup → service worker → active tab content script
    | 'GET_SMART_DOC_INFO'
    // E-1.2: connection status broadcast from service worker
    | 'CONNECTION_STATUS_CHANGED'
    // E-2: addon action queue (insertion service Apps Script fallback)
    | 'QUEUE_ADDON_ACTION'
    | 'CHECK_ADDON_ACTION_STATUS'
    // E-1.3: collaborator presence broadcast from content script
    | 'COLLABORATORS_UPDATED'
    // E-1.2: auth expiry broadcast from service worker
    | 'AUTH_EXPIRED'
    // Google Docs export via background fetch (pre-existing, add to union)
    | 'FETCH_DOC_TEXT'
  payload?: unknown
}

export interface ExtensionResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Send a message to the background service worker and await the response.
 */
export async function sendToBackground<T = unknown>(
  message: ExtensionMessage
): Promise<ExtensionResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: ExtensionResponse<T>) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message })
      } else {
        resolve(response ?? { success: false, error: 'No response' })
      }
    })
  })
}

/**
 * Send a message to a specific tab's content script.
 */
export async function sendToContentScript<T = unknown>(
  tabId: number,
  message: ExtensionMessage
): Promise<ExtensionResponse<T>> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response: ExtensionResponse<T>) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message })
      } else {
        resolve(response ?? { success: false, error: 'No response' })
      }
    })
  })
}

/**
 * Listen for messages in the current context (content script, background, or popup).
 */
export function onMessage(
  handler: (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtensionResponse) => void
  ) => boolean | void
): void {
  chrome.runtime.onMessage.addListener(handler)
}
