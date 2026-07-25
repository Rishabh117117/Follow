/**
 * Addon Bridge — polls for AI-queued actions with improved backoff.
 *
 * Key improvements over old version:
 * - Base interval: 30s (was 10s) — less CPU/network pressure
 * - Max backoff: 120s (was 60s)
 * - Stops after 2 minutes with no pending actions (idle timeout)
 * - Resumes on next AI action signal from chat
 * - Uses coordinator for visibility-aware scheduling
 */

import { sendToBackground } from '@/core/message-bus'
import { coordinator } from '@/core/coordinator'
import { materializeReplacement, materializeInsertion, materializeSheetValues } from './materialization-service'
import type { GoogleDocType } from '@/lib/google-doc-utils'

const BASE_POLL_INTERVAL = 30_000  // 30s (was 10s)
const MAX_POLL_INTERVAL = 120_000  // 2 min (was 60s)
const IDLE_TIMEOUT = 120_000       // Stop after 2 min of no actions

export interface AIAction {
  id: string
  type: 'edit_doc' | 'edit_sheet'
  status: 'pending' | 'executing' | 'completed' | 'failed'
  createdAt: string
  action?: 'replace' | 'insert' | 'append'
  findText?: string
  newText?: string
  range?: string
  values?: string[][]
}

export class AddonBridge {
  private followDocId: string
  private googleDocId: string
  private docType: GoogleDocType
  private onAction: (action: string) => void
  private executing = false
  private consecutiveFailures = 0
  private lastActionTime = Date.now()
  private isPolling = false

  constructor(
    followDocId: string, googleDocId: string, docType: GoogleDocType,
    onAction: (action: string) => void
  ) {
    this.followDocId = followDocId
    this.googleDocId = googleDocId
    this.docType = docType
    this.onAction = onAction
  }

  start(): void {
    this.isPolling = true
    this.lastActionTime = Date.now()

    coordinator.register({
      id: 'addon-bridge-poll',
      interval: BASE_POLL_INTERVAL,
      visibilityRequired: true,
      execute: () => this.poll(),
    })

    // Listen for AI action signals that should wake up polling
    document.addEventListener('follow-ai-action-queued', this.handleActionQueued)
  }

  private handleActionQueued = (): void => {
    // Reset idle timer and poll immediately
    this.lastActionTime = Date.now()
    this.consecutiveFailures = 0

    if (!this.isPolling) {
      this.isPolling = true
      coordinator.register({
        id: 'addon-bridge-poll',
        interval: BASE_POLL_INTERVAL,
        visibilityRequired: true,
        execute: () => this.poll(),
      })
    }

    // Immediate poll
    this.poll()
  }

  private async poll(): Promise<void> {
    if (this.executing) return

    // Idle timeout: stop polling after 2 min of no actions
    if (Date.now() - this.lastActionTime > IDLE_TIMEOUT) {
      this.isPolling = false
      coordinator.unregister('addon-bridge-poll')
      return
    }

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

      this.consecutiveFailures = 0

      // Handle structured AI actions
      const pendingActions = response.data?.pendingActions ?? []
      const toExecute = pendingActions.filter((a) => a.status === 'pending')

      if (toExecute.length > 0) {
        this.lastActionTime = Date.now()
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
        this.lastActionTime = Date.now()
        this.onAction(response.data.action)
        await sendToBackground({
          type: 'ADDON_ACTION_CLEAR',
          payload: { followDocId: this.followDocId },
        })
      }
    } catch {
      this.handleFailure()
    }
  }

  private handleFailure(): void {
    this.consecutiveFailures++
    // Adjust coordinator interval with backoff
    const newInterval = Math.min(
      BASE_POLL_INTERVAL * Math.pow(2, this.consecutiveFailures - 1),
      MAX_POLL_INTERVAL
    )
    coordinator.register({
      id: 'addon-bridge-poll',
      interval: newInterval,
      visibilityRequired: true,
      execute: () => this.poll(),
    })
  }

  private async executeAIAction(action: AIAction): Promise<void> {
    try {
      if (action.type === 'edit_doc') {
        const { action: editAction, findText, newText } = action
        if (!newText) return
        if (editAction === 'replace' && findText) {
          await materializeReplacement(this.googleDocId, this.docType, findText, newText)
        } else if (editAction === 'insert') {
          if (findText) {
            await materializeReplacement(this.googleDocId, this.docType, findText, findText + newText)
          } else {
            await materializeInsertion(this.googleDocId, this.docType, newText)
          }
        } else if (editAction === 'append') {
          await materializeInsertion(this.googleDocId, this.docType, '\n' + newText)
        }
      } else if (action.type === 'edit_sheet') {
        if (action.range && action.values) {
          await materializeSheetValues(this.googleDocId, action.range, action.values)
        }
      }
    } catch (err) {
      console.error(`[Follow] AI action failed:`, err)
    }
  }

  stop(): void {
    this.isPolling = false
    coordinator.unregister('addon-bridge-poll')
    document.removeEventListener('follow-ai-action-queued', this.handleActionQueued)
  }
}
