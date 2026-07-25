'use client'

/**
 * RoutingBadge — small badge indicating whether an AI response was sourced
 * from the Index or Directory routing path (Sprint UI-SPLIT-1, lifted
 * from apps/web/follow/routing-badge.tsx which was the canonical impl).
 */

import React from 'react'
import { cn } from '@workspace/shared/utils'

export interface RoutingBadgeProps {
  queryType?: 'index' | 'directory'
  routingReason?: string
  className?: string
}

export const RoutingBadge: React.FC<RoutingBadgeProps> = ({
  queryType,
  routingReason,
  className,
}) => {
  if (!queryType) return null
  const isIndex = queryType === 'index'
  return (
    <span
      data-testid="routing-badge"
      data-query-type={queryType}
      title={routingReason}
      className={cn(
        'inline-block rounded px-1.5 py-0.5 font-mono text-[9px] border',
        isIndex
          ? 'bg-indigo-100/60 text-indigo-600 border-indigo-200'
          : 'bg-cyan-100/60 text-cyan-700 border-cyan-200',
        className,
      )}
    >
      {isIndex ? 'via Index' : 'via Directory'}
    </span>
  )
}
