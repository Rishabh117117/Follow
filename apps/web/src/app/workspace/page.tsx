'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { DEV_WORKSPACE } from '@workspace/shared/constants'

const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true'

interface Workspace {
  id: string
  name: string
  slug: string
}

export default function WorkspaceIndexPage() {
  const router = useRouter()
  const { data: session, status: sessionStatus } = useSession()
  const { data, isLoading, error } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api.get<Workspace[]>('/api/workspaces'),
    enabled: !DEV_BYPASS_AUTH && sessionStatus === 'authenticated',
    retry: 2,
  })

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
      // No fallback — stay on this screen so the user can see the error and
      // retry (useQuery will retry automatically). Don't redirect.
      return
    }

    const workspaces = data?.data
    if (workspaces && workspaces.length > 0) {
      router.replace(`/workspace/${workspaces[0]!.id}`)
      return
    }

    // Truly no workspaces — only now is onboarding the right answer.
    if (workspaces && workspaces.length === 0) {
      router.replace('/onboarding')
    }
  }, [data, isLoading, error, router, session, sessionStatus])

  const errMsg =
    (error as Error | undefined)?.message ?? (data?.error as { message?: string } | undefined)?.message

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
