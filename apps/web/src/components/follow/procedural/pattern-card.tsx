'use client'

/**
 * PatternCard (V41-PROCEDURAL-1 Phase 1)
 *
 * Single-pattern card for the Patterns tab. Shows label, confidence dot,
 * edge-count pill, contributor row (with privacy softening), and time
 * range. Deliberately minimal — no content preview, no action buttons;
 * curation is Phase 2.
 */

import { cn } from '@/lib/utils'
import type { Pattern } from '@/stores/procedural-store'

interface PatternCardProps {
  pattern: Pattern
  className?: string
}

function confidenceTone(c: number): { dot: string; label: string } {
  if (c >= 0.8) return { dot: 'bg-emerald-500', label: 'high' }
  if (c >= 0.5) return { dot: 'bg-amber-500', label: 'medium' }
  return { dot: 'bg-zinc-400', label: 'low' }
}

export function PatternCard({ pattern, className }: PatternCardProps) {
  const tone = confidenceTone(pattern.confidence)
  return (
    <article
      className={cn(
        'rounded-lg border bg-white p-3',
        className
      )}
      style={{ borderColor: 'var(--n200, #e5e5e5)' }}
      data-testid={`pattern-card-${pattern.id}`}
    >
      <header className="mb-2 flex items-start justify-between gap-3">
        <h3
          className="text-[13px] font-medium leading-tight"
          style={{ color: 'var(--n950, #0a0a0a)' }}
        >
          {pattern.label}
        </h3>
        <span
          className="inline-flex shrink-0 items-center gap-1 text-[10px]"
          style={{ color: 'var(--n500, #737373)' }}
          data-testid={`pattern-confidence-${pattern.id}`}
          title={`Confidence ${(pattern.confidence * 100).toFixed(0)}% (${tone.label})`}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
          {(pattern.confidence * 100).toFixed(0)}%
        </span>
      </header>

      {pattern.description && (
        <p className="mb-2 text-[11px]" style={{ color: 'var(--n500, #737373)' }}>
          {pattern.description}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1 text-[10px]" style={{ color: 'var(--n500, #737373)' }}>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5">
          {pattern.edgeCount} edge{pattern.edgeCount === 1 ? '' : 's'}
        </span>
        {pattern.edgeTypes.slice(0, 3).map((t) => (
          <span
            key={t}
            className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700"
          >
            {t}
          </span>
        ))}
        {pattern.hasPrivateContributors && (
          <span
            className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700"
            title="One or more contributors use a privacy preset that hides their identity."
            data-testid={`pattern-private-flag-${pattern.id}`}
          >
            private contributor
          </span>
        )}
      </div>

      {pattern.contributors.length > 0 && (
        <div
          className="mt-2 flex flex-wrap gap-1 text-[10px]"
          data-testid={`pattern-contributors-${pattern.id}`}
        >
          {pattern.contributors.slice(0, 5).map((c) => (
            <span
              key={c.id}
              className="rounded-full border px-2 py-0.5"
              style={{
                borderColor: 'var(--n200, #e5e5e5)',
                color: c.name ? 'var(--n700, #404040)' : 'var(--n400, #a3a3a3)',
              }}
            >
              {c.name ?? '—'} · {c.contributionCount}
            </span>
          ))}
        </div>
      )}

      <footer
        className="mt-2 flex items-center justify-between text-[10px]"
        style={{ color: 'var(--n400, #a3a3a3)' }}
      >
        <span>first seen {new Date(pattern.firstSeenAt).toLocaleDateString()}</span>
        <span>updated {new Date(pattern.lastUpdatedAt).toLocaleDateString()}</span>
      </footer>
    </article>
  )
}
