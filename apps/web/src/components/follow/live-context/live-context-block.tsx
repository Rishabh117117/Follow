'use client'

/**
 * LiveContextBlock — Sprint SCOPE-LIVECTX-1
 *
 * The "live block" that appears in chat when a scope is set to live mode.
 * Renders:
 *   - Collapsible JSON preview of the slice content delivered to MCP clients
 *   - Editable boundary chips (clicking a chip reopens the scope editor)
 *   - Pause / resume / end controls
 */

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useLiveContextStore } from '@/stores/live-context-store'
import { useScopeStore } from '@/stores/scope-store'
import { LiveContextChip } from './live-context-chip'
import { LiveContextControls } from './live-context-controls'

interface LiveContextBlockProps {
  className?: string
}

export function LiveContextBlock({ className }: LiveContextBlockProps) {
  const slice = useLiveContextStore((s) => s.slice)
  const fetchSlice = useLiveContextStore((s) => s.fetchSlice)
  const activeScope = useScopeStore((s) => s.activeScope)
  const openEditor = useScopeStore((s) => s.openEditor)
  const adjustBoundary = useScopeStore((s) => s.adjustBoundary)

  const [expanded, setExpanded] = useState(false)

  // Initial fetch + poll every 30s (the backend sync scheduler runs ~every 2min).
  useEffect(() => {
    void fetchSlice()
    const t = setInterval(() => void fetchSlice(), 30_000)
    return () => clearInterval(t)
  }, [fetchSlice])

  if (!slice) return null
  if (!activeScope) return null
  if (slice.syncStatus === 'shared') return null

  return (
    <div
      className={cn(
        'rounded-lg border border-emerald-200 bg-emerald-50/50 p-3',
        className
      )}
      data-testid="live-context-block"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              slice.syncStatus === 'live' ? 'bg-emerald-500' : 'bg-amber-400'
            )}
          />
          <span className="text-sm font-semibold text-emerald-900">
            Live context — {activeScope.name}
          </span>
          <span className="text-xs text-emerald-700">
            · {slice.itemCount} items
            {slice.redactionCount > 0 ? ` · ${slice.redactionCount} redactions` : ''}
          </span>
        </div>
        <LiveContextControls />
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        {activeScope.boundaries.map((b, i) => (
          <LiveContextChip
            key={i}
            boundary={b}
            onEdit={() => openEditor(activeScope.boundaries)}
            onRemove={() => void adjustBoundary(b, 'remove', i)}
          />
        ))}
        <button
          type="button"
          onClick={() => openEditor(activeScope.boundaries)}
          className="rounded-full border border-dashed border-emerald-300 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-100"
        >
          + Edit scope
        </button>
      </div>

      <div className="flex items-center justify-between text-xs text-emerald-800">
        <span>
          Last sync: {new Date(slice.lastSyncedAt).toLocaleTimeString()}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="hover:underline"
        >
          {expanded ? 'Hide' : 'Show'} delivered content
        </button>
      </div>

      {expanded && (
        <pre className="mt-2 max-h-64 overflow-auto rounded bg-white p-2 text-xs text-gray-800">
          {slice.content}
        </pre>
      )}
    </div>
  )
}
