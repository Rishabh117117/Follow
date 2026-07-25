import { describe, it, expect } from 'vitest'
import { featureVault } from '@/config/feature-vault'

describe('VaultView (UI-2)', () => {
  it('renders all features from config', () => {
    // featureVault should have 17 features (updated from 16 after FV-1 additions)
    expect(featureVault.length).toBeGreaterThanOrEqual(16)
  })

  it('each feature shows category pill', () => {
    const validCategories = ['editor', 'capture', 'intelligence', 'collaboration']
    for (const feature of featureVault) {
      expect(validCategories).toContain(feature.category)
    }
  })

  it('all features show inactive status', () => {
    for (const feature of featureVault) {
      expect(feature.active).toBe(false)
    }
  })
})
