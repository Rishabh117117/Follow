/**
 * PresenceCursors — Stub component for the "Collaborate" feature toggle.
 *
 * Future implementation: renders collaborator cursors and comment overlays
 * on Google Docs pages, tracked via CollaboratorTracker signals.
 */

import React, { useEffect } from 'react'

export function PresenceCursors() {
  useEffect(() => {
    console.log('[Follow] Collaborate feature enabled — presence cursors active (stub)')
    return () => {
      console.log('[Follow] Collaborate feature disabled')
    }
  }, [])

  // Stub — TODO (UI-SPLIT-1): renders a "coming soon" pill until the
  // Collaborate overlay is implemented. Prevents users who flip the
  // feature toggle from seeing a silently no-op UI.
  return (
    <div className="pointer-events-none select-none text-xs text-zinc-400 opacity-60 px-2 py-1 rounded bg-zinc-50/80 border border-zinc-200">
      <span className="font-mono uppercase tracking-wider">Coming soon</span>
    </div>
  )
}
