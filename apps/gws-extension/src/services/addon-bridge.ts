/**
 * AddonBridge — polls the Follow backend for addon-triggered actions
 * AND structured AI tool actions (edit_doc, edit_sheet, annotate).
 *
 * Communication path:
 * 1. AI chat tool (e.g. edit_google_doc) writes a structured action to
 *    externalDocuments.metadata.pendingActions
 * 2. This bridge polls GET /api/gws/documents/:id/addon-actions every 10s
 * 3. When action(s) found, invokes the appropriate handler and clears them
 *
 * Performance: Pauses when tab is hidden. Backs off on repeated failures.
 */

import { sendToBackground } from '@/lib/message-passing'
import {
  materializeReplacement,
  materializeInsertion,
  materializeSheetValues,
} from './materialization-service'
import type { GoogleDocType } from '@/lib/google-doc-utils'

const BASE_POLL_INTERVAL = 10000 // 10 seconds
const MAX_POLL_INTERVAL = 60000 // 1 minute (backoff cap)

/** Structured action queued by AI tools */
export interface AIAction {
  id: string
  type: 'edit_doc' | 'edit_sheet'
  status: 'pending' | 'executing' | 'completed' | 'failed'
  createdAt: string
  // edit_doc fields
  action?: 'replace' | 'insert' | 'append'
  findText?: string
  newText?: string
  // edit_sheet fields
  range?: string
  values?: string[][]
}

export class AddonBridge {
  private timer: ReturnType<typeof setTimeout> | null = null
  private followDocId: string
  private googleDocId: string
  private docType: GoogleDocType
  private onAction: (action: string) => void
  private executing = false
  private consecutiveFailures = 0
  private currentInterval = BASE_POLL_INTERVAL
  private boundVisibilityHandler: () => void
  private stopped = false

  constructor(
    followDocId: string,
    googleDocId: string,
    docType: GoogleDocType,
    onAction: (action: string) => void
  ) {
    this.followDocId = followDocId
    this.googleDocId = googleDocId
    this.docType = docType
    this.onAction = onAction
    this.boundVisibilityHandler = () => this.handleVisibilityChange()
  }

  start(): void {
    this.stopped = false
    document.addEventListener('visibilitychange', this.boundVisibilityHandler)
    // Initial poll after delay
    this.scheduleNext(3000)
  }

  private scheduleNext(delay?: number): void {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.poll(), delay ?? this.currentInterval)
  }

  private handleVisibilityChange(): void {
    if (document.hidden) {
      // Pause polling when tab is hidden
      if (this.timer) {
        clearTimeout(this.timer)
        this.timer = null
      }
    } else {
      // Resume polling when visible
      if (!this.timer && !this.stopped) {
        this.scheduleNext(2000)
      }
    }
  }

  private async poll(): Promise<void> {
    if (this.executing || document.hidden || this.stopped) return

    try {
      const response = await sendToBackground<{
        action: string | null
        pendingActions?: AIAction[]
      }>({
        type: 'ADDON_ACTION_POLL',
        payload: { followDocId: this.followDocId },
      })

      if (!response.success) {
        this.handleFailure()
        return
      }

      // Reset backoff on success
      this.consecutiveFailures = 0
      this.currentInterval = BASE_POLL_INTERVAL

      // Handle structured AI actions first
      const pendingActions = response.data?.pendingActions ?? []
      const toExecute = pendingActions.filter((a) => a.status === 'pending')

      if (toExecute.length > 0) {
        this.executing = true
        try {
          for (const action of toExecute) {
            await this.executeAIAction(action)
          }
        } finally {
          this.executing = false
        }

        await sendToBackground({
          type: 'ADDON_ACTION_CLEAR',
          payload: { followDocId: this.followDocId },
        })
      }

      // Handle legacy simple action string
      if (response.data?.action && toExecute.length === 0) {
        this.onAction(response.data.action)

        await sendToBackground({
          type: 'ADDON_ACTION_CLEAR',
          payload: { followDocId: this.followDocId },
        })
      }
    } catch (_) {
      this.handleFailure()
    }

    // Schedule next poll
    this.scheduleNext()
  }

  private handleFailure(): void {
    this.consecutiveFailures++
    // Exponential backoff: 10s → 20s → 40s → 60s (cap)
    this.currentInterval = Math.min(
      BASE_POLL_INTERVAL * Math.pow(2, this.consecutiveFailures - 1),
      MAX_POLL_INTERVAL
    )
  }

  private async executeAIAction(action: AIAction): Promise<void> {
    try {
      if (action.type === 'edit_doc') {
        await this.executeDocEdit(action)
      } else if (action.type === 'edit_sheet') {
        await this.executeSheetEdit(action)
      }
    } catch (err) {
      console.error(`[Follow] AI action failed:`, err)
    }
  }

  private async executeDocEdit(action: AIAction): Promise<void> {
    const { action: editAction, findText, newText } = action
    if (!newText) return

    switch (editAction) {
      case 'replace': {
        if (!findText) return
        await materializeReplacement(this.googleDocId, this.docType, findText, newText)
        break
      }
      case 'insert': {
        if (findText) {
          await materializeReplacement(this.googleDocId, this.docType, findText, findText + newText)
        } else {
          await materializeInsertion(this.googleDocId, this.docType, newText)
        }
        break
      }
      case 'append': {
        await materializeInsertion(this.googleDocId, this.docType, '\n' + newText)
        break
      }
    }
  }

  private async executeSheetEdit(action: AIAction): Promise<void> {
    const { range, values } = action
    if (!range || !values) return
    await materializeSheetValues(this.googleDocId, range, values)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    document.removeEventListener('visibilitychange', this.boundVisibilityHandler)
  }
}
