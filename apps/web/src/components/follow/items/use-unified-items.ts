'use client'

/**
 * useUnifiedItems — single source of truth for the cross-source item feed.
 *
 * Extracted from items-view.tsx so the same merged list (conversations + files
 * + raw uploads + facts) can be consumed by the Dashboard items section and
 * the global PreviewPane without duplicating the four react-query calls.
 */

import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, authFetch } from '@/lib/api-client'
import { type UnifiedItem, formatTime, normalizeGroupTitle } from './_shared'

interface ApiResponse<T> {
  data: T | null
  error: { message: string } | null
}

export interface UseUnifiedItemsResult {
  items: UnifiedItem[]
  isLoading: boolean
  invalidate: () => void
}

export function useUnifiedItems(workspaceId: string): UseUnifiedItemsResult {
  const queryClient = useQueryClient()

  // Auto-refresh on the same custom event items-view listens to. Mounting this
  // hook in two places (Dashboard items section + ItemsView) is fine — the
  // listener cleans up per-instance and queryClient is shared.
  useEffect(() => {
    const onChanged = () => {
      queryClient.invalidateQueries({ queryKey: ['items-conversations', workspaceId] })
      queryClient.invalidateQueries({ queryKey: ['items-files', workspaceId] })
      queryClient.invalidateQueries({ queryKey: ['items-rawfiles', workspaceId] })
      queryClient.invalidateQueries({ queryKey: ['items-facts', workspaceId] })
    }
    window.addEventListener('follow:items-changed', onChanged)
    return () => window.removeEventListener('follow:items-changed', onChanged)
  }, [queryClient, workspaceId])

  const { data: convosRes, isPending: convosPending } = useQuery({
    queryKey: ['items-conversations', workspaceId],
    queryFn: () =>
      api.get<Array<Record<string, unknown>>>(`/api/chat/conversations?workspaceId=${workspaceId}`),
    enabled: !!workspaceId,
    staleTime: 30_000,
    retry: false,
  })

  const { data: filesRes, isPending: filesPending } = useQuery({
    queryKey: ['items-files', workspaceId],
    queryFn: () => api.get<Array<Record<string, unknown>>>(`/api/files?workspaceId=${workspaceId}`),
    enabled: !!workspaceId,
    staleTime: 30_000,
    retry: false,
  })

  const { data: factsRes, isPending: factsPending } = useQuery({
    queryKey: ['items-facts', workspaceId],
    queryFn: async () => {
      const res = await authFetch('/api/index/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, limit: 50 }),
      })
      if (!res.ok) return { data: null } as ApiResponse<Array<Record<string, unknown>>>
      const body = (await res.json()) as { results?: Array<Record<string, unknown>> }
      return { data: body.results ?? [] } as ApiResponse<Array<Record<string, unknown>>>
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
    retry: false,
  })

  const { data: rawFilesRes } = useQuery({
    queryKey: ['items-rawfiles', workspaceId],
    queryFn: async () => {
      const res = await authFetch('/api/raw-files?limit=100', {})
      if (!res.ok) return { data: null } as ApiResponse<Array<Record<string, unknown>>>
      const body = (await res.json()) as { data?: Array<Record<string, unknown>> }
      return { data: body.data ?? [] } as ApiResponse<Array<Record<string, unknown>>>
    },
    enabled: !!workspaceId,
    staleTime: 10_000,
  })

  const items = useMemo<UnifiedItem[]>(() => {
    type ConvRow = {
      id: string
      title: string
      source: string
      createdAt: string
      updatedAt: string
      raw: Record<string, unknown>
    }
    const rawConvos: ConvRow[] = ((convosRes?.data as Array<Record<string, unknown>>) ?? []).map(
      (c) => ({
        id: String(c['id']),
        title: String(c['title'] ?? 'Untitled'),
        source: String(c['chatSourceType'] ?? 'follow-web'),
        createdAt: (c['createdAt'] as string) ?? '',
        updatedAt: (c['updatedAt'] as string) ?? (c['createdAt'] as string) ?? '',
        raw: c,
      })
    )

    const groups = new Map<string, ConvRow[]>()
    for (const c of rawConvos) {
      const key = `${normalizeGroupTitle(c.title)}|${c.source}`
      const arr = groups.get(key) ?? []
      arr.push(c)
      groups.set(key, arr)
    }

    const convos: UnifiedItem[] = []
    for (const members of groups.values()) {
      members.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
      const newest = members[members.length - 1]!
      const memberIds = members.map((m) => m.id)
      const displayTitle =
        members.length > 1 ? newest.title.replace(/\s*\(v\d+\)\s*$/i, '').trim() : newest.title
      convos.push({
        id: newest.id,
        it: 'conv' as const,
        title: displayTitle,
        source: newest.source,
        time: formatTime(newest.updatedAt),
        preview: (newest.raw['lastMessage'] as Record<string, unknown> | undefined)?.['content'] as
          | string
          | undefined,
        raw:
          members.length > 1
            ? {
                ...newest.raw,
                _groupMemberIds: memberIds,
                _groupCount: members.length,
                _groupMembers: members.map((m) => ({
                  id: m.id,
                  title: m.title,
                  createdAt: m.createdAt,
                  updatedAt: m.updatedAt,
                })),
              }
            : newest.raw,
      })
    }
    convos.sort((a, b) => {
      const at = (a.raw['updatedAt'] as string) ?? (a.raw['createdAt'] as string) ?? ''
      const bt = (b.raw['updatedAt'] as string) ?? (b.raw['createdAt'] as string) ?? ''
      return bt.localeCompare(at)
    })
    const files = ((filesRes?.data as Array<Record<string, unknown>>) ?? []).map((f) => ({
      id: String(f['id']),
      it: 'file' as const,
      title: String(f['name'] ?? 'Untitled file'),
      source: String(
        ((f['metadata'] as Record<string, unknown> | undefined)?.['source'] as string) ?? 'local'
      ),
      time: formatTime((f['updatedAt'] as string) ?? (f['createdAt'] as string)),
      preview: (f['extractedText'] as string | undefined) ?? undefined,
      raw: f,
    }))
    const rawFiles = ((rawFilesRes?.data as Array<Record<string, unknown>>) ?? []).map((f) => ({
      id: String(f['id']),
      it: 'file' as const,
      title: String(f['fileName'] ?? 'Untitled upload'),
      source: String(f['sourceType'] ?? 'upload'),
      time: formatTime((f['updatedAt'] as string) ?? (f['createdAt'] as string)),
      preview: (f['extractedText'] as string | undefined)?.slice(0, 400) ?? undefined,
      raw: { ...f, _kind: 'rawfile' },
    }))
    const facts = ((factsRes?.data as Array<Record<string, unknown>>) ?? []).map((r) => {
      const recordType = String(r['threadType'] ?? 'fact')
      const text = String(r['embeddingText'] ?? r['sectionAlias'] ?? 'Indexed record')
      return {
        id: String(r['id']),
        it: 'fact' as const,
        title: text.slice(0, 120),
        source: recordType === 'ai' ? 'claude' : recordType === 'doc' ? 'local' : 'follow-web',
        time: formatTime(r['eventTime'] as string),
        confidence:
          typeof r['engagementDepth'] === 'number' ? (r['engagementDepth'] as number) : 0.9,
        raw: r,
      }
    })
    return [...convos, ...files, ...rawFiles, ...facts]
  }, [convosRes, filesRes, rawFilesRes, factsRes])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['items-conversations', workspaceId] })
    queryClient.invalidateQueries({ queryKey: ['items-files', workspaceId] })
    queryClient.invalidateQueries({ queryKey: ['items-rawfiles', workspaceId] })
    queryClient.invalidateQueries({ queryKey: ['items-facts', workspaceId] })
  }

  return {
    items,
    isLoading: convosPending || filesPending || factsPending,
    invalidate,
  }
}
