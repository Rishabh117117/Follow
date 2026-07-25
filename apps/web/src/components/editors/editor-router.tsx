'use client'

import { NotesEditor } from './notes'

interface EditorRouterProps {
  fileId: string
  workspaceId: string
  fileName: string
  mimeType: string | null
  metadata: Record<string, unknown>
  onRename: (name: string) => void
}

/**
 * Detect whether a file opens in the notes editor (markdown / plain text).
 * All other in-browser editors were removed with their parked surfaces.
 */
function isNoteFile(
  fileName: string,
  mimeType: string | null,
  metadata: Record<string, unknown>
): boolean {
  if ((metadata?.editorType as string | undefined) === 'note') return true
  if (mimeType === 'text/markdown' || mimeType === 'text/plain') return true
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext === 'md' || ext === 'txt' || ext === 'note'
}

export function EditorRouter({
  fileId,
  workspaceId,
  fileName,
  mimeType,
  metadata,
  onRename,
}: EditorRouterProps) {
  if (isNoteFile(fileName, mimeType, metadata)) {
    return (
      <NotesEditor
        fileId={fileId}
        workspaceId={workspaceId}
        fileName={fileName}
        onRename={onRename}
      />
    )
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <p className="text-lg text-zinc-400">Unsupported file type</p>
        <p className="mt-2 text-sm text-zinc-600">
          This file cannot be edited in the browser.
          {mimeType && ` (${mimeType})`}
        </p>
      </div>
    </div>
  )
}
