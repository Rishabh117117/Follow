'use client'

import { cn } from '@/lib/utils'
import type { SimilarityMatch } from '@/stores/discover-store'
import { IndexCard } from './index-card'

interface IndexSuggestionCardProps {
  match: SimilarityMatch
  className?: string
  onOpen?: (indexId: string) => void
}

export function IndexSuggestionCard({ match, className, onOpen }: IndexSuggestionCardProps) {
  return (
    <div
      className={cn('flex flex-col gap-2', className)}
      data-testid={`suggestion-card-${match.indexId}`}
    >
      <IndexCard
        indexId={match.indexId}
        indexName={match.indexName}
        ownerName={match.ownerName ?? undefined}
        recordCount={match.recordCount}
        lastActivityAt={match.lastActivityAt}
        topics={match.topicalOverlap}
        similarity={match.similarity}
        onOpen={onOpen}
      />
      {match.topicalOverlap.length > 0 && (
        <div
          className="rounded-md border border-dashed p-2 text-[11px]"
          style={{
            borderColor: 'var(--n200, #e5e5e5)',
            color: 'var(--n500, #737373)',
          }}
        >
          <span className="font-medium" style={{ color: 'var(--n700, #404040)' }}>
            Topical overlap:
          </span>{' '}
          {match.topicalOverlap.slice(0, 8).join(', ')}
        </div>
      )}
    </div>
  )
}
