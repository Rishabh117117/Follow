import { useState, useEffect, useCallback } from 'react'

// ─── Breakpoints ──────────────────────────────────────────────────────────

export const BREAKPOINTS = {
  /** Mobile: < 640px */
  sm: 640,
  /** Tablet: < 1024px */
  md: 1024,
  /** Desktop: < 1280px */
  lg: 1280,
  /** Wide: >= 1280px */
  xl: 1440,
} as const

export type FollowBreakpoint = 'mobile' | 'tablet' | 'desktop' | 'wide'

// ─── Layout configurations per breakpoint ─────────────────────────────────

export interface FollowLayoutConfig {
  breakpoint: FollowBreakpoint
  /** Width of the floating unit input bar */
  inputBarWidth: number
  /** Width of side panels (notes, provenance, doc mode) */
  panelWidth: number
  /** Whether side panels should overlay vs push content */
  panelMode: 'overlay' | 'push'
  /** Max width of the page container */
  pageMaxWidth: number
  /** Whether to show the ruler */
  showRuler: boolean
  /** Whether to show the tab bar */
  showTabs: boolean
  /** Whether to show the full toolbar or compact */
  toolbarMode: 'full' | 'compact'
  /** Whether mode buttons show labels or icons only */
  modeButtonLabels: boolean
}

const LAYOUT_CONFIGS: Record<FollowBreakpoint, FollowLayoutConfig> = {
  mobile: {
    breakpoint: 'mobile',
    inputBarWidth: 340,
    panelWidth: 320,
    panelMode: 'overlay',
    pageMaxWidth: 480,
    showRuler: false,
    showTabs: false,
    toolbarMode: 'compact',
    modeButtonLabels: false,
  },
  tablet: {
    breakpoint: 'tablet',
    inputBarWidth: 520,
    panelWidth: 340,
    panelMode: 'overlay',
    pageMaxWidth: 600,
    showRuler: false,
    showTabs: true,
    toolbarMode: 'compact',
    modeButtonLabels: false,
  },
  desktop: {
    breakpoint: 'desktop',
    inputBarWidth: 680,
    panelWidth: 380,
    panelMode: 'overlay',
    pageMaxWidth: 680,
    showRuler: true,
    showTabs: true,
    toolbarMode: 'full',
    modeButtonLabels: true,
  },
  wide: {
    breakpoint: 'wide',
    inputBarWidth: 720,
    panelWidth: 400,
    panelMode: 'push',
    pageMaxWidth: 720,
    showRuler: true,
    showTabs: true,
    toolbarMode: 'full',
    modeButtonLabels: true,
  },
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useResponsiveFollow(): FollowLayoutConfig {
  const [config, setConfig] = useState<FollowLayoutConfig>(LAYOUT_CONFIGS.desktop)

  const updateConfig = useCallback(() => {
    const width = window.innerWidth
    if (width < BREAKPOINTS.sm) {
      setConfig(LAYOUT_CONFIGS.mobile)
    } else if (width < BREAKPOINTS.md) {
      setConfig(LAYOUT_CONFIGS.tablet)
    } else if (width < BREAKPOINTS.xl) {
      setConfig(LAYOUT_CONFIGS.desktop)
    } else {
      setConfig(LAYOUT_CONFIGS.wide)
    }
  }, [])

  useEffect(() => {
    updateConfig()
    window.addEventListener('resize', updateConfig)
    return () => window.removeEventListener('resize', updateConfig)
  }, [updateConfig])

  return config
}

// ─── Responsive panel auto-hide ──────────────────────────────────────────

/**
 * Automatically hides/shows left & right panels based on viewport width.
 * - < 640px: hide both panels
 * - 640–1024px: hide left panel only
 * - >= 1024px: no auto-hide (user controls)
 *
 * Call this hook once in any component that renders the three-column layout.
 */
export function useResponsivePanels(
  setLeftPanelOpen: (open: boolean) => void,
  setRightPanelOpen: (open: boolean) => void,
) {
  useEffect(() => {
    let prevBp: FollowBreakpoint | null = null
    const sync = () => {
      const bp = getBreakpoint(window.innerWidth)
      if (bp === prevBp) return
      prevBp = bp
      if (bp === 'mobile') {
        setLeftPanelOpen(false)
        setRightPanelOpen(false)
      } else if (bp === 'tablet') {
        setLeftPanelOpen(false)
      }
    }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [setLeftPanelOpen, setRightPanelOpen])
}

// ─── Utility helpers ──────────────────────────────────────────────────────

/** Resolve breakpoint from width */
export function getBreakpoint(width: number): FollowBreakpoint {
  if (width < BREAKPOINTS.sm) return 'mobile'
  if (width < BREAKPOINTS.md) return 'tablet'
  if (width < BREAKPOINTS.xl) return 'desktop'
  return 'wide'
}

/** Get layout config for a given width */
export function getLayoutConfig(width: number): FollowLayoutConfig {
  return LAYOUT_CONFIGS[getBreakpoint(width)]
}
