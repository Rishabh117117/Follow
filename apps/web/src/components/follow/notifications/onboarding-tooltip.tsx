'use client'

import { useEffect, useState } from 'react'

const ONBOARDING_FLAG = 'follow-onboarding-complete'

/**
 * First-run tooltip anchored near the floating unit.
 * Self-dismisses based on localStorage flag.
 */
export function OnboardingTooltip() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      const done = localStorage.getItem(ONBOARDING_FLAG)
      if (!done) {
        // Delay showing slightly so the editor renders first
        const t = setTimeout(() => setVisible(true), 800)
        return () => clearTimeout(t)
      }
    } catch {
      // ignore
    }
    return undefined
  }, [])

  const dismiss = () => {
    try {
      localStorage.setItem(ONBOARDING_FLAG, 'true')
    } catch {
      // ignore
    }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      className="fixed z-[60] w-[240px] rounded-xl border bg-white p-4 shadow-lg"
      style={{
        right: 96,
        bottom: 88,
        borderColor: 'var(--n200)',
      }}
      role="dialog"
      aria-label="Onboarding tip"
    >
      {/* Arrow pointing right toward the floating unit */}
      <div
        className="absolute h-3 w-3 rotate-45 border-b border-r bg-white"
        style={{
          right: -7,
          bottom: 24,
          borderColor: 'var(--n200)',
        }}
        aria-hidden
      />

      <p
        className="mb-3 text-[13px] leading-snug"
        style={{ color: 'var(--n900)', fontWeight: 500 }}
      >
        Ask Follow anything about your document
      </p>
      <p className="mb-4 text-[11px] leading-snug" style={{ color: 'var(--n500)' }}>
        Select text, hit the Follow button, or start typing a question.
      </p>
      <button
        onClick={dismiss}
        className="rounded-md px-3 py-1.5 text-[11px] font-medium text-white transition-colors"
        style={{ backgroundColor: 'var(--n950)' }}
      >
        Got it
      </button>
    </div>
  )
}
