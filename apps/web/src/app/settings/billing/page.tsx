'use client'

import { useState } from 'react'

const FEATURES = [
  'Unlimited documents',
  'AI features (chat, suggestions, memory)',
  'Collaboration and sharing',
  'Provenance tracking',
  'Google Workspace integration',
]

export default function BillingPage() {
  const [toast, setToast] = useState(false)

  const handleUpgrade = () => {
    setToast(true)
    setTimeout(() => setToast(false), 2500)
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
          Billing
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--n500)' }}>
          Your current plan and upgrade options.
        </p>
      </header>

      <section>
        <div
          className="rounded-xl border bg-white p-6"
          style={{ borderColor: 'var(--n200)' }}
        >
          <div
            className="mb-1 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--n500)' }}
          >
            Current Plan
          </div>
          <div
            className="mb-5 text-[24px] leading-tight"
            style={{
              fontFamily: 'Newsreader, Georgia, serif',
              color: 'var(--n950)',
              fontWeight: 500,
            }}
          >
            Follow Free
          </div>

          <ul className="mb-6 space-y-2">
            {FEATURES.map((f) => (
              <li
                key={f}
                className="flex items-center gap-2 text-[13px]"
                style={{ color: 'var(--n700)' }}
              >
                <svg
                  className="h-4 w-4 flex-shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: 'var(--ok, #22C55E)' }}
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {f}
              </li>
            ))}
          </ul>

          <button
            onClick={handleUpgrade}
            className="rounded-lg px-4 py-2.5 text-[13px] font-medium text-white transition-colors"
            style={{ backgroundColor: 'var(--n950)' }}
          >
            Upgrade to Pro
          </button>
        </div>
      </section>

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg px-4 py-2.5 text-[13px] text-white shadow-lg"
          style={{ backgroundColor: 'var(--n950)' }}
        >
          Coming soon — join the waitlist
        </div>
      )}
    </div>
  )
}
