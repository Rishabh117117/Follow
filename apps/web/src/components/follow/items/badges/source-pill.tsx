'use client'

import { SOURCE_CONFIG } from '../_shared'

export function SourcePill({ source, small }: { source: string | null | undefined; small?: boolean }) {
  const key = source ?? 'follow-web'
  const cfg = SOURCE_CONFIG[key] ?? SOURCE_CONFIG['follow-web']!
  return (
    <span
      style={{
        background: cfg.bg,
        color: cfg.fg,
        padding: small ? '1px 6px' : '2px 9px',
        borderRadius: 5,
        fontSize: small ? 9 : 10,
        fontFamily: 'monospace',
      }}
    >
      {cfg.label}
    </span>
  )
}
