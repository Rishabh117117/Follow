import React, { useState } from 'react'
import { cn } from '@workspace/shared/utils'

export interface AvatarProps {
  src?: string | null
  alt?: string
  name?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeStyles: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]
  const last = parts[parts.length - 1]
  if (!first) return '?'
  if (parts.length === 1) {
    return first.charAt(0).toUpperCase()
  }
  return (first.charAt(0) + (last ? last.charAt(0) : '')).toUpperCase()
}

export const Avatar: React.FC<AvatarProps> = ({ src, alt, name, size = 'md', className }) => {
  const [imgError, setImgError] = useState(false)
  const showImage = src && !imgError
  const initials = name ? getInitials(name) : '?'

  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        !showImage && 'bg-zinc-700 font-medium text-zinc-300',
        sizeStyles[size],
        className
      )}
      role="img"
      aria-label={alt || name || 'Avatar'}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt || name || 'Avatar'}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </div>
  )
}
