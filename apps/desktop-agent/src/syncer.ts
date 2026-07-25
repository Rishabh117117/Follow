/**
 * API Syncer (Sprint DA-1)
 *
 * HTTP client that pushes files to Follow's raw-files API.
 */

import { readFile } from 'fs/promises'
import { basename } from 'path'
import { lookup } from 'mime-types'
import type { AgentConfig, WatchFolder } from './config.js'
import type { Logger } from './logger.js'
import { hashBuffer } from './hasher.js'
import { extractText } from './extractor.js'

export interface SyncFileResult {
  fileName: string
  status: 'uploaded' | 'unchanged' | 'error'
  hash: string
  error?: string
}

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink'
  filePath: string
  folderConfig: WatchFolder
  detectedAt: Date
}

export interface Syncer {
  syncFile(event: FileChangeEvent): Promise<SyncFileResult>
  deleteFile(filePath: string): Promise<void>
  checkConnection(): Promise<boolean>
}

export function createSyncer(config: AgentConfig, logger: Logger): Syncer {
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'x-workspace-id': config.workspaceId,
  }

  async function checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${config.apiUrl}/health`)
      return res.ok
    } catch {
      return false
    }
  }

  async function syncFile(event: FileChangeEvent): Promise<SyncFileResult> {
    const fileName = basename(event.filePath)
    const mimeType = lookup(event.filePath) || 'application/octet-stream'

    try {
      // Read file content
      const content = await readFile(event.filePath)
      const contentHash = hashBuffer(content)

      // Check if file already exists with same hash. STABILIZE-3: when the
      // folder is bound to an index, include spaceId so the server patches
      // the existing row's binding if it isn't already tagged.
      const spaceQ = event.folderConfig.indexId
        ? `&spaceId=${encodeURIComponent(event.folderConfig.indexId)}`
        : ''
      const checkRes = await fetch(
        `${config.apiUrl}/api/raw-files/check-hash?hash=${contentHash}${spaceQ}`,
        { headers }
      )
      if (checkRes.ok) {
        const checkData = (await checkRes.json()) as { data: { exists: boolean } }
        if (checkData.data?.exists) {
          return { fileName, status: 'unchanged', hash: contentHash }
        }
      }

      // Extract text
      const extracted = await extractText(event.filePath, mimeType)
      void extracted // server will re-extract; we keep the local call for future use

      // Branch: cloud copy uploads bytes to S3; local-ref only sends hash+text.
      const useCloud = event.folderConfig.cloudCopy === true
      const spaceHeader = event.folderConfig.indexId
        ? { 'x-space-id': event.folderConfig.indexId }
        : {}

      if (useCloud) {
        const formData = new FormData()
        formData.append('file', new Blob([content], { type: mimeType }), fileName)
        formData.append('sourceType', 'local')
        formData.append('sourceRef', event.filePath)
        if (event.folderConfig.indexId) {
          formData.append('spaceId', event.folderConfig.indexId)
        }

        const uploadRes = await fetch(`${config.apiUrl}/api/raw-files/upload`, {
          method: 'POST',
          headers: {
            Authorization: headers.Authorization,
            'x-workspace-id': headers['x-workspace-id'],
            ...spaceHeader,
          },
          body: formData,
        })

        if (!uploadRes.ok) {
          const errBody = await uploadRes.text()
          return { fileName, status: 'error', hash: contentHash, error: errBody }
        }
      } else {
        // local-ref: send hash + bytes-as-base64 (server extracts text, skips S3).
        const indexRes = await fetch(`${config.apiUrl}/api/raw-files/index-local`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: headers.Authorization,
            'x-workspace-id': headers['x-workspace-id'],
            ...spaceHeader,
          },
          body: JSON.stringify({
            filePath: event.filePath,
            fileName,
            mimeType,
            contentBase64: content.toString('base64'),
            spaceId: event.folderConfig.indexId,
          }),
        })

        if (!indexRes.ok) {
          const errBody = await indexRes.text()
          return { fileName, status: 'error', hash: contentHash, error: errBody }
        }
      }

      return { fileName, status: 'uploaded', hash: contentHash }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      return { fileName, status: 'error', hash: '', error: msg }
    }
  }

  async function deleteFile(filePath: string): Promise<void> {
    const fileName = basename(filePath)
    try {
      // Find by name to get ID
      const res = await fetch(
        `${config.apiUrl}/api/raw-files?search=${encodeURIComponent(fileName)}`,
        { headers }
      )
      if (!res.ok) return

      const data = (await res.json()) as { data: Array<{ id: string }> }
      const files = data.data ?? []
      for (const file of files) {
        await fetch(`${config.apiUrl}/api/raw-files/${file.id}`, {
          method: 'DELETE',
          headers,
        })
      }
    } catch (err) {
      logger.warn(`Failed to delete ${fileName}: ${(err as Error).message}`)
    }
  }

  return { syncFile, deleteFile, checkConnection }
}
