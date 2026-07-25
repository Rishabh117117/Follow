'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useProceduralStore } from '@/stores/procedural-store'

interface PatternFilterBarProps {
  className?: string
}

const WINDOW_OPTIONS = [7, 14, 30, 90]

export function PatternFilterBar({ className }: PatternFilterBarProps) {
  const timeWindowDays = useProceduralStore((s) => s.timeWindowDays)
  const minConfidence = useProceduralStore((s) => s.minConfidence)
  const topicContains = useProceduralStore((s) => s.topicContains)
  const setTimeWindow = useProceduralStore((s) => s.setTimeWindow)
  const setMinConfidence = useProceduralStore((s) => s.setMinConfidence)
  const setTopicContains = useProceduralStore((s) => s.setTopicContains)
  const refresh = useProceduralStore((s) => s.refresh)

  // Debounce topic input so we don't fire a request on every keystroke.
  const [topicDraft, setTopicDraft] = useState(topicContains ?? '')
  useEffect(() => {
    const t = setTimeout(() => {
      setTopicContains(topicDraft.trim() || null)
      void refresh()
    }, 300)
    return () => clearTimeout(t)
  }, [topicDraft, refresh, setTopicContains])

  return (
    <div
      className={cn('space-y-2 rounded-lg border bg-white p-3', className)}
      style={{ borderColor: 'var(--n200, #e5e5e5)' }}
      data-testid="pattern-filter-bar"
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--n500)' }}>
          Window
        </span>
        {WINDOW_OPTIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => {
              setTimeWindow(d)
              void refresh()
            }}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px]',
              timeWindowDays === d
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-300 bg-white hover:border-gray-400'
            )}
            data-testid={`window-${d}`}
          >
            {d}d
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--n500)' }}>
          Min conf
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={minConfidence}
          onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
          onMouseUp={() => void refresh()}
          onTouchEnd={() => void refresh()}
          className="flex-1"
          data-testid="min-confidence-slider"
        />
        <span className="w-10 text-right text-[11px] tabular-nums" style={{ color: 'var(--n700)' }}>
          {minConfidence.toFixed(2)}
        </span>
      </div>

      <div>
        <input
          type="text"
          value={topicDraft}
          onChange={(e) => setTopicDraft(e.target.value)}
          placeholder="Topic contains…"
          className="w-full rounded border border-gray-300 px-2 py-1 text-[11px]"
          style={{ color: 'var(--n950, #0a0a0a)' }}
          data-testid="topic-filter"
        />
      </div>
    </div>
  )
}
