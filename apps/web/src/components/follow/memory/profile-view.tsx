'use client'

/**
 * ProfileView — DEPRECATED in V41-CONFIG-1.
 *
 * This component was a near-duplicate of the `/settings/profile` page body.
 * Profile management lives at `/settings/profile` (the dev ConfigHub it
 * briefly redirected to was removed with the parked-surface strip). This
 * file is retained as a thin redirect shim so the Follow sidebar "Profile"
 * switcher still works.
 *
 * Kept in the tree because `follow-main.tsx` still imports this symbol;
 * when that consumer is reworked, this file can be deleted.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function ProfileView() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/settings/profile')
  }, [router])

  return (
    <div
      className="flex min-h-[200px] items-center justify-center p-4 text-sm"
      style={{ color: 'var(--n500, #737373)' }}
      data-testid="profile-view-redirect"
    >
      Redirecting to Settings…
    </div>
  )
}
