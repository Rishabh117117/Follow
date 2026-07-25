/**
 * Message Bus — typed message passing between content scripts and service worker.
 *
 * Replaces both the GWS ExtensionMessage/sendToBackground and the WA ad-hoc message.type system.
 */

/** All message types in the unified extension */
export type MessageType =
  // Auth
  | 'AUTH_TOKEN_SET'
  | 'AUTH_TOKEN_GET'
  | 'AUTH_TOKEN_CLEAR'
  // Smart Doc lifecycle
  | 'SMART_DOC_ACTIVATE'
  | 'SMART_DOC_DEACTIVATE'
  | 'SMART_DOC_STATUS'
  | 'SMART_DOC_ACTIVATED'
  | 'SMART_DOC_DEACTIVATED'
  // Signal batches
  | 'SIGNAL_BATCH_GWS'
  | 'SIGNAL_BATCH_WEB'
  // Content sync
  | 'CONTENT_SYNC'
  // Addon bridge
  | 'ADDON_ACTION_POLL'
  | 'ADDON_ACTION_CLEAR'
  // Data fetching
  | 'FETCH_PROVENANCE'
  | 'FETCH_DOC_STATS'
  | 'FETCH_THREAD_EVENTS'
  | 'FETCH_STRAND_ACTIVITY'
  | 'FETCH_STRANDS'
  | 'FETCH_DOC_MEMORY'
  // Google auth
  | 'GET_GOOGLE_AUTH_TOKEN'
  | 'GET_GOOGLE_AUTH_TOKEN_SILENT'
  // Feature toggles
  | 'FEATURE_TOGGLES_GET'
  | 'FEATURE_TOGGLE_CHANGED'
  // Commands
  | 'COMMAND'
  | 'CONTEXT_MENU_ASK_FOLLOW'
  // Badge
  | 'BADGE_UPDATE'
  // Connection
  | 'GET_CONNECTION_STATUS'
  | 'GET_ACTIVE_TAB_DOC'
  // Web capture
  | 'CAPTURE_PAGE'
  | 'GET_CAPTURE_STATUS'
  // Doc intel
  | 'DOC_INTEL_REQUEST'
  | 'TOGGLE_DOC_INTEL'
  // Live tracking
  | 'SET_LIVE_ENABLED'
  | 'GET_LIVE_STATUS'
  // Feature injection
  | 'INJECT_FEATURE_SCRIPT'

export interface ExtensionMessage {
  type: MessageType
  payload?: Record<string, unknown>
}

export interface ExtensionResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Send a message to the background service worker and await a typed response.
 */
export async function sendToBackground<T = unknown>(message: ExtensionMessage): Promise<ExtensionResponse<T>> {
  try {
    const response = await chrome.runtime.sendMessage(message)
    return response as ExtensionResponse<T>
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/**
 * Send a message to a specific tab's content script.
 */
export async function sendToTab(tabId: number, message: ExtensionMessage): Promise<ExtensionResponse> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message)
    return response as ExtensionResponse
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
