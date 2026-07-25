'use client'

import { featureVault, type VaultFeature } from '@/config/feature-vault'

const CATEGORY_COLORS: Record<string, string> = {
  editor: '#818cf8',
  capture: '#a3e635',
  intelligence: '#22d3ee',
  collaboration: '#4ade80',
}

export function VaultView() {
  const features = featureVault

  return (
    <div className="flex-1 overflow-auto p-8" data-testid="vault-view">
      <div className="mx-auto max-w-[600px]">
        <h2 className="mb-2 text-[16px] font-semibold" style={{ color: 'var(--n800, #262626)' }}>
          Feature Vault
        </h2>
        <p
          className="mb-6 text-[13px]"
          style={{ color: 'var(--n500, #737373)' }}
          data-testid="vault-header-text"
        >
          {features.length} features are currently inactive and stored in the vault.
        </p>

        <div className="space-y-2">
          {features.map((feature: VaultFeature) => (
            <div
              key={feature.id}
              className="flex items-center gap-3 rounded-lg border p-3"
              style={{ borderColor: 'var(--n150, #e5e5e5)' }}
              data-testid={`vault-feature-${feature.id}`}
            >
              <span
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ background: '#9ca3af' }}
              />
              <span
                className="flex-1 text-[13px] font-medium"
                style={{ color: 'var(--n700, #404040)' }}
              >
                {feature.name}
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[9px] font-medium"
                style={{
                  background: (CATEGORY_COLORS[feature.category] ?? '#999') + '20',
                  color: CATEGORY_COLORS[feature.category] ?? '#999',
                }}
                data-testid={`category-pill-${feature.id}`}
              >
                {feature.category}
              </span>
              <span className="font-mono text-[10px]" style={{ color: 'var(--n400, #a3a3a3)' }}>
                inactive
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
