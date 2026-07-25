/**
 * Collaborator Tracker — works across Docs, Sheets, Slides.
 * Monitors for collaborator presence changes by polling cursor name elements.
 * Pauses polling when tab is not visible to save resources.
 */

import { signalEmitter } from './signal-emitter'
import { useOverlayStore } from '@/stores/overlay-store'

export class CollaboratorTracker {
  private knownCollaborators = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private followDocId: string
  private googleDocId: string
  private boundVisibilityHandler: () => void

  constructor(followDocId: string, googleDocId: string) {
    this.followDocId = followDocId
    this.googleDocId = googleDocId
    this.boundVisibilityHandler = () => this.handleVisibilityChange()
  }

  start(): void {
    this.timer = setInterval(() => this.check(), 5000)
    document.addEventListener('visibilitychange', this.boundVisibilityHandler)
  }

  private handleVisibilityChange(): void {
    if (document.hidden) {
      // Pause polling when tab is hidden
      if (this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    } else {
      // Resume polling when tab becomes visible
      if (!this.timer) {
        this.timer = setInterval(() => this.check(), 5000)
      }
    }
  }

  private check(): void {
    // Skip if tab is hidden
    if (document.hidden) return

    const nameEls = document.querySelectorAll(
      '.kix-cursor-name, .waffle-cursor-name, [class*="cursor-name"], [class*="collaborator-name"]'
    )
    const currentNames = new Set(
      Array.from(nameEls)
        .map((el) => el.textContent?.trim() || '')
        .filter(Boolean)
    )

    // Detect joins
    for (const name of currentNames) {
      if (!this.knownCollaborators.has(name)) {
        signalEmitter.emit('gws_collaborator_join', {
          googleDocId: this.googleDocId,
          followDocId: this.followDocId,
          collaboratorName: name,
          collaboratorCount: currentNames.size,
        })
      }
    }

    // Detect leaves
    for (const name of this.knownCollaborators) {
      if (!currentNames.has(name)) {
        signalEmitter.emit('gws_collaborator_leave', {
          googleDocId: this.googleDocId,
          followDocId: this.followDocId,
          collaboratorName: name,
          collaboratorCount: currentNames.size,
        })
      }
    }

    this.knownCollaborators = currentNames

    // E-1.3: Surface live collaborator list in overlay store so the
    // FloatingUnit header can render presence avatars.
    try {
      useOverlayStore.getState().setCollaborators([...currentNames])
    } catch {
      // Store may not be mounted (e.g. during tests)
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    document.removeEventListener('visibilitychange', this.boundVisibilityHandler)
    try {
      useOverlayStore.getState().setCollaborators([])
    } catch {
      // ignore
    }
  }
}
