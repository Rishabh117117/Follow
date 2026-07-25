'use client'

import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useQueryStore } from '@/stores/query-store'

interface SavedQueriesListProps {
  className?: string
}

export function SavedQueriesList({ className }: SavedQueriesListProps) {
  const saved = useQueryStore((s) => s.savedQueries)
  const fetchSaved = useQueryStore((s) => s.fetchSaved)
  const loadSaved = useQueryStore((s) => s.loadSaved)
  const runSaved = useQueryStore((s) => s.runSaved)
  const togglePin = useQueryStore((s) => s.togglePin)
  const deleteSaved = useQueryStore((s) => s.deleteSaved)

  useEffect(() => {
    void fetchSaved()
  }, [fetchSaved])

  const pinned = saved.filter((q) => q.isPinned)
  const recent = saved.filter((q) => !q.isPinned).slice(0, 5)

  if (saved.length === 0) {
    return (
      <div
        className={cn('rounded border border-dashed border-gray-300 p-3 text-xs text-gray-500', className)}
        data-testid="saved-queries-empty"
      >
        No saved queries yet. Compose one and save it to see it here.
      </div>
    )
  }

  const renderItem = (q: (typeof saved)[number]) => (
    <li
      key={q.id}
      className="group flex items-center justify-between rounded border border-gray-200 bg-white p-2 text-sm"
      data-testid={`saved-query-${q.id}`}
    >
      <div className="flex-1 truncate">
        <div className="font-medium text-gray-900">{q.name}</div>
        <div className="text-xs text-gray-500">
          {q.boundaries.length} boundaries · run {q.runCount} time{q.runCount === 1 ? '' : 's'}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={() => void runSaved(q.id)}
          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:border-blue-400 hover:bg-blue-50"
        >
          Run
        </button>
        <button
          type="button"
          onClick={() => void loadSaved(q.id)}
          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:border-gray-400"
        >
          Load
        </button>
        <button
          type="button"
          onClick={() => void togglePin(q.id)}
          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:border-amber-400"
          aria-label={q.isPinned ? 'Unpin query' : 'Pin query'}
        >
          {q.isPinned ? '★' : '☆'}
        </button>
        <button
          type="button"
          onClick={() => void deleteSaved(q.id)}
          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:border-red-400 hover:text-red-600"
          aria-label="Delete query"
        >
          ×
        </button>
      </div>
    </li>
  )

  return (
    <div className={cn('space-y-3', className)} data-testid="saved-queries-list">
      {pinned.length > 0 && (
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
            Pinned
          </h4>
          <ul className="space-y-1">{pinned.map(renderItem)}</ul>
        </section>
      )}
      {recent.length > 0 && (
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Recent
          </h4>
          <ul className="space-y-1">{recent.map(renderItem)}</ul>
        </section>
      )}
    </div>
  )
}
