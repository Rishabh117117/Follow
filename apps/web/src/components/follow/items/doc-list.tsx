'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { HomeSidebar, type DocFilter } from '@/components/follow/shell/home-sidebar'
import { DocumentCard } from './document-card'
import { useStarredFilesStore } from '@/stores/starred-files-store'

interface FileItem {
  id: string
  name: string
  mimeType: string | null
  type: string
  updatedAt: string
  createdBy?: string | null
  metadata: Record<string, unknown>
}

interface DocListProps {
  workspaceId: string
}

const DOCUMENT_MIME_TYPES = [
  'text/html',
  'application/vnd.workspace.document',
  'application/vnd.workspace.note',
  'text/plain',
  'text/markdown',
]

/** How many days counts as "recent" */
const RECENT_DAYS = 7

function isDocumentFile(file: FileItem): boolean {
  const editorType = file.metadata?.editorType as string | undefined
  if (editorType === 'document' || editorType === 'note') return true
  if (file.mimeType && DOCUMENT_MIME_TYPES.some((m) => file.mimeType?.includes(m))) return true
  if (
    file.mimeType?.includes('canvas') ||
    file.mimeType?.includes('spreadsheet') ||
    file.mimeType?.includes('presentation')
  )
    return false
  return file.type === 'file'
}

function getEditorType(file: FileItem): string {
  return (file.metadata?.editorType as string) ?? 'document'
}

export function DocList({ workspaceId }: DocListProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [activeFilter, setActiveFilter] = useState<DocFilter>('all')
  const { starredIds, toggleStar, isStarred } = useStarredFilesStore()

  const { data: filesData, isLoading } = useQuery({
    queryKey: ['doc-list', workspaceId],
    queryFn: () => api.get<FileItem[]>(`/api/files?workspaceId=${workspaceId}`),
    enabled: !!workspaceId,
  })

  const createDocMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<FileItem>('/api/files', {
        workspaceId,
        name: 'Untitled Document',
        type: 'file',
        mimeType: 'text/html',
        metadata: { editorType: 'document' },
      })
      if (res.error) throw new Error(res.error.message)
      return res.data!
    },
    onSuccess: (file) => {
      queryClient.invalidateQueries({ queryKey: ['doc-list', workspaceId] })
      router.push(`/workspace/${workspaceId}/editor/${file.id}`)
    },
  })

  const allFiles = filesData?.data ?? []
  const documents = useMemo(
    () =>
      allFiles
        .filter(isDocumentFile)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [allFiles]
  )

  // Compute filtered list based on active filter
  const filteredDocs = useMemo(() => {
    switch (activeFilter) {
      case 'recent': {
        const cutoff = Date.now() - RECENT_DAYS * 86400000
        return documents.filter((d) => new Date(d.updatedAt).getTime() > cutoff)
      }
      case 'shared':
        // Show files with sharedWith metadata or files not created by current user
        return documents.filter(
          (d) =>
            (d.metadata?.sharedWith as unknown[])?.length > 0 ||
            (d.metadata?.isShared as boolean) === true
        )
      case 'starred':
        return documents.filter((d) => isStarred(d.id))
      case 'all':
      default:
        return documents
    }
  }, [activeFilter, documents, starredIds])

  // Counts for sidebar badges
  const counts = useMemo(() => {
    const cutoff = Date.now() - RECENT_DAYS * 86400000
    return {
      all: documents.length,
      recent: documents.filter((d) => new Date(d.updatedAt).getTime() > cutoff).length,
      shared: documents.filter(
        (d) =>
          (d.metadata?.sharedWith as unknown[])?.length > 0 ||
          (d.metadata?.isShared as boolean) === true
      ).length,
      starred: documents.filter((d) => isStarred(d.id)).length,
    }
  }, [documents, starredIds])

  return (
    <div className="flex h-full" data-testid="doc-list-home">
      {/* Left sidebar */}
      <HomeSidebar activeFilter={activeFilter} onFilterChange={setActiveFilter} counts={counts} />

      {/* Main content */}
      <div className="flex-1 overflow-auto bg-white px-8 py-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-semibold" style={{ color: 'var(--n900)' }}>
            {activeFilter === 'all' && 'All Documents'}
            {activeFilter === 'recent' && 'Recent Documents'}
            {activeFilter === 'shared' && 'Shared with Me'}
            {activeFilter === 'starred' && 'Starred'}
          </h1>
          <button
            onClick={() => createDocMutation.mutate()}
            disabled={createDocMutation.isPending}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ background: 'var(--n900)' }}
          >
            {createDocMutation.isPending ? 'Creating...' : '+ New Document'}
          </button>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div
              className="h-6 w-6 animate-spin rounded-full border-2"
              style={{ borderColor: 'var(--n200)', borderTopColor: 'var(--ai)' }}
            />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && filteredDocs.length === 0 && (
          <div className="py-16 text-center">
            <div className="mb-2 text-3xl">
              {activeFilter === 'starred' ? '⭐' : activeFilter === 'shared' ? '👥' : '📄'}
            </div>
            <p className="text-sm" style={{ color: 'var(--n500)' }}>
              {activeFilter === 'all' && 'No documents yet.'}
              {activeFilter === 'recent' && 'No documents edited in the last 7 days.'}
              {activeFilter === 'shared' && 'No shared documents.'}
              {activeFilter === 'starred' && 'No starred documents.'}
            </p>
            {activeFilter === 'all' && (
              <button
                onClick={() => createDocMutation.mutate()}
                className="mt-3 text-sm font-medium"
                style={{ color: 'var(--ai)' }}
              >
                Create your first document
              </button>
            )}
          </div>
        )}

        {/* Document grid */}
        {!isLoading && filteredDocs.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredDocs.map((doc) => (
              <DocumentCard
                key={doc.id}
                id={doc.id}
                name={doc.name}
                editorType={getEditorType(doc)}
                updatedAt={doc.updatedAt}
                starred={isStarred(doc.id)}
                onClick={() => router.push(`/workspace/${workspaceId}/editor/${doc.id}`)}
                onToggleStar={(e) => {
                  e.stopPropagation()
                  toggleStar(doc.id)
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
