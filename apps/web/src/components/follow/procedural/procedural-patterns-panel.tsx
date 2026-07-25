'use client'

/**
 * ProceduralPatternsPanel (V41-PROCEDURAL-1 Phase 1)
 *
 * Top-level panel body mounted inside the right-panel's "Patterns" tab.
 * Structure: summary strip + filter bar + pattern list. User-initiated
 * loads only — no background polling.
 */

import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useProceduralStore } from '@/stores/procedural-store'
import { PatternCard } from './pattern-card'
import { PatternFilterBar } from './pattern-filter-bar'

interface ProceduralPatternsPanelProps {
  workspaceId: string
  className?: string
}

export function ProceduralPatternsPanel({
  workspaceId,
  className,
}: ProceduralPatternsPanelProps) {
  const patterns = useProceduralStore((s) => s.patterns)
  const summary = useProceduralStore((s) => s.summary)
  const isLoading = useProceduralStore((s) => s.isLoading)
  const error = useProceduralStore((s) => s.error)
  const total = useProceduralStore((s) => s.total)
  const filtered = useProceduralStore((s) => s.filtered)
  const droppedByPrivacy = useProceduralStore((s) => s.droppedByPrivacy)
  const loadPatterns = useProceduralStore((s) => s.loadPatterns)
  const loadSummary = useProceduralStore((s) => s.loadSummary)
  const refresh = useProceduralStore((s) => s.refresh)

  // Initial load when the panel mounts. User-initiated in the sense that
  // opening the tab is a user action — no periodic refresh fires after.
  useEffect(() => {
    void loadPatterns(workspaceId)
    void loadSummary(workspaceId)
  }, [workspaceId, loadPatterns, loadSummary])

  return (
    <div
      className={cn('flex flex-col gap-3 p-3', className)}
      data-testid="procedural-patterns-panel"
    >
      {/* Summary strip */}
      <div
        className="rounded-lg border bg-white p-3"
        style={{ borderColor: 'var(--n200, #e5e5e5)' }}
        data-testid="patterns-summary"
      >
        <div className="flex items-center justify-between">
          <h3
            className="text-[12px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--n500, #737373)' }}
          >
            Learned patterns
          </h3>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded border border-gray-300 px-2 py-0.5 text-[10px] hover:border-gray-400"
            style={{ color: 'var(--n700, #404040)' }}
            data-testid="patterns-refresh"
          >
            Refresh
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[11px]" style={{ color: 'var(--n700, #404040)' }}>
          <span>
            <span className="font-semibold" style={{ color: 'var(--n950, #0a0a0a)' }}>
              {filtered}
            </span>{' '}
            after filters
          </span>
          <span>·</span>
          <span>{total} total</span>
          {droppedByPrivacy > 0 && (
            <>
              <span>·</span>
              <span className="text-amber-700" data-testid="privacy-drop-count">
                {droppedByPrivacy} dropped by privacy
              </span>
            </>
          )}
        </div>
        {summary && summary.topEdgeTypes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
            <span style={{ color: 'var(--n500, #737373)' }}>Top edges:</span>
            {summary.topEdgeTypes.map((t) => (
              <span
                key={t}
                className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <PatternFilterBar />

      {/* Error banner (non-blocking) */}
      {error && (
        <div
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-800"
          role="alert"
          data-testid="patterns-error"
        >
          {error}
        </div>
      )}

      {/* List */}
      {isLoading && patterns.length === 0 && (
        <div className="text-[11px]" style={{ color: 'var(--n500, #737373)' }}>
          Loading patterns…
        </div>
      )}
      {!isLoading && patterns.length === 0 && !error && (
        <div
          className="rounded-lg border border-dashed p-4 text-center text-[11px]"
          style={{ borderColor: 'var(--n300, #d4d4d4)', color: 'var(--n500, #737373)' }}
          data-testid="patterns-empty"
        >
          No patterns match these filters. Widen the window or lower confidence.
        </div>
      )}
      <div className="space-y-2" data-testid="patterns-list">
        {patterns.map((p) => (
          <PatternCard key={p.id} pattern={p} />
        ))}
      </div>
    </div>
  )
}
