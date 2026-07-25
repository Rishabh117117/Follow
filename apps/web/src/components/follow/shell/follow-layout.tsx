'use client'

import { useEffect } from 'react'
import { useDevModeStore } from '@/stores/dev-mode-store'
import { useSharingStore } from '@/stores/sharing-store'
import { OfflineBanner } from '@/components/follow/notifications/offline-banner'

interface FollowLayoutProps {
  workspaceId: string
  children: React.ReactNode
}

/**
 * Conditional layout wrapper:
 *  - Dev Mode OFF (Follow): White background, no sidebar, no top navbar.
 *  - Dev Mode ON:  Dark theme — sidebar + conditional TopNavbar + <main>.
 *
 * Capture & Ask overlay and live recording stay in the parent layout.tsx
 * (they work in both modes).
 */
export function FollowLayout({ children }: FollowLayoutProps) {
  const { devMode } = useDevModeStore()
  // Sprint FE-5: hydrate sharing store on layout mount so the lock pill,
  // request inbox, and preset selector all show real values immediately.
  const refreshLockState = useSharingStore((s) => s.refreshLockState)
  const refreshPendingRequests = useSharingStore((s) => s.refreshPendingRequests)

  // Toggle dark class on <html> based on devMode
  useEffect(() => {
    const html = document.documentElement
    if (devMode) {
      html.classList.add('dark')
    } else {
      html.classList.remove('dark')
    }
    return () => {
      html.classList.add('dark')
    }
  }, [devMode])

  // Sprint FE-5: initial sharing-state hydration
  useEffect(() => {
    void refreshLockState()
    void refreshPendingRequests()
  }, [refreshLockState, refreshPendingRequests])

  const skipLink = (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[200] focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-black focus:shadow focus:outline focus:outline-2 focus:outline-indigo-500"
    >
      Skip to content
    </a>
  )

  if (!devMode) {
    // Follow mode: clean document-first layout, white background
    return (
      <>
        {skipLink}
        <OfflineBanner />
        <main id="main-content" className="flex-1 overflow-auto bg-white">
          {children}
        </main>
      </>
    )
  }

  // Dev mode: dark theme, plain shell. The old workspace chrome (sidebar,
  // top navbar) was removed together with the parked surfaces it navigated.
  return (
    <>
      {skipLink}
      <OfflineBanner />
      <main id="main-content" className="flex-1 overflow-auto">
        {children}
      </main>
    </>
  )
}
