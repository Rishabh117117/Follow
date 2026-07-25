import { create } from 'zustand'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface KeyboardShortcut {
  id: string
  /** Display label */
  label: string
  /** Key combo, e.g. "Cmd+J", "Cmd+Shift+D", "Escape" */
  keys: string
  /** Category for grouping in help panel */
  category: ShortcutCategory
  /** Description of what the shortcut does */
  description: string
  /** Whether this shortcut is currently enabled */
  enabled: boolean
}

export type ShortcutCategory =
  | 'navigation'
  | 'editing'
  | 'ai'
  | 'panels'
  | 'view'
  | 'notebook'

interface KeyboardShortcutsState {
  /** All registered shortcuts */
  shortcuts: KeyboardShortcut[]
  /** Whether the help panel is visible */
  isHelpOpen: boolean
  /** Filter category in help panel */
  filterCategory: ShortcutCategory | 'all'

  // Actions
  openHelp: () => void
  closeHelp: () => void
  toggleHelp: () => void
  setFilterCategory: (category: ShortcutCategory | 'all') => void
  toggleShortcut: (id: string) => void
  reset: () => void
}

/** Detect platform for modifier key display */
export function getModifierKey(): 'Cmd' | 'Ctrl' {
  if (typeof navigator === 'undefined') return 'Ctrl'
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'Cmd' : 'Ctrl'
}

/** Format key combo for display */
export function formatKeyCombo(keys: string): string {
  const mod = getModifierKey()
  return keys.replace(/Mod/g, mod)
}

/** Parse key combo for matching against KeyboardEvent */
export function matchesKeyCombo(e: KeyboardEvent, keys: string): boolean {
  const parts = keys.toLowerCase().split('+')
  const requiresMod = parts.includes('mod') || parts.includes('cmd') || parts.includes('ctrl')
  const requiresShift = parts.includes('shift')
  const requiresAlt = parts.includes('alt')
  const key = parts.filter((p) => !['mod', 'cmd', 'ctrl', 'shift', 'alt'].includes(p))[0]

  if (!key) return false
  if (requiresMod && !(e.metaKey || e.ctrlKey)) return false
  if (!requiresMod && (e.metaKey || e.ctrlKey)) return false
  if (requiresShift && !e.shiftKey) return false
  if (!requiresShift && e.shiftKey) return false
  if (requiresAlt && !e.altKey) return false

  return e.key.toLowerCase() === key
}

// ─── Default shortcuts ─────────────────────────────────────────────────────

const DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  // Navigation
  { id: 'toggle-unit', label: 'Toggle AI Unit', keys: 'Mod+J', category: 'navigation', description: 'Show/hide the floating AI unit', enabled: true },
  { id: 'go-home', label: 'Go to Home', keys: 'Mod+Shift+H', category: 'navigation', description: 'Navigate to the document list', enabled: true },
  { id: 'quick-search', label: 'Quick Search', keys: 'Mod+K', category: 'navigation', description: 'Open quick search / command palette', enabled: true },

  // Editing
  { id: 'save', label: 'Save', keys: 'Mod+S', category: 'editing', description: 'Save the current document', enabled: true },
  { id: 'clip-selection', label: 'Clip Selection', keys: 'Mod+Shift+E', category: 'editing', description: 'Clip selected text as evidence', enabled: true },

  // AI
  { id: 'ask-ai', label: 'Ask AI', keys: 'Mod+Shift+A', category: 'ai', description: 'Send selected text to AI for analysis', enabled: true },
  { id: 'ghost-commit', label: 'Commit Ghost', keys: 'Mod+Enter', category: 'ai', description: 'Commit the focused ghost draft to the document', enabled: true },
  { id: 'ghost-dismiss', label: 'Dismiss Ghost', keys: 'Escape', category: 'ai', description: 'Dismiss the focused ghost draft', enabled: true },
  { id: 'ghost-next', label: 'Next Ghost', keys: 'Tab', category: 'ai', description: 'Move focus to the next ghost draft', enabled: true },

  // Panels
  { id: 'toggle-notes', label: 'Toggle Notes', keys: 'Mod+Shift+N', category: 'panels', description: 'Open/close the Follow Notes panel', enabled: true },
  { id: 'toggle-prov', label: 'Toggle Provenance', keys: 'Mod+Shift+P', category: 'panels', description: 'Open/close the Provenance panel', enabled: true },
  { id: 'toggle-share', label: 'Share Document', keys: 'Mod+Shift+S', category: 'panels', description: 'Open the share dialog', enabled: true },

  // View
  { id: 'toggle-dev', label: 'Toggle Advanced Mode', keys: 'Mod+Shift+D', category: 'view', description: 'Switch between Follow mode and Advanced mode', enabled: true },
  { id: 'shortcut-help', label: 'Keyboard Shortcuts', keys: 'Mod+/', category: 'view', description: 'Show this keyboard shortcuts panel', enabled: true },

  // Notebook
  { id: 'nb-toggle-chat', label: 'Toggle Chat Bar', keys: 'Mod+J', category: 'notebook', description: 'Toggle notebook chat bar expanded/collapsed', enabled: true },
  { id: 'nb-undo', label: 'Undo', keys: 'Mod+Z', category: 'notebook', description: 'Undo last notebook action', enabled: true },
  { id: 'nb-redo', label: 'Redo', keys: 'Mod+Shift+Z', category: 'notebook', description: 'Redo last undone notebook action', enabled: true },
  { id: 'nb-delete', label: 'Delete Blocks', keys: 'Delete', category: 'notebook', description: 'Delete selected blocks', enabled: true },
  { id: 'nb-select-all', label: 'Select All', keys: 'Mod+A', category: 'notebook', description: 'Select all blocks on current page', enabled: true },
  { id: 'nb-duplicate', label: 'Duplicate', keys: 'Mod+D', category: 'notebook', description: 'Duplicate selected blocks', enabled: true },
  { id: 'nb-copy', label: 'Copy Blocks', keys: 'Mod+C', category: 'notebook', description: 'Copy selected blocks to clipboard', enabled: true },
  { id: 'nb-cut', label: 'Cut Blocks', keys: 'Mod+X', category: 'notebook', description: 'Cut selected blocks to clipboard', enabled: true },
  { id: 'nb-paste', label: 'Paste', keys: 'Mod+V', category: 'notebook', description: 'Paste blocks or content from clipboard', enabled: true },
  { id: 'nb-escape', label: 'Escape', keys: 'Escape', category: 'notebook', description: 'Exit text edit / close strip / deselect', enabled: true },
  { id: 'nb-new-page', label: 'New Page', keys: 'Mod+Shift+N', category: 'notebook', description: 'Add a new page after current', enabled: true },
  { id: 'nb-group', label: 'Group', keys: 'Mod+G', category: 'notebook', description: 'Group selected blocks (coming soon)', enabled: true },
]

// ─── Store ─────────────────────────────────────────────────────────────────

export const useKeyboardShortcutsStore = create<KeyboardShortcutsState>((set) => ({
  shortcuts: DEFAULT_SHORTCUTS,
  isHelpOpen: false,
  filterCategory: 'all',

  openHelp: () => set({ isHelpOpen: true }),
  closeHelp: () => set({ isHelpOpen: false }),
  toggleHelp: () => set((s) => ({ isHelpOpen: !s.isHelpOpen })),

  setFilterCategory: (category) => set({ filterCategory: category }),

  toggleShortcut: (id) =>
    set((s) => ({
      shortcuts: s.shortcuts.map((sc) =>
        sc.id === id ? { ...sc, enabled: !sc.enabled } : sc
      ),
    })),

  reset: () =>
    set({
      shortcuts: DEFAULT_SHORTCUTS,
      isHelpOpen: false,
      filterCategory: 'all',
    }),
}))

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Get shortcuts grouped by category */
export function getShortcutsByCategory(
  shortcuts: KeyboardShortcut[],
  filterCategory: ShortcutCategory | 'all'
): Record<ShortcutCategory, KeyboardShortcut[]> {
  const categories: ShortcutCategory[] = ['navigation', 'editing', 'ai', 'panels', 'view', 'notebook']
  const result = {} as Record<ShortcutCategory, KeyboardShortcut[]>

  categories.forEach((cat) => {
    if (filterCategory === 'all' || filterCategory === cat) {
      result[cat] = shortcuts.filter((sc) => sc.category === cat)
    } else {
      result[cat] = []
    }
  })

  return result
}

/** Category display config */
export const SHORTCUT_CATEGORIES: Record<ShortcutCategory, { label: string; icon: string }> = {
  navigation: { label: 'Navigation', icon: '🧭' },
  editing: { label: 'Editing', icon: '✏️' },
  ai: { label: 'AI', icon: '✨' },
  panels: { label: 'Panels', icon: '📋' },
  view: { label: 'View', icon: '👁️' },
  notebook: { label: 'Notebook', icon: '📓' },
}
