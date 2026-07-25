'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api-client'
import { useNotebookStore } from '@/stores/notebook-store'

interface FileItem {
  id: string
  name: string
  mimeType: string | null
  metadata: Record<string, unknown> | null
  updatedAt?: string
}

function isNotebookFile(f: FileItem): boolean {
  const editorType = (f.metadata as Record<string, unknown> | null)?.editorType
  return editorType === 'notebook' || f.mimeType === 'application/vnd.workspace.notebook'
}

function formatLastEdit(updatedAt?: string): string {
  if (!updatedAt) return 'Recently'
  const diffMs = Date.now() - new Date(updatedAt).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return 'Recently'
}

/**
 * WEB-TSC-CUT-DEBT-COMBINED-1 (2026-04-23): rewritten to fetch the
 * notebook list via the files API. Same rationale as the sibling
 * notebook-picker.tsx rewrite — the store's plural `notebooks`
 * map was removed during the strip-arc refactor. Page-count display
 * was originally derived from eagerly-loaded store state that no
 * longer exists; the files API returns file metadata without page
 * arrays, so the pages count defaults to 0 for listed notebooks
 * (matching the practical behavior of the previous version, which
 * showed 0 pages for any notebook whose detail had not yet been
 * loaded into the store).
 */
export function NotebooksGrid() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const workspaceId = params?.id

  // Active notebook id (if any) lets future UX highlight the current card.
  const activeNotebookId = useNotebookStore((s) => s.notebook?.id ?? null)

  const { data: filesData } = useQuery({
    queryKey: ['notebooks-grid', 'files', workspaceId],
    queryFn: () => api.get<FileItem[]>(`/api/files?workspaceId=${workspaceId}`),
    enabled: !!workspaceId,
  })

  const notebookList = (filesData?.data ?? []).filter(isNotebookFile).map((f) => ({
    id: f.id,
    title: f.name || 'Untitled',
    pages: 0,
    lastEdit: formatLastEdit(f.updatedAt),
  }))

  return (
    <div className="flex-1 overflow-auto p-8" data-testid="notebooks-grid">
      <div className="mx-auto max-w-[800px]">
        <h2 className="mb-6 text-[16px] font-semibold" style={{ color: 'var(--n800, #262626)' }}>
          Notebooks
        </h2>

        <div className="grid grid-cols-3 gap-4">
          {notebookList.map((nb) => (
            <button
              key={nb.id}
              onClick={() => router.push(`/workspace/${params.id}/notebook/${nb.id}`)}
              className="rounded-lg border p-4 text-left transition-colors hover:bg-neutral-50"
              style={{ borderColor: 'var(--n150, #e5e5e5)' }}
              data-testid={`notebook-card-${nb.id}`}
              data-current={nb.id === activeNotebookId ? 'true' : undefined}
            >
              <div
                className="mb-1 truncate text-[13px] font-medium"
                style={{ color: 'var(--n700, #404040)' }}
              >
                {nb.title}
              </div>
              <div
                className="flex items-center gap-2 text-[10px]"
                style={{ color: 'var(--n400, #a3a3a3)' }}
              >
                <span className="font-mono">{nb.pages} pages</span>
                <span>·</span>
                <span>{nb.lastEdit}</span>
              </div>
            </button>
          ))}

          {/* New Notebook card */}
          <button
            className="flex items-center justify-center rounded-lg border-2 border-dashed p-4 transition-colors hover:bg-neutral-50"
            style={{ borderColor: 'var(--n200, #e5e5e5)', minHeight: 80 }}
            data-testid="new-notebook-btn"
          >
            <span className="text-2xl" style={{ color: 'var(--n300, #d4d4d4)' }}>
              +
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
