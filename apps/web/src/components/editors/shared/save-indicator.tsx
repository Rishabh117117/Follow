'use client'

import { useEffect, useState } from 'react'

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error' | 'offline'

interface SaveIndicatorProps {
  status: SaveStatus
  connected?: boolean
}

const STATUS_CONFIG: Record<SaveStatus, { label: string; dotColor: string }> = {
  saved: { label: 'Saved', dotColor: 'bg-green-500' },
  saving: { label: 'Saving...', dotColor: 'bg-yellow-500 animate-pulse' },
  unsaved: { label: 'Unsaved changes', dotColor: 'bg-yellow-500' },
  error: { label: 'Save failed', dotColor: 'bg-red-500' },
  offline: { label: 'Offline', dotColor: 'bg-zinc-500' },
}

export function SaveIndicator({ status, connected = true }: SaveIndicatorProps) {
  const [displayStatus, setDisplayStatus] = useState<SaveStatus>(status)

  useEffect(() => {
    if (!connected) {
      setDisplayStatus('offline')
    } else {
      setDisplayStatus(status)
    }
  }, [status, connected])

  const config = STATUS_CONFIG[displayStatus]

  return (
    <div className="flex items-center gap-1.5">
      <div className={`h-1.5 w-1.5 rounded-full ${config.dotColor}`} />
      <span className="text-xs text-zinc-500">{config.label}</span>
    </div>
  )
}
