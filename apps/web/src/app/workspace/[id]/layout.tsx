'use client'

import { useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { CommandPaletteProvider } from '@/components/command-palette-provider'
import { ErrorBoundary } from '@/components/error-boundary'
import { FollowLayout } from '@/components/follow/shell/follow-layout'
import { useSignalCapture } from '@/hooks/use-signal-capture'
import { useSessionTracking } from '@/hooks/use-session-tracking'
import { DEV_WORKSPACE } from '@workspace/shared/constants'

const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true'

// UUID v4 regex — if the param doesn't match, resolve it
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface WorkspaceLayoutProps {
  children: React.ReactNode
  params: { id: string }
}

export default function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  const router = useRouter()

  // Resolve non-UUID workspace IDs (e.g. "default") to the real workspace UUID
  const workspaceId = useMemo(() => {
    if (UUID_RE.test(params.id)) return params.id
    // In dev mode, resolve any non-UUID (like "default") to the DEV_WORKSPACE
    if (DEV_BYPASS_AUTH) return DEV_WORKSPACE.id
    return params.id // fallback — let API return errors
  }, [params.id])

  // If the URL doesn't match the resolved ID, redirect to the correct URL
  useEffect(() => {
    if (workspaceId !== params.id) {
      const currentPath = window.location.pathname
      const newPath = currentPath.replace(`/workspace/${params.id}`, `/workspace/${workspaceId}`)
      router.replace(newPath)
    }
  }, [workspaceId, params.id, router])

  // Signal capture: always-on activity signals → ClickHouse → thread distillation → provenance
  useSignalCapture({ workspaceId })

  // Session tracking — opens a row in `sessions` for this tab; heartbeats every
  // 60s; closes via sendBeacon on unload. Drives Archivist + Profiler scheduling.
  useSessionTracking({ workspaceId })

  return (
    <ErrorBoundary>
      <CommandPaletteProvider>
        <div className="flex h-screen overflow-hidden bg-zinc-950">
          <FollowLayout workspaceId={workspaceId}>{children}</FollowLayout>
        </div>
      </CommandPaletteProvider>
    </ErrorBoundary>
  )
}
