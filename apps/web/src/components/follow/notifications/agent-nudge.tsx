'use client'

/**
 * AgentNudge (STABILIZE-2)
 *
 * Bottom-right floating banner that appears when the signed-in user has
 * no Desktop Agent key yet. Clicking "Connect" deep-links to
 * /settings/agents. Dismissal persists in localStorage for the current
 * user id so it doesn't pester on every page load.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { api } from '@/lib/api-client'

interface StatusResponse {
  connected: boolean
  keyPrefix?: string
}

export function AgentNudge() {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const [dismissed, setDismissed] = useState(true) // start hidden until we know

  useEffect(() => {
    if (!userId) return
    const key = `follow.agent-nudge.dismissed.${userId}`
    setDismissed(localStorage.getItem(key) === '1')
  }, [userId])

  const status = useQuery({
    queryKey: ['agent', 'status', userId],
    queryFn: () => api.get<StatusResponse>('/api/agents/status'),
    enabled: !!userId && !dismissed,
    refetchInterval: 30_000,
    retry: false,
  })

  const connected = status.data?.data?.connected
  const shouldShow = !!userId && !dismissed && status.data && !connected

  if (!shouldShow) return null

  const dismiss = () => {
    if (userId) localStorage.setItem(`follow.agent-nudge.dismissed.${userId}`, '1')
    setDismissed(true)
  }

  return (
    <div
      className="fixed bottom-6 right-6 z-50 w-[340px] rounded-lg border border-[rgba(0,0,0,0.08)] bg-white p-4 shadow-lg"
      style={{ fontFamily: 'Inter, sans-serif' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-medium text-[var(--n950,#111)]">
          Connect your Desktop Agent
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 rounded p-1 text-[var(--n400,#999)] hover:bg-[var(--n50,#f5f5f5)]"
        >
          ×
        </button>
      </div>
      <div className="mt-1 text-[12px] leading-snug text-[var(--n600,#666)]">
        Watch folders on this machine so Follow can index your files. Takes about 10 seconds.
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Link
          href="/settings/agents"
          className="rounded-md bg-[var(--accent,#6c63ff)] px-3 py-1.5 text-[12px] font-medium text-white"
        >
          Set up
        </Link>
        <button onClick={dismiss} className="text-[12px] text-[var(--n500,#888)] hover:underline">
          Not now
        </button>
      </div>
    </div>
  )
}
