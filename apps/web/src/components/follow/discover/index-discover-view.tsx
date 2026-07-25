'use client'

/**
 * IndexDiscoverView (V41-DISCOVER-1)
 *
 * Top-level view for `/workspace/[id]/discover`. Displays:
 *   - Source selector + privacy floor toggle
 *   - Recent discoverable indexes (user can click one to set as source)
 *   - Suggestions (similarity results for the selected source)
 */

import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useDiscoverStore, type PrivacyFloor } from '@/stores/discover-store'
import { IndexRecentActivity } from './index-recent-activity'
import { IndexSuggestionCard } from './index-suggestion-card'

interface IndexDiscoverViewProps {
  workspaceId: string
  className?: string
}

export function IndexDiscoverView({ workspaceId, className }: IndexDiscoverViewProps) {
  const sourceIndexId = useDiscoverStore((s) => s.sourceIndexId)
  const privacyFloor = useDiscoverStore((s) => s.privacyFloor)
  const suggestions = useDiscoverStore((s) => s.suggestions)
  const isLoading = useDiscoverStore((s) => s.isLoading)
  const error = useDiscoverStore((s) => s.error)
  const setPrivacyFloor = useDiscoverStore((s) => s.setPrivacyFloor)
  const runDiscover = useDiscoverStore((s) => s.runDiscover)

  // Auto-run when the source index changes — still USER-initiated because
  // the user clicked a card to set it.
  useEffect(() => {
    if (sourceIndexId) void runDiscover()
  }, [sourceIndexId, runDiscover])

  return (
    <div className={cn('mx-auto max-w-[1000px] p-8', className)} data-testid="index-discover-view">
      <header className="mb-6">
        <h1
          className="text-[28px] leading-tight"
          style={{
            fontFamily: 'Newsreader, Georgia, serif',
            color: 'var(--n950, #0a0a0a)',
            fontWeight: 500,
          }}
        >
          Discover
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--n500, #737373)' }}>
          Find indexes similar to yours. Signatures + topical overlap only — no fact content is ever shared.
        </p>
      </header>

      <section className="mb-6 flex items-center gap-3">
        <label className="text-[12px]" style={{ color: 'var(--n500, #737373)' }}>
          Privacy floor:
        </label>
        {(['fingerprint_only', 'topics_only', 'full_signature'] as PrivacyFloor[]).map(
          (f) => (
            <button
              key={f}
              type="button"
              onClick={() => setPrivacyFloor(f)}
              className={cn(
                'rounded-full border px-3 py-1 text-[11px]',
                privacyFloor === f
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-300 bg-white hover:border-gray-400'
              )}
              style={privacyFloor !== f ? { color: 'var(--n700, #404040)' } : undefined}
              data-testid={`privacy-floor-${f}`}
            >
              {f.replace(/_/g, ' ')}
            </button>
          )
        )}
      </section>

      <section className="mb-8">
        <h2
          className="mb-3 text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--n500, #737373)' }}
        >
          Recent discoverable indexes
        </h2>
        <IndexRecentActivity workspaceId={workspaceId} />
        <p className="mt-2 text-[11px]" style={{ color: 'var(--n400, #a3a3a3)' }}>
          Click a card to set it as the source, then see similar indexes below.
        </p>
      </section>

      <section>
        <h2
          className="mb-3 text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--n500, #737373)' }}
        >
          Similar indexes
        </h2>
        {error && (
          <div
            className="rounded-lg border border-red-300 bg-red-50 p-3 text-[12px] text-red-800"
            role="alert"
            data-testid="discover-error"
          >
            {error}
          </div>
        )}
        {!sourceIndexId && !error && (
          <div
            className="rounded-lg border border-dashed p-6 text-center"
            style={{ borderColor: 'var(--n300, #d4d4d4)' }}
            data-testid="no-source-empty"
          >
            <p className="text-[12px]" style={{ color: 'var(--n500, #737373)' }}>
              Pick a source index above to see similarity suggestions.
            </p>
          </div>
        )}
        {isLoading && (
          <div className="text-[12px]" style={{ color: 'var(--n500, #737373)' }}>
            Comparing signatures…
          </div>
        )}
        {suggestions && suggestions.matches.length === 0 && !isLoading && (
          <div
            className="rounded-lg border border-dashed p-6 text-center"
            style={{ borderColor: 'var(--n300, #d4d4d4)' }}
            data-testid="no-matches-empty"
          >
            <p className="text-[12px]" style={{ color: 'var(--n500, #737373)' }}>
              No similar indexes at this privacy floor. Scope reported as empty — not silently widened.
            </p>
            {suggestions.conflicts.length > 0 && (
              <p className="mt-2 text-[11px]" style={{ color: 'var(--n400, #a3a3a3)' }}>
                {suggestions.conflicts.length} governance conflict(s). Owners must opt in for cross-workspace discovery.
              </p>
            )}
          </div>
        )}
        {suggestions && suggestions.matches.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="suggestions-grid">
            {suggestions.matches.map((m) => (
              <IndexSuggestionCard key={m.indexId} match={m} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
