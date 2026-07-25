/**
 * File Indexer
 *
 * Reads internal file content and delegates to the indexing agent.
 */

import { enqueueIndexJob, isAutoIndexEnabled, type IndexJob } from './index-queue'

/**
 * Queue an internal file for indexing.
 * Content must be provided since file content is stored in S3/Yjs.
 *
 * Returns the enqueued job, or null if the queue deduped against an
 * in-flight job with the same sourceId + type. Callers that don't care
 * about the job handle can safely ignore the return value.
 */
export function queueFileIndex(params: {
  fileId: string
  workspaceId: string
  content: string
  isNew?: boolean
  fileName?: string
  fileSize?: number
  /**
   * Absolute source path on the originating machine. When provided, the queue
   * uses dirname(filePath) as the folder bucket — which is what drives the
   * per-folder Sources view and the scoped pause/stop/jump-start controls.
   */
  filePath?: string | null
  /**
   * Bypass the user's "auto-index" toggle. Routes that represent an EXPLICIT
   * user ask to index (the per-file "Index now" button, the Add-to-Index
   * modal, chat import) should set this. Upload paths that would otherwise
   * auto-fire on every dropped file MUST NOT set it — those are the ones
   * the toggle exists to gate.
   */
  bypassAutoIndex?: boolean
}): IndexJob | null {
  if (!params.bypassAutoIndex && !isAutoIndexEnabled()) {
    return null
  }

  // Normalize so "C:\foo\bar.md" and "C:/foo/bar.md" bucket to the same folder.
  const normalizedPath = params.filePath ? params.filePath.replace(/\\/g, '/') : null
  const folderPath = normalizedPath
    ? normalizedPath.slice(0, Math.max(normalizedPath.lastIndexOf('/'), 0)) || null
    : null

  return enqueueIndexJob({
    type: params.isNew ? 'full_index' : 'incremental_index',
    sourceType: 'file',
    sourceId: params.fileId,
    workspaceId: params.workspaceId,
    metadata: {
      content: params.content,
      fileName: params.fileName,
      fileSize: params.fileSize,
      label: params.fileName ?? params.fileId,
      filePath: normalizedPath ?? undefined,
      folderPath: folderPath ?? undefined,
    },
  })
}
