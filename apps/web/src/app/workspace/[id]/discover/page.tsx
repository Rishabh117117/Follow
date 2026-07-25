'use client'

import { useParams } from 'next/navigation'
import { IndexDiscoverView } from '@/components/follow/discover/index-discover-view'

export default function DiscoverPage() {
  const params = useParams<{ id: string }>()
  const id = String(params?.id ?? '')
  return <IndexDiscoverView workspaceId={id} />
}
