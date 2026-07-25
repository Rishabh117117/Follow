'use client'

/**
 * IndexPhaseBadge — small badge showing the current indexing phase for a
 * raw file (Sprint UI-SPLIT-1, derived from apps/web IndexStatusBadge +
 * indexing-banner pattern).
 *
 * This is the pure-presentation primitive. Consumers handle the polling
 * and wire it into the full interactive badge; this surface only paints +
 * announces the phase.
 *
 * Canonical consumer: migration pending — see UI-SPLIT-1-REPORT.md §3.
 */

import React from 'react'
import { cn } from '@workspace/shared/utils'

export type IndexPhase = 'not_indexed' | 'queued' | 'indexing' | 'indexed' | 'failed' | 'cancelled'

export interface IndexPhaseBadgeProps {
  phase: IndexPhase
  /** Optional progress when phase === 'indexing'. 0..1 or chunks {done, total}. */
  progress?: { done: number; total: number } | number
  /** Secondary label like "ingest" or "embed" shown after the phase name. */
  subPhase?: string
  className?: string
  'data-testid'?: string
}

const phaseConfig: Record<IndexPhase, { label: string; classes: string }> = {
  indexed: { label: 'Indexed', classes: 'bg-emerald-100 text-emerald-700' },
  indexing: { label: 'Indexing', classes: 'bg-amber-100 text-amber-700' },
  queued: { label: 'Queued', classes: 'bg-amber-100 text-amber-700' },
  failed: { label: 'Failed', classes: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Cancelled', classes: 'bg-zinc-100 text-zinc-500' },
  not_indexed: { label: 'Not indexed', classes: 'bg-zinc-100 text-zinc-500' },
}

export const IndexPhaseBadge: React.FC<IndexPhaseBadgeProps> = ({
  phase,
  progress,
  subPhase,
  className,
  'data-testid': testId,
}) => {
  const cfg = phaseConfig[phase]
  let label = cfg.label
  if (phase === 'indexing') {
    if (typeof progress === 'number') label = `Indexing ${Math.round(progress * 100)}%`
    else if (progress && progress.total > 0) {
      label = `Indexing ${Math.round((progress.done / progress.total) * 100)}%`
    }
    if (subPhase) label += ` · ${subPhase}`
  }
  return (
    <span
      data-testid={testId ?? 'index-phase-badge'}
      data-phase={phase}
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-mono',
        cfg.classes,
        className,
      )}
    >
      {label}
    </span>
  )
}
