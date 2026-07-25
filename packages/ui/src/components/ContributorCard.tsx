'use client'

/**
 * ContributorCard — a compact card showing a contributor's identity and
 * recent-activity stats (Sprint UI-SPLIT-1).
 *
 * Derived from apps/web: follow/contributor-card, follow/provenance/
 * contributor-section, mobile/AvatarStack. Wraps the existing Avatar
 * primitive.
 *
 * Canonical consumer: migration pending — see UI-SPLIT-1-REPORT.md §3.
 */

import React from 'react'
import { cn } from '@workspace/shared/utils'
import { Avatar } from './Avatar'

export interface ContributorCardStat {
  label: string
  value: string | number
}

export interface ContributorCardProps {
  name: string
  email?: string
  avatarUrl?: string
  initials?: string
  stats?: ContributorCardStat[]
  topics?: string[]
  /** Rendered as a small right-aligned affordance (e.g. "View contributions"). */
  action?: { label: string; onClick: () => void }
  className?: string
  'data-testid'?: string
}

function deriveInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('')
}

export const ContributorCard: React.FC<ContributorCardProps> = ({
  name,
  email,
  avatarUrl,
  initials,
  stats = [],
  topics = [],
  action,
  className,
  'data-testid': testId,
}) => {
  return (
    <div
      data-testid={testId ?? 'contributor-card'}
      className={cn(
        'flex max-w-[420px] gap-3 rounded-lg border border-zinc-200 bg-white p-3',
        className,
      )}
    >
      <Avatar
        src={avatarUrl}
        name={name || (initials ?? deriveInitials(name || '??'))}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-zinc-800">{name}</div>
        {email && <div className="text-xs text-zinc-500">{email}</div>}
        {stats.length > 0 && (
          <div className="mt-1 font-mono text-[10px] text-zinc-400">
            {stats.map((s, i) => (
              <span key={s.label}>
                {i > 0 && ' · '}
                {s.value} {s.label}
              </span>
            ))}
          </div>
        )}
        {topics.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {topics.slice(0, 4).map((t) => (
              <span
                key={t}
                className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-2 text-xs text-indigo-600 hover:text-indigo-800"
          >
            {action.label} →
          </button>
        )}
      </div>
    </div>
  )
}
