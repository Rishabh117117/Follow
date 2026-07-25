'use client'

import { cn } from '@/lib/utils'
import type { Boundary } from '@/stores/scope-store'
import { DimensionPicker } from './dimension-picker'
import { OpValueWidget } from './op-value-widget'

interface BoundaryRowProps {
  boundary: Boundary
  index: number
  onUpdate: (next: Boundary) => void
  onRemove: () => void
  className?: string
}

export function BoundaryRow({
  boundary,
  index,
  onUpdate,
  onRemove,
  className,
}: BoundaryRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded border border-gray-200 bg-white p-2',
        className
      )}
      data-testid={`boundary-row-${index}`}
    >
      <DimensionPicker
        value={boundary.dimension}
        onChange={(dim) => onUpdate({ ...boundary, dimension: dim })}
      />
      <OpValueWidget boundary={boundary} onChange={onUpdate} />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove boundary"
        className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-red-600"
      >
        ×
      </button>
    </div>
  )
}
