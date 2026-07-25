'use client'

import { cn } from '@/lib/utils'
import { useLiveContextStore } from '@/stores/live-context-store'
import { useScopeStore } from '@/stores/scope-store'

interface LiveContextControlsProps {
  className?: string
}

export function LiveContextControls({ className }: LiveContextControlsProps) {
  const slice = useLiveContextStore((s) => s.slice)
  const pause = useLiveContextStore((s) => s.pause)
  const resume = useLiveContextStore((s) => s.resume)
  const end = useLiveContextStore((s) => s.end)
  const lifecycle = useScopeStore((s) => s.lifecycle)
  const endScope = useScopeStore((s) => s.endScope)
  const pauseScope = useScopeStore((s) => s.pauseScope)
  const resumeScope = useScopeStore((s) => s.resumeScope)

  if (!slice) return null

  const paused = slice.syncStatus === 'paused' || lifecycle.paused

  const handlePause = async () => {
    await pauseScope()
    await pause()
  }
  const handleResume = async () => {
    await resumeScope()
    await resume()
  }
  const handleEnd = async () => {
    await endScope()
    await end()
  }

  return (
    <div className={cn('flex items-center gap-2', className)} data-testid="live-context-controls">
      {paused ? (
        <button
          type="button"
          onClick={handleResume}
          className="rounded border border-emerald-300 bg-white px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-50"
        >
          Resume
        </button>
      ) : (
        <button
          type="button"
          onClick={handlePause}
          className="rounded border border-amber-300 bg-white px-2 py-1 text-xs text-amber-800 hover:bg-amber-50"
        >
          Pause
        </button>
      )}
      <button
        type="button"
        onClick={handleEnd}
        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
      >
        End
      </button>
    </div>
  )
}
