'use client'

/**
 * ShortcutsHelpPanel — overlay panel showing all keyboard shortcuts.
 *
 * Triggered by Cmd+/ or from the floating unit.
 * Groups shortcuts by category with key combo display.
 */

import { useCallback } from 'react'
import {
  useKeyboardShortcutsStore,
  getShortcutsByCategory,
  formatKeyCombo,
  SHORTCUT_CATEGORIES,
  type ShortcutCategory,
} from '@/stores/keyboard-shortcuts-store'

export function ShortcutsHelpPanel() {
  const { shortcuts, isHelpOpen, filterCategory, closeHelp, setFilterCategory } =
    useKeyboardShortcutsStore()

  const grouped = getShortcutsByCategory(shortcuts, filterCategory)

  const handleBackdropClick = useCallback(() => {
    closeHelp()
  }, [closeHelp])

  if (!isHelpOpen) return null

  const categoryKeys = Object.keys(SHORTCUT_CATEGORIES) as ShortcutCategory[]

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/20 transition-opacity"
        onClick={handleBackdropClick}
      />

      {/* Centered panel */}
      <div
        className="fixed left-1/2 top-1/2 z-[61] w-[480px] -translate-x-1/2 -translate-y-1/2 animate-[scaleIn_200ms_ease-out] rounded-xl bg-white shadow-2xl"
        style={{ border: '1px solid var(--n200)' }}
        data-testid="shortcuts-help-panel"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '1px solid var(--n150)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">⌨️</span>
            <span className="text-sm font-semibold" style={{ color: 'var(--n800)' }}>
              Keyboard Shortcuts
            </span>
          </div>
          <button
            onClick={closeHelp}
            className="rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--n100)]"
            style={{ color: 'var(--n500)' }}
          >
            ✕
          </button>
        </div>

        {/* Category filter */}
        <div
          className="flex items-center gap-1 px-5 py-2"
          style={{ borderBottom: '1px solid var(--n100)' }}
        >
          <button
            onClick={() => setFilterCategory('all')}
            className="rounded-md px-2 py-1 text-[10px] font-medium transition-colors"
            style={{
              background: filterCategory === 'all' ? 'var(--n200)' : undefined,
              color: filterCategory === 'all' ? 'var(--n700)' : 'var(--n400)',
            }}
          >
            All
          </button>
          {categoryKeys.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className="rounded-md px-2 py-1 text-[10px] transition-colors"
              style={{
                background: filterCategory === cat ? 'var(--n200)' : undefined,
                color: filterCategory === cat ? 'var(--n700)' : 'var(--n400)',
              }}
            >
              {SHORTCUT_CATEGORIES[cat].icon} {SHORTCUT_CATEGORIES[cat].label}
            </button>
          ))}
        </div>

        {/* Shortcut list */}
        <div className="max-h-[400px] overflow-auto px-5 py-3">
          {categoryKeys.map((cat) => {
            const catShortcuts = grouped[cat]
            if (!catShortcuts || catShortcuts.length === 0) return null
            return (
              <div key={cat} className="mb-4 last:mb-0">
                <h4
                  className="mb-2 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--n400)' }}
                >
                  {SHORTCUT_CATEGORIES[cat].icon} {SHORTCUT_CATEGORIES[cat].label}
                </h4>
                <div className="space-y-1">
                  {catShortcuts.map((sc) => (
                    <div
                      key={sc.id}
                      className="flex items-center justify-between rounded-md px-2 py-1.5"
                      style={{ opacity: sc.enabled ? 1 : 0.4 }}
                    >
                      <div>
                        <p className="text-xs font-medium" style={{ color: 'var(--n700)' }}>
                          {sc.label}
                        </p>
                        <p className="text-[10px]" style={{ color: 'var(--n400)' }}>
                          {sc.description}
                        </p>
                      </div>
                      <KeyComboDisplay keys={sc.keys} />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-2 text-center" style={{ borderTop: '1px solid var(--n100)' }}>
          <p className="text-[9px]" style={{ color: 'var(--n400)' }}>
            Press <KeyComboDisplay keys="Mod+/" inline /> to toggle this panel
          </p>
        </div>
      </div>
    </>
  )
}

/** Renders a formatted key combination badge */
function KeyComboDisplay({ keys, inline }: { keys: string; inline?: boolean }) {
  const formatted = formatKeyCombo(keys)
  const parts = formatted.split('+')

  if (inline) {
    return (
      <span className="inline-flex items-center gap-0.5">
        {parts.map((part, i) => (
          <kbd
            key={i}
            className="rounded px-1 py-0.5 font-mono text-[9px]"
            style={{
              background: 'var(--n100)',
              border: '1px solid var(--n200)',
              color: 'var(--n600)',
            }}
          >
            {part}
          </kbd>
        ))}
      </span>
    )
  }

  return (
    <div className="flex items-center gap-0.5">
      {parts.map((part, i) => (
        <kbd
          key={i}
          className="min-w-[20px] rounded px-1.5 py-0.5 text-center font-mono text-[10px]"
          style={{
            background: 'var(--n100)',
            border: '1px solid var(--n200)',
            color: 'var(--n600)',
          }}
        >
          {part}
        </kbd>
      ))}
    </div>
  )
}
