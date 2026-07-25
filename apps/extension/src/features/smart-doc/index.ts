/**
 * Smart Doc — self-initializing feature module.
 *
 * Listens for follow-smart-doc-active event to get the followDocId,
 * then starts the addon bridge.
 */

import { AddonBridge } from './addon-bridge'
import { sendToBackground } from '@/core/message-bus'
import type { GoogleDocType } from '@/lib/google-doc-utils'

let addonBridge: AddonBridge | null = null
let isActive = false

function handleActivation(e: Event): void {
  const detail = (e as CustomEvent).detail
  if (!detail?.id || isActive) return
  isActive = true

  const ctx = (window as unknown as Record<string, unknown>).__followContext as {
    gwsPage?: { googleDocId: string; docType: GoogleDocType }
  } | undefined

  const googleDocId = detail.googleDocId || ctx?.gwsPage?.googleDocId || ''
  const docType = detail.docType || ctx?.gwsPage?.docType || 'docs'

  addonBridge = new AddonBridge(detail.id, googleDocId, docType, (action) => {
    document.dispatchEvent(new CustomEvent('follow-addon-action', { detail: { action } }))
  })
  addonBridge.start()
}

function cleanup(): void {
  addonBridge?.stop()
  addonBridge = null
  isActive = false
  document.removeEventListener('follow-smart-doc-active', handleActivation)
}

// Auto-init
document.addEventListener('follow-smart-doc-active', handleActivation)
document.addEventListener('follow-unload-smart-doc', cleanup)

export async function fetchProvenance(googleDocId: string): Promise<unknown> {
  const result = await sendToBackground({ type: 'FETCH_PROVENANCE', payload: { externalDocId: googleDocId } })
  return result.success ? result.data : null
}

export async function fetchDocStats(googleDocId: string): Promise<unknown> {
  const result = await sendToBackground({ type: 'FETCH_DOC_STATS', payload: { externalDocId: googleDocId } })
  return result.success ? result.data : null
}
