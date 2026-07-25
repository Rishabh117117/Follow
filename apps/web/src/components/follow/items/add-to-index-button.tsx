'use client'

import { AddToIndexModal } from '@/components/follow/modals/add-to-index-modal'
import { useIndexStore } from '@/stores/index-store'
import { headerPrimaryBtn, useAutoIndex } from './_shared'

/**
 * Small wrapper so the modal has access to the active index label + a
 * query invalidator without tangling that logic into the main ItemsView.
 */
export function AddToIndexModalMount({ onClose }: { onClose: () => void }) {
  const getActiveIndex = useIndexStore((s) => s.getActiveIndex)
  const active = getActiveIndex()
  return (
    <AddToIndexModal
      indexLabel={active?.name ?? 'Personal'}
      onClose={onClose}
      onAdded={() => {
        // Invalidate queries by dispatching a simple event — the useQuery
        // hooks in ItemsView already poll on workspace changes, but we nudge
        // them here so new items appear after a brief delay.
        window.dispatchEvent(new CustomEvent('follow:items-changed'))
      }}
    />
  )
}

/**
 * The primary "+ Add to Index" button, now aware of the auto-index toggle.
 * When auto-index is ON the manual import flow would race with the
 * auto-indexer — per the user's design call we just disable it and explain
 * why via tooltip, rather than silently allowing duplicate work.
 */
export function AddToIndexButton({ onClick }: { onClick: () => void }) {
  const q = useAutoIndex()
  const autoOn = q.data?.enabled !== false
  const disabled = autoOn
  return (
    <button
      data-testid="add-to-index-btn"
      onClick={onClick}
      disabled={disabled}
      title={
        disabled
          ? 'Disabled while Auto-index is on — new files are already being indexed automatically.'
          : undefined
      }
      style={{
        ...headerPrimaryBtn,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      + Add to Index
    </button>
  )
}
