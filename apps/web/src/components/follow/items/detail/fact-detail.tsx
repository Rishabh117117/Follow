'use client'

import type { UnifiedItem } from '../_shared'
import { ConfidenceDot } from '../badges/confidence-dot'
import { SourcePill } from '../badges/source-pill'

export function FactDetail({ item }: { item: UnifiedItem }) {
  return (
    <div
      data-testid="fact-detail"
      style={{
        background: '#fff',
        border: '1px solid var(--n150, #e5e2de)',
        borderRadius: 8,
        padding: 20,
      }}
    >
      <div style={{ fontSize: 15, lineHeight: 1.6, marginBottom: 14 }}>{item.title}</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {typeof item.confidence === 'number' && <ConfidenceDot value={item.confidence} />}
        <SourcePill source={item.source} />
        {item.time && (
          <span style={{ fontSize: 11, color: 'var(--n500, #807a70)' }}>{item.time}</span>
        )}
      </div>
    </div>
  )
}
