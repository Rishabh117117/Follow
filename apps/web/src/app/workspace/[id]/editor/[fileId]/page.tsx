'use client'

import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { EditorRouter } from '@/components/editors/editor-router'
import { useTrackEvent } from '@/hooks/use-track-event'

interface FileData {
  id: string
  workspaceId: string
  name: string
  type: string
  mimeType: string | null
  metadata: Record<string, unknown>
}

export default function EditorPage() {
  const params = useParams<{ id: string; fileId: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const track = useTrackEvent()

  const {
    data: fileData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['file', params.fileId],
    queryFn: () => api.get<FileData>(`/api/files/${params.fileId}`),
    enabled: !!params.fileId,
  })

  const renameMutation = useMutation({
    mutationFn: (newName: string) => api.patch(`/api/files/${params.fileId}`, { name: newName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file', params.fileId] })
      track({
        actionType: 'rename',
        objectType: 'file',
        objectId: params.fileId,
        payload: { event: 'file_renamed' },
      })
    },
  })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
          <span className="text-sm text-zinc-500">Loading editor...</span>
        </div>
      </div>
    )
  }

  if (error || !fileData?.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-zinc-400">File not found</p>
          <p className="mt-2 text-sm text-zinc-600">
            This file may have been deleted or you don&apos;t have access.
          </p>
          <button
            onClick={() => router.push(`/workspace/${params.id}`)}
            className="mt-4 rounded bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
          >
            Back to workspace
          </button>
        </div>
      </div>
    )
  }

  const file = fileData.data

  return (
    <div className="h-full">
      <EditorRouter
        fileId={file.id}
        workspaceId={params.id}
        fileName={file.name}
        mimeType={file.mimeType}
        metadata={file.metadata ?? {}}
        onRename={(name) => renameMutation.mutate(name)}
      />
    </div>
  )
}
