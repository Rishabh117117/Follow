import { describe, it, expect, beforeEach } from 'vitest'
import {
  useKeyboardShortcutsStore,
  getShortcutsByCategory,
  formatKeyCombo,
  matchesKeyCombo,
  getModifierKey,
  SHORTCUT_CATEGORIES,
  type ShortcutCategory,
} from '@/stores/keyboard-shortcuts-store'
import {
  DURATION,
  EASING,
  KEYFRAMES,
  buildTransition,
  buildMultiTransition,
  staggerDelay,
  panelSlideIn,
  fadeIn,
} from '@/lib/follow-animations'
import { getBreakpoint, getLayoutConfig, BREAKPOINTS } from '@/hooks/use-responsive-follow'
import { useToastStore, showToast } from '@/components/follow/notifications/follow-toast'

// ─── Keyboard Shortcuts Store ─────────────────────────────────────────────

describe('useKeyboardShortcutsStore', () => {
  beforeEach(() => {
    useKeyboardShortcutsStore.getState().reset()
  })

  it('has correct initial state with 26 default shortcuts', () => {
    const state = useKeyboardShortcutsStore.getState()
    expect(state.shortcuts).toHaveLength(26)
    expect(state.isHelpOpen).toBe(false)
    expect(state.filterCategory).toBe('all')
  })

  it('toggleHelp opens and closes help panel', () => {
    const store = useKeyboardShortcutsStore.getState()
    store.toggleHelp()
    expect(useKeyboardShortcutsStore.getState().isHelpOpen).toBe(true)
    store.toggleHelp()
    expect(useKeyboardShortcutsStore.getState().isHelpOpen).toBe(false)
  })

  it('toggleShortcut disables and re-enables a shortcut', () => {
    const store = useKeyboardShortcutsStore.getState()
    const id = store.shortcuts[0]!.id
    expect(store.shortcuts[0]!.enabled).toBe(true)

    store.toggleShortcut(id)
    expect(useKeyboardShortcutsStore.getState().shortcuts[0]!.enabled).toBe(false)

    store.toggleShortcut(id)
    expect(useKeyboardShortcutsStore.getState().shortcuts[0]!.enabled).toBe(true)
  })

  it('setFilterCategory updates filter', () => {
    const store = useKeyboardShortcutsStore.getState()
    store.setFilterCategory('ai')
    expect(useKeyboardShortcutsStore.getState().filterCategory).toBe('ai')

    store.setFilterCategory('all')
    expect(useKeyboardShortcutsStore.getState().filterCategory).toBe('all')
  })

  it('reset restores defaults', () => {
    const store = useKeyboardShortcutsStore.getState()
    store.toggleHelp()
    store.setFilterCategory('editing')
    store.toggleShortcut(store.shortcuts[0]!.id)

    store.reset()
    const state = useKeyboardShortcutsStore.getState()
    expect(state.isHelpOpen).toBe(false)
    expect(state.filterCategory).toBe('all')
    expect(state.shortcuts.every((s) => s.enabled)).toBe(true)
  })
})

describe('getShortcutsByCategory', () => {
  it('groups shortcuts into all 6 categories', () => {
    const shortcuts = useKeyboardShortcutsStore.getState().shortcuts
    const grouped = getShortcutsByCategory(shortcuts, 'all')
    const categories: ShortcutCategory[] = [
      'navigation',
      'editing',
      'ai',
      'panels',
      'view',
      'notebook',
    ]
    categories.forEach((cat) => {
      expect(grouped[cat]).toBeDefined()
      expect(grouped[cat].length).toBeGreaterThan(0)
    })
  })

  it('filters to single category when specified', () => {
    const shortcuts = useKeyboardShortcutsStore.getState().shortcuts
    const grouped = getShortcutsByCategory(shortcuts, 'ai')
    expect(grouped.ai.length).toBeGreaterThan(0)
    expect(grouped.navigation).toHaveLength(0)
    expect(grouped.editing).toHaveLength(0)
  })
})

describe('formatKeyCombo', () => {
  it('replaces Mod with platform modifier', () => {
    const result = formatKeyCombo('Mod+J')
    const mod = getModifierKey()
    expect(result).toBe(`${mod}+J`)
  })

  it('handles multiple Mod replacements', () => {
    const result = formatKeyCombo('Mod+Shift+Mod')
    const mod = getModifierKey()
    expect(result).toBe(`${mod}+Shift+${mod}`)
  })
})

describe('matchesKeyCombo', () => {
  const createKeyEvent = (overrides: Partial<KeyboardEvent> = {}): KeyboardEvent => {
    return {
      key: 'j',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...overrides,
    } as KeyboardEvent
  }

  it('matches Mod+J with metaKey', () => {
    const e = createKeyEvent({ key: 'j', metaKey: true })
    expect(matchesKeyCombo(e, 'Mod+J')).toBe(true)
  })

  it('matches Mod+J with ctrlKey', () => {
    const e = createKeyEvent({ key: 'j', ctrlKey: true })
    expect(matchesKeyCombo(e, 'Mod+J')).toBe(true)
  })

  it('does not match when no modifier', () => {
    const e = createKeyEvent({ key: 'j' })
    expect(matchesKeyCombo(e, 'Mod+J')).toBe(false)
  })

  it('matches Mod+Shift+N', () => {
    const e = createKeyEvent({ key: 'n', metaKey: true, shiftKey: true })
    expect(matchesKeyCombo(e, 'Mod+Shift+N')).toBe(true)
  })

  it('does not match without shift when required', () => {
    const e = createKeyEvent({ key: 'n', metaKey: true })
    expect(matchesKeyCombo(e, 'Mod+Shift+N')).toBe(false)
  })
})

describe('SHORTCUT_CATEGORIES', () => {
  it('has 6 categories with labels and icons', () => {
    const keys = Object.keys(SHORTCUT_CATEGORIES)
    expect(keys).toHaveLength(6)
    keys.forEach((key) => {
      const cat = SHORTCUT_CATEGORIES[key as ShortcutCategory]
      expect(cat.label).toBeTruthy()
      expect(cat.icon).toBeTruthy()
    })
  })
})

// ─── Follow Animations ────────────────────────────────────────────────────

describe('follow-animations', () => {
  it('DURATION has expected preset values', () => {
    expect(DURATION.instant).toBe(100)
    expect(DURATION.fast).toBe(150)
    expect(DURATION.normal).toBe(200)
    expect(DURATION.toast).toBe(3000)
  })

  it('EASING has 5 named curves', () => {
    expect(Object.keys(EASING)).toHaveLength(5)
    expect(EASING.easeOut).toContain('cubic-bezier')
  })

  it('KEYFRAMES has 10 named keyframes', () => {
    expect(Object.keys(KEYFRAMES)).toHaveLength(10)
    expect(KEYFRAMES.slideInRight).toBe('slideInRight')
    expect(KEYFRAMES.toastIn).toBe('toastSlideIn')
  })

  it('buildTransition creates CSS transition string', () => {
    const t = buildTransition({ property: 'opacity', duration: 300, easing: EASING.easeOut })
    expect(t).toContain('opacity')
    expect(t).toContain('300ms')
    expect(t).toContain('cubic-bezier')
  })

  it('buildMultiTransition joins multiple transitions', () => {
    const t = buildMultiTransition([
      { property: 'opacity', duration: 200 },
      { property: 'transform', duration: 300 },
    ])
    expect(t).toContain('opacity')
    expect(t).toContain('transform')
    // Each transition is separated by ", " but cubic-bezier also has commas
    // so just check both properties are present in the combined string
    const parts = t.split(', ').filter((p) => p.startsWith('opacity') || p.startsWith('transform'))
    expect(parts.length).toBe(2)
  })

  it('staggerDelay caps at maxDelayMs', () => {
    expect(staggerDelay(0)).toBe(0)
    expect(staggerDelay(5, 30, 300)).toBe(150)
    expect(staggerDelay(100, 30, 300)).toBe(300) // capped
  })

  it('panelSlideIn and fadeIn return animation class strings', () => {
    expect(panelSlideIn()).toContain('animate-[')
    expect(panelSlideIn()).toContain('slideInRight')
    expect(fadeIn()).toContain('fadeIn')
    expect(fadeIn(500)).toContain('500ms')
  })
})

// ─── Responsive Follow ────────────────────────────────────────────────────

describe('responsive-follow', () => {
  it('getBreakpoint returns correct breakpoint for widths', () => {
    expect(getBreakpoint(320)).toBe('mobile')
    expect(getBreakpoint(768)).toBe('tablet')
    expect(getBreakpoint(1200)).toBe('desktop')
    expect(getBreakpoint(1500)).toBe('wide')
  })

  it('BREAKPOINTS has 4 defined values', () => {
    expect(Object.keys(BREAKPOINTS)).toHaveLength(4)
    expect(BREAKPOINTS.sm).toBe(640)
    expect(BREAKPOINTS.md).toBe(1024)
  })

  it('getLayoutConfig returns appropriate config per breakpoint', () => {
    const mobile = getLayoutConfig(400)
    expect(mobile.breakpoint).toBe('mobile')
    expect(mobile.showRuler).toBe(false)
    expect(mobile.toolbarMode).toBe('compact')
    expect(mobile.modeButtonLabels).toBe(false)

    const desktop = getLayoutConfig(1200)
    expect(desktop.breakpoint).toBe('desktop')
    expect(desktop.showRuler).toBe(true)
    expect(desktop.toolbarMode).toBe('full')
    expect(desktop.modeButtonLabels).toBe(true)
  })

  it('wide layout uses push panel mode', () => {
    const wide = getLayoutConfig(1500)
    expect(wide.panelMode).toBe('push')
    expect(wide.panelWidth).toBe(400)
  })
})

// ─── Toast Store ──────────────────────────────────────────────────────────

describe('useToastStore', () => {
  beforeEach(() => {
    useToastStore.getState().clearAll()
  })

  it('addToast creates toast with unique ID', () => {
    const id = useToastStore.getState().addToast('Hello', 'success')
    expect(id).toBeTruthy()
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.message).toBe('Hello')
    expect(toasts[0]!.type).toBe('success')
    expect(toasts[0]!.isDismissing).toBe(false)
  })

  it('dismissToast sets isDismissing flag', () => {
    const id = useToastStore.getState().addToast('Test')
    useToastStore.getState().dismissToast(id)
    expect(useToastStore.getState().toasts[0]!.isDismissing).toBe(true)
  })

  it('removeToast removes from list', () => {
    const id = useToastStore.getState().addToast('Test')
    useToastStore.getState().removeToast(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('showToast convenience helper adds toast', () => {
    const id = showToast('Quick toast', 'warning')
    expect(id).toBeTruthy()
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0]!.type).toBe('warning')
  })

  it('clearAll removes all toasts', () => {
    useToastStore.getState().addToast('One')
    useToastStore.getState().addToast('Two')
    useToastStore.getState().addToast('Three')
    expect(useToastStore.getState().toasts).toHaveLength(3)

    useToastStore.getState().clearAll()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
