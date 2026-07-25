/**
 * Collaborator Tracker — monitors cursor name elements for presence changes.
 *
 * Now uses the coordinator instead of its own setInterval.
 * Visibility pausing is handled automatically by the coordinator.
 */

import { signalPipeline } from '@/core/signal-pipeline'
import { coordinator } from '@/core/coordinator'
import { getCollaboratorNames } from '@/content/dom-bridge'

const POLL_INTERVAL = 5000

export class CollaboratorTracker {
  private knownCollaborators = new Set<string>()
  private followDocId: string
  private googleDocId: string

  constructor(followDocId: string, googleDocId: string) {
    this.followDocId = followDocId
    this.googleDocId = googleDocId
  }

  start(): void {
    coordinator.register({
      id: 'collaborator-poll',
      interval: POLL_INTERVAL,
      visibilityRequired: true, // Skip when tab hidden
      execute: () => this.check(),
    })
  }

  private check(): void {
    const currentNames = getCollaboratorNames()

    for (const name of currentNames) {
      if (!this.knownCollaborators.has(name)) {
        signalPipeline.emit('gws_collaborator_join', {
          googleDocId: this.googleDocId,
          followDocId: this.followDocId,
          collaboratorName: name,
          collaboratorCount: currentNames.size,
        }, this.followDocId)
      }
    }

    for (const name of this.knownCollaborators) {
      if (!currentNames.has(name)) {
        signalPipeline.emit('gws_collaborator_leave', {
          googleDocId: this.googleDocId,
          followDocId: this.followDocId,
          collaboratorName: name,
          collaboratorCount: currentNames.size,
        }, this.followDocId)
      }
    }

    this.knownCollaborators = currentNames
  }

  stop(): void {
    coordinator.unregister('collaborator-poll')
  }
}
