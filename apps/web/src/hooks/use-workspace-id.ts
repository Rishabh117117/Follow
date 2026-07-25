'use client'

import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { DEV_WORKSPACE } from '@workspace/shared/constants'

const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Returns the resolved workspace UUID.
 * If the URL param is not a valid UUID (e.g. "default"), resolves it to
 * DEV_WORKSPACE.id in dev mode.
 */
export function useWorkspaceId(): string {
  const params = useParams<{ id: string }>()

  return useMemo(() => {
    if (UUID_RE.test(params.id)) return params.id
    if (DEV_BYPASS_AUTH) return DEV_WORKSPACE.id
    return params.id
  }, [params.id])
}
