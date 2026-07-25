/**
 * Feature Registry — manages feature toggles and lazy-loads feature modules.
 *
 * Features are loaded on-demand via chrome.scripting.executeScript or
 * injected via the loader when toggles are enabled.
 */

import type { FeatureKey } from '@/lib/constants'

export interface FeatureModule {
  /** Unique feature key */
  key: FeatureKey | string
  /** Path to the built feature module (relative to dist/) */
  scriptPath: string
  /** Page types this feature supports */
  pageTypes: ('google-docs' | 'google-sheets' | 'google-slides' | 'web' | 'pdf')[]
  /** Whether this feature has been loaded into the current page */
  loaded: boolean
  /** Cleanup function returned by the feature's init() */
  cleanup?: () => void
}

class FeatureRegistry {
  private features = new Map<string, FeatureModule>()
  private activeToggles: Record<string, boolean> = {}

  /**
   * Register a feature module definition (does not load it).
   */
  define(module: Omit<FeatureModule, 'loaded'>): void {
    this.features.set(module.key, { ...module, loaded: false })
  }

  /**
   * Set active toggles and determine which features to load/unload.
   */
  setToggles(toggles: Record<string, boolean>): void {
    this.activeToggles = toggles
  }

  /**
   * Get features that should be active for the current page type and toggles.
   */
  getActiveFeatures(pageType: string): FeatureModule[] {
    const active: FeatureModule[] = []
    for (const feature of this.features.values()) {
      const toggleOn = this.activeToggles[feature.key] ?? false
      const pageMatch = feature.pageTypes.includes(pageType as FeatureModule['pageTypes'][number])
      if (toggleOn && pageMatch) {
        active.push(feature)
      }
    }
    return active
  }

  /**
   * Mark a feature as loaded.
   */
  markLoaded(key: string, cleanup?: () => void): void {
    const feature = this.features.get(key)
    if (feature) {
      feature.loaded = true
      feature.cleanup = cleanup
    }
  }

  /**
   * Unload a feature (call cleanup if available).
   */
  unload(key: string): void {
    const feature = this.features.get(key)
    if (feature?.loaded) {
      feature.cleanup?.()
      feature.loaded = false
      feature.cleanup = undefined
    }
  }

  /**
   * Unload all features.
   */
  unloadAll(): void {
    for (const key of this.features.keys()) {
      this.unload(key)
    }
  }

  /**
   * Check if a feature is loaded.
   */
  isLoaded(key: string): boolean {
    return this.features.get(key)?.loaded ?? false
  }
}

export const featureRegistry = new FeatureRegistry()
