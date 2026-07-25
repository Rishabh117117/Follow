'use client'

import type { UnifiedItem } from '../_shared'

export function FileDetail({ item }: { item: UnifiedItem }) {
  const raw = item.raw as Record<string, unknown>
  const mimeType = (raw['mimeType'] as string) ?? ''
  const fileExt = mimeType.split('/').pop()?.slice(0, 4) || 'file'
  const name = item.title
  return (
    <div data-testid="file-detail">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div
          style={{
            width: 36,
            height: 36,
            background: 'var(--n100, #f0eeeb)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontFamily: 'monospace',
            color: 'var(--n500, #807a70)',
          }}
        >
          {fileExt}
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>{name}</div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--n400, #9c968d)',
              fontFamily: 'monospace',
            }}
          >
            {mimeType}
          </div>
        </div>
      </div>
      {item.preview && (
        <div
          style={{
            background: '#fff',
            border: '1px solid var(--n150, #e5e2de)',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <pre
            style={{
              fontFamily: 'monospace',
              fontSize: 12,
              color: 'var(--n700, #4d473c)',
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              margin: 0,
            }}
          >
            {item.preview.slice(0, 1200)}
          </pre>
        </div>
      )}
    </div>
  )
}
