/**
 * Document tracking state: activated, docId, strandId, recording status.
 */

import { useCallback } from 'react'
import { useSmartDocStore } from '@/stores/smart-doc-store'
import { sendToBackground } from '@/lib/message-passing'

export function useSmartDoc() {
  const store = useSmartDocStore()

  const activate = useCallback(
    async (params: {
      googleDocId: string
      docType: string
      title: string
      workspaceId: string
      strandId?: string
    }) => {
      const result = await sendToBackground({
        type: 'SMART_DOC_ACTIVATE',
        payload: {
          externalDocId: params.googleDocId,
          docType: `google_${params.docType}` as const,
          title: params.title,
          workspaceId: params.workspaceId,
          strandId: params.strandId,
        },
      })

      if (result.success && result.data) {
        const data = result.data as { id: string; strandId?: string }
        store.activate({
          followDocId: data.id,
          googleDocId: params.googleDocId,
          strandId: data.strandId,
        })
        return { success: true, data }
      }

      return { success: false, error: result.error }
    },
    [store]
  )

  const deactivate = useCallback(async () => {
    if (!store.googleDocId) return

    const result = await sendToBackground({
      type: 'SMART_DOC_DEACTIVATE',
      payload: { externalDocId: store.googleDocId },
    })

    if (result.success) {
      store.deactivate()
    }

    return result
  }, [store])

  const checkStatus = useCallback(
    async (googleDocId: string) => {
      const result = await sendToBackground({
        type: 'SMART_DOC_STATUS',
        payload: { externalDocId: googleDocId },
      })

      if (result.success && result.data) {
        const data = result.data as {
          id: string
          strandId?: string
          metadata?: { signalCount?: number; lastSignalAt?: string }
        }
        store.activate({
          followDocId: data.id,
          googleDocId,
          strandId: data.strandId,
        })
        if (data.metadata?.signalCount) {
          store.incrementSignalCount(data.metadata.signalCount)
        }
        return true
      }

      return false
    },
    [store]
  )

  return {
    ...store,
    activate,
    deactivate,
    checkStatus,
  }
}
