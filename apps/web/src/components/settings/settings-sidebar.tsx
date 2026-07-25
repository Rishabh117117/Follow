'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/general', label: 'General' },
  { href: '/settings/ai', label: 'AI & Memory' },
  { href: '/settings/notifications', label: 'Notifications' },
  { href: '/settings/shortcuts', label: 'Shortcuts' },
  { href: '/settings/connected', label: 'Connected Apps' },
  { href: '/settings/connectors', label: 'Connectors' },
  { href: '/settings/agents', label: 'Desktop Agent' },
  { href: '/settings/billing', label: 'Billing' },
]

export function SettingsSidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-[200px] flex-shrink-0 py-10 pl-8 pr-4">
      {/* Brand */}
      <div className="mb-6 flex items-center gap-2">
        <div
          className="flex h-5 w-5 items-center justify-center rounded-[3px]"
          style={{ backgroundColor: 'var(--n950)' }}
        >
          <span className="text-[11px] font-bold leading-none text-white">F</span>
        </div>
        <span
          className="text-[18px] leading-none"
          style={{
            fontFamily: 'Newsreader, Georgia, serif',
            color: 'var(--n950)',
            fontWeight: 500,
          }}
        >
          Follow
        </span>
      </div>

      {/* Back link */}
      <Link
        href="/"
        className="mb-8 flex items-center gap-1.5 text-[12px] transition-colors hover:underline"
        style={{ color: 'var(--n500)' }}
      >
        <svg
          className="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 19l-7-7 7-7" />
        </svg>
        Back to Follow
      </Link>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative py-1.5 pl-3 text-[13px] transition-colors"
              style={{
                color: active ? 'var(--n950)' : 'var(--n600)',
                fontWeight: active ? 600 : 400,
                borderLeft: active ? '2px solid var(--n950)' : '2px solid transparent',
              }}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
