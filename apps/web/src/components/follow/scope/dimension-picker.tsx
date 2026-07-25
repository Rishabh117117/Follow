'use client'

import { cn } from '@/lib/utils'
import type { BoundaryDimension } from '@/stores/scope-store'

const DIMENSIONS: Array<{ value: BoundaryDimension; label: string; blurb: string }> = [
  { value: 'index', label: 'Index', blurb: 'Which index(es) to include or exclude' },
  { value: 'contributor', label: 'Contributor', blurb: 'Restrict by who contributed a fact' },
  { value: 'confidence', label: 'Confidence', blurb: 'High- or low-confidence cut-offs' },
  { value: 'time', label: 'Time', blurb: 'Last N days or absolute date range' },
  { value: 'topic', label: 'Topic', blurb: 'Topic tags or themes' },
  { value: 'edge_type', label: 'Edge type', blurb: 'Graph edges: support, counter, evidence' },
  { value: 'privacy', label: 'Privacy', blurb: 'Privacy preset layer' },
  { value: 'freshness', label: 'Freshness', blurb: 'How recently the fact was updated' },
  { value: 'source_tool', label: 'Source tool', blurb: 'Web capture, notebook, chat, etc.' },
  { value: 'provenance', label: 'Provenance', blurb: 'Which provenance signals to allow' },
  { value: 'custom', label: 'Custom', blurb: 'Free-form rule — must have a name' },
]

interface DimensionPickerProps {
  value: BoundaryDimension
  onChange: (dim: BoundaryDimension) => void
  className?: string
}

export function DimensionPicker({ value, onChange, className }: DimensionPickerProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as BoundaryDimension)}
      className={cn(
        'rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none',
        className
      )}
      title={DIMENSIONS.find((d) => d.value === value)?.blurb}
    >
      {DIMENSIONS.map((d) => (
        <option key={d.value} value={d.value}>
          {d.label}
        </option>
      ))}
    </select>
  )
}

export const DIMENSION_OPTIONS = DIMENSIONS
