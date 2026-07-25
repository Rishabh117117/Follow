'use client'

import { cn } from '@/lib/utils'
import type { Boundary } from '@/stores/scope-store'

interface LiveContextChipProps {
  boundary: Boundary
  onRemove?: () => void
  onEdit?: () => void
  className?: string
}

function summarize(b: Boundary): string {
  const vals = [b.value, ...(b.values ?? [])].filter((v) => v !== undefined).map(String).join(',')
  if (b.dimension === 'time' && b.window) {
    if (b.window.type === 'relative' && b.window.days) return `time ${b.op} ${b.window.days}d`
    if (b.window.type === 'absolute') return `time ${b.op} ${b.window.from ?? ''}–${b.window.to ?? ''}`
  }
  if (b.dimension === 'confidence') return `confidence ${b.op} ${b.value ?? '—'}`
  if (b.dimension === 'custom') return `custom: ${b.name ?? '(unnamed)'}`
  return vals ? `${b.dimension} ${b.op} ${vals}` : `${b.dimension} ${b.op}`
}

export function LiveContextChip({ boundary, onRemove, onEdit, className }: LiveContextChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800',
        className
      )}
      data-testid="live-context-chip"
    >
      <button
        type="button"
        onClick={onEdit}
        className="hover:underline"
        title="Edit scope"
      >
        {summarize(boundary)}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${boundary.dimension} boundary`}
          className="ml-1 text-emerald-700 hover:text-red-600"
        >
          ×
        </button>
      )}
    </span>
  )
}
