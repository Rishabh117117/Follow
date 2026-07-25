'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authFetch } from '@/lib/api-client'
import { useAutoIndex } from '../_shared'
import { ToggleSwitch } from './toggle-switch'

/**
 * Global auto-index toggle for the Files header. When ON, uploads auto-queue
 * for indexing; when OFF, they land untouched and the user drives indexing
 * manually via the Add-to-Index modal or per-file "Index now" buttons.
 *
 * Conflict rule: auto-index ON disables the "+ Add to Index" button (see
 * AddToIndexButton below) since the manual import flow would be redundant —
 * anything a user pastes/imports would get auto-indexed anyway.
 */
export function AutoIndexHeaderToggle() {
  const q = useAutoIndex()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const on = q.data?.enabled !== false

  const flip = async () => {
    setBusy(true)
    try {
      const res = await authFetch('/api/index-queue/auto-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !on }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Optimistic: update cache immediately so the UI snaps without a
      // 5s poll delay. The next refetch confirms.
      queryClient.setQueryData(['auto-index'], { enabled: !on })
      queryClient.invalidateQueries({ queryKey: ['auto-index'] })
    } catch (e) {
      console.warn('auto-index toggle failed', e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToggleSwitch
      on={on}
      busy={busy}
      onChange={flip}
      label={on ? 'Auto-index on' : 'Auto-index off'}
      testId="auto-index-toggle"
      title={
        on
          ? 'Uploads are being indexed automatically. Turn off to index manually.'
          : 'Uploads land untouched. Turn on to auto-index every new file.'
      }
      onColor="#6C63FF"
    />
  )
}
