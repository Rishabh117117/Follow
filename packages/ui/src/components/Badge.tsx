import React from 'react'
import { cn } from '@workspace/shared/utils'

export interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info'
  children: React.ReactNode
  className?: string
}

const variantStyles: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-zinc-700/50 text-zinc-300 border-zinc-600',
  success: 'bg-green-600/20 text-green-400 border-green-600/30',
  warning: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
  danger: 'bg-red-600/20 text-red-400 border-red-600/30',
  info: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'default', children, className }) => {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
