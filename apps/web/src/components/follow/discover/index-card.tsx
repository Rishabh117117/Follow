'use client'

/**
 * IndexCard (V41-DISCOVER-1)
 *
 * Compact index summary card. Used by IndexRecentActivity and (via
 * composition) IndexSuggestionCard. Deliberately shows no fact content.
 */

import { cn } from '@/lib/utils'

export interface IndexCardProps {
  indexId: string
  indexName: string
  ownerName?: string | null
  recordCount: number
  lastActivityAt: string | null
  topics?: string[]
  /** If present, renders a trailing similarity pill. */
  similarity?: number
  className?: string
  onOpen?: (indexId: string) => void
}

export function IndexCard({
  indexId,
  indexName,
  ownerName,
  recordCount,
  lastActivityAt,
  topics,
  similarity,
  className,
  onOpen,
}: IndexCardProps) {
  const lastActivityLabel = lastActivityAt
    ? new Date(lastActivityAt).toLocaleDateString()
    : '—'

  return (
    <article
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-white p-4',
        className
      )}
      style={{ borderColor: 'var(--n200, #e5e5e5)' }}
      data-testid={`index-card-${indexId}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-medium" style={{ color: 'var(--n950, #0a0a0a)' }}>
            {indexName}
          </h3>
          {ownerName && (
            <p className="mt-0.5 text-[12px]" style={{ color: 'var(--n500, #737373)' }}>
              by {ownerName}
            </p>
          )}
        </div>
        {typeof similarity === 'number' && (
          <span
            className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800"
            data-testid={`similarity-${indexId}`}
          >
            {Math.round(similarity * 100)}% similar
          </span>
        )}
      </header>

      <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--n500, #737373)' }}>
        <span>~{recordCount} records</span>
        <span>·</span>
        <span>last active {lastActivityLabel}</span>
      </div>

      {topics && topics.length > 0 && (
        <div className="flex flex-wrap gap-1" data-testid={`topics-${indexId}`}>
          {topics.slice(0, 6).map((t) => (
            <span
              key={t}
              className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px]"
              style={{ color: 'var(--n700, #404040)' }}
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {onOpen && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => onOpen(indexId)}
            className="text-[11px] text-blue-600 hover:underline"
          >
            View details
          </button>
        </div>
      )}
    </article>
  )
}
