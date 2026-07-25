/**
 * GWS Tracking — self-initializing feature module.
 *
 * When injected via script tag, reads __followContext for page info
 * and auto-starts the appropriate trackers.
 */

import { RevisionTracker } from './revision-tracker'
import { CollaboratorTracker } from './collaborator-tracker'
import { SelectionTracker } from './selection-tracker'
import { SheetsTracker } from './sheets-tracker'
import { SlidesTracker } from './slides-tracker'
import { startCanvasSelectionTracker } from './canvas-selection-tracker'
import { sendToBackground } from '@/core/message-bus'
import { fetchDocumentText } from '@/content/dom-bridge'
import type { GoogleDocType } from '@/lib/google-doc-utils'

const trackers: { stop: () => void }[] = []
let canvasCleanup: (() => void) | null = null
let isActive = false

async function init(googleDocId: string, docType: GoogleDocType): Promise<void> {
  if (isActive) return
  isActive = true

  // Activate Smart Doc
  const statusResult = await sendToBackground<{ id?: string }>({
    type: 'SMART_DOC_STATUS',
    payload: { externalDocId: googleDocId },
  })

  let followDocId: string

  if (statusResult.success && statusResult.data?.id) {
    followDocId = statusResult.data.id
  } else {
    const docTitle = document.title.replace(/ - Google (Docs|Sheets|Slides)$/, '') || 'Untitled'
    const activateResult = await sendToBackground<{ id?: string }>({
      type: 'SMART_DOC_ACTIVATE',
      payload: { externalDocId: googleDocId, docType: `google_${docType}`, title: docTitle, workspaceId: '' },
    })
    if (!activateResult.success || !activateResult.data?.id) return
    followDocId = activateResult.data.id
  }

  // Start collaborator tracker (all doc types)
  const collabTracker = new CollaboratorTracker(followDocId, googleDocId)
  collabTracker.start()
  trackers.push(collabTracker)

  if (docType === 'docs') {
    const revTracker = new RevisionTracker(followDocId, googleDocId)
    revTracker.start()
    trackers.push(revTracker)

    const selTracker = new SelectionTracker(followDocId, googleDocId)
    selTracker.start()
    trackers.push(selTracker)

    canvasCleanup = startCanvasSelectionTracker()
    fetchDocumentText(googleDocId).catch(() => {})
  } else if (docType === 'sheets') {
    const sheetsTracker = new SheetsTracker(followDocId, googleDocId)
    sheetsTracker.start()
    trackers.push(sheetsTracker)
  } else if (docType === 'slides') {
    const slidesTracker = new SlidesTracker(followDocId, googleDocId)
    slidesTracker.start()
    trackers.push(slidesTracker)
  }

  // Dispatch activation event
  document.dispatchEvent(new CustomEvent('follow-smart-doc-active', {
    detail: { id: followDocId, googleDocId, docType },
  }))

  // Deferred content sync
  if (docType === 'docs') {
    setTimeout(() => {
      fetchDocumentText(googleDocId).then((text) => {
        if (text && text.length > 0) {
          sendToBackground({
            type: 'CONTENT_SYNC',
            payload: { externalDocId: followDocId, content: text.substring(0, 50000), paragraphCount: text.split('\n').length },
          })
        }
      }).catch(() => {})
    }, 5000)
  }
}

function cleanup(): void {
  for (const t of trackers) t.stop()
  trackers.length = 0
  canvasCleanup?.()
  canvasCleanup = null
  isActive = false
}

// Listen for unload
document.addEventListener('follow-unload-gws-tracking', cleanup)

// Auto-init from context
const ctx = (window as unknown as Record<string, unknown>).__followContext as {
  gwsPage?: { googleDocId: string; docType: GoogleDocType }
} | undefined
if (ctx?.gwsPage) {
  init(ctx.gwsPage.googleDocId, ctx.gwsPage.docType)
}
