'use client'

import { cn } from '@/lib/utils'
import { useIndexStore } from '@/stores/index-store'
import type { Boundary, BoundaryDimension, BoundaryOp } from '@/stores/scope-store'

interface OpValueWidgetProps {
  boundary: Boundary
  onChange: (next: Boundary) => void
  className?: string
}

const OPS_BY_DIMENSION: Record<BoundaryDimension, BoundaryOp[]> = {
  index: ['include', 'exclude'],
  contributor: ['include', 'exclude'],
  confidence: ['gte', 'lte'],
  time: ['within', 'not_within'],
  topic: ['include', 'exclude', 'matches'],
  edge_type: ['include', 'exclude'],
  privacy: ['include', 'exclude'],
  freshness: ['gte', 'lte'],
  source_tool: ['include', 'exclude'],
  provenance: ['include', 'exclude'],
  custom: ['matches', 'include', 'exclude'],
}

export function OpValueWidget({ boundary, onChange, className }: OpValueWidgetProps) {
  const indexes = useIndexStore((s) => s.indexes)

  const ops = OPS_BY_DIMENSION[boundary.dimension] ?? ['include']

  const setOp = (op: BoundaryOp) => onChange({ ...boundary, op })

  return (
    <div className={cn('flex flex-1 items-center gap-2', className)}>
      <select
        value={boundary.op}
        onChange={(e) => setOp(e.target.value as BoundaryOp)}
        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>

      {boundary.dimension === 'confidence' && (
        <ConfidenceInput boundary={boundary} onChange={onChange} />
      )}
      {boundary.dimension === 'time' && <TimeInput boundary={boundary} onChange={onChange} />}
      {boundary.dimension === 'contributor' && (
        <MultiValueInput
          boundary={boundary}
          onChange={onChange}
          placeholder="User IDs (comma-separated)"
        />
      )}
      {boundary.dimension === 'index' && (
        <IndexMultiSelect boundary={boundary} onChange={onChange} indexes={indexes} />
      )}
      {boundary.dimension === 'topic' && (
        <MultiValueInput
          boundary={boundary}
          onChange={onChange}
          placeholder="Topic tags (comma-separated)"
        />
      )}
      {boundary.dimension === 'custom' && (
        <input
          type="text"
          value={boundary.name ?? ''}
          onChange={(e) => onChange({ ...boundary, name: e.target.value })}
          placeholder="Name (required for custom)"
          className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
        />
      )}
      {(boundary.dimension === 'edge_type' ||
        boundary.dimension === 'privacy' ||
        boundary.dimension === 'freshness' ||
        boundary.dimension === 'source_tool' ||
        boundary.dimension === 'provenance') && (
        <MultiValueInput boundary={boundary} onChange={onChange} placeholder="Values (comma-separated)" />
      )}
    </div>
  )
}

function ConfidenceInput({ boundary, onChange }: OpValueWidgetProps) {
  const val = typeof boundary.value === 'number' ? (boundary.value as number) : 0.8
  return (
    <div className="flex flex-1 items-center gap-2">
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={val}
        onChange={(e) => onChange({ ...boundary, value: parseFloat(e.target.value) })}
        className="flex-1"
      />
      <span className="w-12 text-right text-sm tabular-nums text-gray-700">
        {val.toFixed(2)}
      </span>
    </div>
  )
}

function TimeInput({ boundary, onChange }: OpValueWidgetProps) {
  const window = boundary.window ?? { type: 'relative' as const, days: 14 }
  if (window.type === 'relative') {
    const presets = [7, 14, 30, 90]
    return (
      <div className="flex flex-1 items-center gap-1">
        {presets.map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => onChange({ ...boundary, window: { type: 'relative', days } })}
            className={cn(
              'rounded border px-2 py-1 text-xs',
              window.days === days
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
            )}
          >
            {days}d
          </button>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({
              ...boundary,
              window: { type: 'absolute', from: new Date().toISOString().slice(0, 10) },
            })
          }
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:border-gray-400"
        >
          Custom
        </button>
      </div>
    )
  }
  return (
    <div className="flex flex-1 items-center gap-1">
      <input
        type="date"
        value={window.from ?? ''}
        onChange={(e) =>
          onChange({ ...boundary, window: { ...window, from: e.target.value } })
        }
        className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
      />
      <span className="text-xs text-gray-500">→</span>
      <input
        type="date"
        value={window.to ?? ''}
        onChange={(e) => onChange({ ...boundary, window: { ...window, to: e.target.value } })}
        className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
      />
    </div>
  )
}

function MultiValueInput({
  boundary,
  onChange,
  placeholder,
}: OpValueWidgetProps & { placeholder: string }) {
  const text = (boundary.values ?? []).join(', ')
  return (
    <input
      type="text"
      value={text}
      onChange={(e) => {
        const vals = e.target.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        onChange({ ...boundary, values: vals, value: undefined })
      }}
      placeholder={placeholder}
      className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
    />
  )
}

function IndexMultiSelect({
  boundary,
  onChange,
  indexes,
}: OpValueWidgetProps & { indexes: Array<{ id: string; name: string }> }) {
  const selected = new Set((boundary.values ?? []).map(String))
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ ...boundary, values: [...next], value: undefined })
  }
  return (
    <div className="flex flex-1 flex-wrap items-center gap-1">
      {indexes.length === 0 && (
        <span className="text-xs text-gray-500">No indexes available.</span>
      )}
      {indexes.map((idx) => (
        <button
          key={idx.id}
          type="button"
          onClick={() => toggle(idx.id)}
          className={cn(
            'rounded border px-2 py-0.5 text-xs',
            selected.has(idx.id)
              ? 'border-blue-500 bg-blue-50 text-blue-700'
              : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
          )}
        >
          {idx.name}
        </button>
      ))}
    </div>
  )
}
