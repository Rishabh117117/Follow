'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { DEV_WORKSPACE } from '@workspace/shared/constants'

const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true'

interface Workspace {
  id: string
  name: string
  slug: string
  role?: string
}

export default function WorkspaceIndexPage() {
  const router = useRouter()
  const { data: session, status: sessionStatus, update } = useSession()
  const [entering, setEntering] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api.get<Workspace[]>('/api/workspaces'),
    enabled: !DEV_BYPASS_AUTH && sessionStatus === 'authenticated',
    retry: 2,
  })

  const workspaces = data?.data
  const showPicker = !DEV_BYPASS_AUTH && !!workspaces && workspaces.length > 1

  // Switch active workspace: keep the NextAuth JWT default in sync (mint route +
  // non-URL contexts read it), then navigate — the api-client scopes requests
  // by the /workspace/<id> URL.
  async function enter(id: string) {
    setEntering(id)
    try {
      await update?.({ activeWorkspaceId: id })
    } catch {
      // Non-fatal — the URL still scopes the session.
    }
    router.push(`/workspace/${id}`)
  }

  useEffect(() => {
    // Dev mode: go straight to dev workspace
    if (DEV_BYPASS_AUTH) {
      router.replace(`/workspace/${DEV_WORKSPACE.id}`)
      return
    }

    // Wait for NextAuth to hydrate. Previously this page fired /api/workspaces
    // before getSession() resolved, which meant the request went out with
    // DEV_USER fallback headers and returned [] → onboarding redirect, even
    // though the real user has a workspace.
    if (sessionStatus === 'loading') return
    if (isLoading) return

    // If the API call failed AND NextAuth has an activeWorkspaceId on the
    // session, route there directly instead of dumping the user on
    // onboarding. An API error is not the same as "zero workspaces".
    if (error || (data && data.error)) {
      const fallbackId = session?.user?.activeWorkspaceId
      if (fallbackId) {
        router.replace(`/workspace/${fallbackId}`)
      }
      return
    }

    if (!workspaces) return

    // Exactly one workspace → straight in (unchanged single-workspace UX).
    if (workspaces.length === 1) {
      router.replace(`/workspace/${workspaces[0]!.id}`)
      return
    }

    // Two or more → let the picker below render (no redirect).

    // Truly no workspaces — only now is onboarding the right answer.
    if (workspaces.length === 0) {
      router.replace('/onboarding')
    }
  }, [data, isLoading, error, router, session, sessionStatus, workspaces])

  if (showPicker) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
        <div className="w-full max-w-md">
          <h1 className="text-lg font-medium text-zinc-100">Choose a workspace</h1>
          <p className="mt-1 text-sm text-zinc-500">
            You belong to {workspaces!.length} workspaces.
          </p>

          <ul className="mt-6 flex flex-col gap-2">
            {workspaces!.map((ws) => (
              <li key={ws.id}>
                <button
                  onClick={() => enter(ws.id)}
                  disabled={entering !== null}
                  className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-60"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-violet-600/20 text-sm font-semibold text-violet-300">
                      {ws.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex flex-col">
                      <span className="text-sm text-zinc-100">{ws.name}</span>
                      {ws.role && (
                        <span className="text-xs capitalize text-zinc-500">{ws.role}</span>
                      )}
                    </span>
                  </span>
                  {entering === ws.id ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-violet-500" />
                  ) : (
                    <svg
                      className="h-4 w-4 text-zinc-600"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  )}
                </button>
              </li>
            ))}
          </ul>

          <button
            onClick={() => router.push('/onboarding')}
            className="mt-4 text-sm text-violet-400 transition-colors hover:text-violet-300"
          >
            + New workspace
          </button>
        </div>
      </div>
    )
  }

  const errMsg =
    (error as Error | undefined)?.message ??
    (data?.error as { message?: string } | undefined)?.message

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-600" />
        <p className="mt-4 text-sm text-zinc-400">
          {errMsg ? `Loading workspace — ${errMsg}` : 'Loading your workspace...'}
        </p>
        {errMsg && (
          <p className="mt-2 text-xs text-zinc-500">
            Retrying automatically. If this persists, the API may be down — check the dev console.
          </p>
        )}
      </div>
    </div>
  )
}
