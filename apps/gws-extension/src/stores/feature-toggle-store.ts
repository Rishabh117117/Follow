/**
 * Feature Toggle Store — manages 6 independently toggleable features.
 * Synced to chrome.storage.local for persistence across popup/content script contexts.
 */
import { create } from 'zustand'
import { STORAGE_KEYS, FEATURES, type FeatureKey } from '../lib/constants'

export interface FeatureToggleState {
  toggles: Record<FeatureKey, boolean>
  activeCount: number

  // Actions
  toggle: (key: FeatureKey) => void
  setToggle: (key: FeatureKey, enabled: boolean) => void
  loadFromStorage: () => Promise<void>
  isEnabled: (key: FeatureKey) => boolean
}

const defaultToggles: Record<FeatureKey, boolean> = {
  chat_in_document: false,
  track_document: false,
  document_analysis: false,
  write_with_ai: false,
  collaborate: false,
  chat_in_web: false,
}

function countActive(toggles: Record<FeatureKey, boolean>): number {
  return Object.values(toggles).filter(Boolean).length
}

export const useFeatureToggleStore = create<FeatureToggleState>((set, get) => ({
  toggles: { ...defaultToggles },
  activeCount: 0,

  toggle: (key: FeatureKey) => {
    const current = get().toggles[key]
    get().setToggle(key, !current)
  },

  setToggle: (key: FeatureKey, enabled: boolean) => {
    const newToggles = { ...get().toggles, [key]: enabled }
    set({ toggles: newToggles, activeCount: countActive(newToggles) })

    // Persist to chrome.storage.local
    try {
      chrome.storage.local.set({ [STORAGE_KEYS.FEATURE_TOGGLES]: newToggles })
    } catch {
      // Popup context may not have direct chrome.storage — use message passing
    }

    // Notify active tab content script
    try {
      chrome.runtime.sendMessage({
        type: 'FEATURE_TOGGLE_CHANGED' as const,
        payload: { feature: key, enabled, toggles: newToggles },
      })
    } catch {
      // Silently fail if no listener
    }
  },

  loadFromStorage: async () => {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.FEATURE_TOGGLES)
      const stored = result[STORAGE_KEYS.FEATURE_TOGGLES]
      if (stored && typeof stored === 'object') {
        const merged = { ...defaultToggles, ...stored }
        set({ toggles: merged, activeCount: countActive(merged) })
      }
    } catch {
      // Fallback: all toggles off
    }
  },

  isEnabled: (key: FeatureKey) => get().toggles[key] ?? false,
}))

// Listen for chrome.storage changes to stay in sync across contexts
try {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STORAGE_KEYS.FEATURE_TOGGLES]) {
      const newToggles = changes[STORAGE_KEYS.FEATURE_TOGGLES].newValue
      if (newToggles && typeof newToggles === 'object') {
        const merged = { ...defaultToggles, ...newToggles }
        useFeatureToggleStore.setState({
          toggles: merged,
          activeCount: countActive(merged),
        })
      }
    }
  })
} catch {
  // Not in extension context (e.g. during tests)
}
