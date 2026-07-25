'use client'

import {
  useKeyboardShortcutsStore,
  type ShortcutCategory,
  type KeyboardShortcut,
} from '@/stores/keyboard-shortcuts-store'

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  navigation: 'Navigation',
  editing: 'Editing',
  ai: 'AI',
  panels: 'Panels',
  view: 'View',
  notebook: 'Notebook',
}

const CATEGORY_ORDER: ShortcutCategory[] = [
  'navigation',
  'editing',
  'ai',
  'panels',
  'view',
  'notebook',
]

export default function ShortcutsPage() {
  const shortcuts = useKeyboardShortcutsStore((s) => s.shortcuts)
  const reset = useKeyboardShortcutsStore((s) => s.reset)

  const grouped: Record<ShortcutCategory, KeyboardShortcut[]> = {
    navigation: [],
    editing: [],
    ai: [],
    panels: [],
    view: [],
    notebook: [],
  }
  for (const sc of shortcuts) {
    grouped[sc.category].push(sc)
  }

  return (
    <div className="space-y-10">
      <header>
        <h1
          className="text-[28px] leading-tight"
          style={{
            fontFamily: 'Newsreader, Georgia, serif',
            color: 'var(--n950)',
            fontWeight: 500,
          }}
        >
          Keyboard Shortcuts
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--n500)' }}>
          Speed up common actions with keyboard shortcuts.
        </p>
      </header>

      <div className="flex items-center justify-between">
        <p className="text-[11px] italic" style={{ color: 'var(--n400)' }}>
          Custom shortcuts coming soon
        </p>
        <button
          onClick={reset}
          className="rounded-md border bg-white px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-gray-50"
          style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
        >
          Reset to defaults
        </button>
      </div>

      {CATEGORY_ORDER.map((cat) => {
        if (grouped[cat].length === 0) return null
        return (
          <section key={cat}>
            <h2
              className="mb-3 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--n500)' }}
            >
              {CATEGORY_LABELS[cat]}
            </h2>
            <div
              className="rounded-lg border bg-white"
              style={{ borderColor: 'var(--n200)' }}
            >
              {grouped[cat].map((sc, idx) => (
                <div
                  key={sc.id}
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderTop: idx > 0 ? '1px solid var(--n150)' : undefined }}
                >
                  <div className="flex-1">
                    <div className="text-[13px]" style={{ color: 'var(--n950)' }}>
                      {sc.label}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--n500)' }}>
                      {sc.description}
                    </div>
                  </div>
                  <kbd
                    className="rounded border px-2 py-1 font-mono text-[11px]"
                    style={{
                      borderColor: 'var(--n200)',
                      backgroundColor: 'var(--n50)',
                      color: 'var(--n700)',
                    }}
                  >
                    {sc.keys.replace('Mod', '⌘')}
                  </kbd>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
