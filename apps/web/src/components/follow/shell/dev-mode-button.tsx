'use client'

import { useState, useEffect, useRef } from 'react'
import { useDevModeStore } from '@/stores/dev-mode-store'

interface DevModeButtonProps {
  position: 'collapsed' | 'expanded' | 'dot'
}

export function DevModeButton({ position }: DevModeButtonProps) {
  const { devMode, toggleDevMode } = useDevModeStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Cmd+Shift+D keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        toggleDevMode()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleDevMode])

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const positionClass =
    position === 'dot'
      ? 'fixed bottom-4 right-14 z-50'
      : position === 'expanded'
        ? 'fixed bottom-4 right-4 z-50'
        : 'fixed bottom-4 right-4 z-50'

  return (
    <div ref={ref} className={positionClass}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-600 opacity-30 transition-opacity hover:opacity-80"
        title="Advanced Mode (Cmd+Shift+D)"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-8 right-0 w-56 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl shadow-black/40">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={devMode}
              onChange={toggleDevMode}
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-500/30"
            />
            <span className="text-xs font-medium text-zinc-200">Enable Advanced Mode</span>
          </label>

          <div className="mt-2 border-t border-zinc-800 pt-2">
            <p className="text-[10px] text-zinc-500">
              Shows full workspace with sidebar, canvas, threads, and all advanced tools.
            </p>
          </div>

          <div className="mt-1.5 text-[10px] text-zinc-600">
            <kbd className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-500">
              {'\u2318'}+Shift+D
            </kbd>
          </div>
        </div>
      )}
    </div>
  )
}
