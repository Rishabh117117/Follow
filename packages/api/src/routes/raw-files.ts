/**
 * Raw File Storage Routes (Sprint MCP-2)
 *
 * CRUD for raw files stored in S3/MinIO.
 */

import { Hono } from 'hono'
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '../db/index'
import { rawFiles } from '../db/schema/raw-files'
import { createFlexAuthMiddleware } from '../middleware/api-key-auth'
import { authMiddleware } from '../middleware/auth'
import { storeRawFile, getRawFile, listRawFiles } from '../services/raw-file-store'
import { queueFileIndex } from '../services/indexing/file-indexer'

export const rawFilesRouter = new Hono()
rawFilesRouter.use('*', createFlexAuthMiddleware(authMiddleware))

// POST /api/raw-files/upload — Upload a raw file
rawFilesRouter.post('/upload', async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = (c.get('workspaceId') as string) ?? ''

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  const sourceType = (formData.get('sourceType') as string) ?? 'upload'
  const sourceRef = formData.get('sourceRef') as string | null
  // STABILIZE-3: spaceId can arrive either as a form field or as a header
  // (the Desktop Agent uses the header path via fetch()).
  const spaceId =
    (formData.get('spaceId') as string | null) ?? c.req.header('x-space-id') ?? null

  if (!file) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'file field is required' } },
      400
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  const record = await storeRawFile({
    userId,
    workspaceId,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    content: buffer,
    sourceType: sourceType as 'local' | 'upload' | 'gws' | 'chat_artifact',
    sourceRef: sourceRef ?? undefined,
    spaceId: spaceId || undefined,
  })

  // Trigger indexing if extracted text is available
  if (record.extractedText && record.extractedText.length > 0) {
    try {
      queueFileIndex({
        fileId: record.id,
        workspaceId,
        content: record.extractedText,
        isNew: record.version === 1,
        fileName: record.fileName,
        fileSize: record.fileSize,
        filePath: record.filePath,
      })
    } catch {
      // Non-fatal — file is stored even if indexing fails
    }
  }

  return c.json({
    data: {
      id: record.id,
      fileName: record.fileName,
      mimeType: record.mimeType,
      fileSize: record.fileSize,
      contentHash: record.contentHash,
      version: record.version,
      sourceType: record.sourceType,
      createdAt: record.createdAt,
    },
    error: null,
  })
})

// POST /api/raw-files/index-local — Index a file by reference (no S3 upload)
// Used by the Desktop Agent for watched folders with cloudCopy=false.
// Body: { filePath, fileName, mimeType, contentBase64 }
// The agent sends base64 bytes so the server can still hash + extract text,
// but storeRawFile skips S3 upload (storageKey = "local-ref://<path>").
rawFilesRouter.post('/index-local', async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = (c.get('workspaceId') as string) ?? ''

  const body = (await c.req.json()) as {
    filePath: string
    fileName: string
    mimeType?: string
    contentBase64: string
    spaceId?: string
  }

  if (!body.filePath || !body.fileName || !body.contentBase64) {
    return c.json(
      {
        data: null,
        error: { code: 'BAD_REQUEST', message: 'filePath, fileName, contentBase64 required' },
      },
      400
    )
  }

  const buffer = Buffer.from(body.contentBase64, 'base64')
  const spaceId = body.spaceId ?? c.req.header('x-space-id') ?? undefined

  const record = await storeRawFile({
    userId,
    workspaceId,
    fileName: body.fileName,
    filePath: body.filePath,
    mimeType: body.mimeType || 'application/octet-stream',
    content: buffer,
    sourceType: 'local',
    sourceRef: body.filePath,
    storageMode: 'local_ref',
    spaceId,
  })

  if (record.extractedText && record.extractedText.length > 0) {
    try {
      queueFileIndex({
        fileId: record.id,
        workspaceId,
        content: record.extractedText,
        isNew: record.version === 1,
        fileName: record.fileName,
        fileSize: record.fileSize,
        filePath: record.filePath,
      })
    } catch {
      // Non-fatal
    }
  }

  return c.json({
    data: {
      id: record.id,
      fileName: record.fileName,
      contentHash: record.contentHash,
      version: record.version,
      storageKey: record.storageKey,
      indexedAt: record.createdAt,
    },
    error: null,
  })
})

// GET /api/raw-files/check-hash — Check if a file exists by content hash (DA-1)
// STABILIZE-3: accepts an optional ?spaceId=<uuid> query param; when present
// and the hash already exists but without a space binding (or with a different
// one), this endpoint patches space_id so the agent doesn't have to re-upload
// bytes just to retag an index binding.
rawFilesRouter.get('/check-hash', async (c) => {
  const userId = c.get('userId') as string
  const hash = c.req.query('hash')
  const spaceId = c.req.query('spaceId') || c.req.header('x-space-id')

  if (!hash) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'hash query param is required' } },
      400
    )
  }

  const [existing] = await db
    .select({ id: rawFiles.id, spaceId: rawFiles.spaceId })
    .from(rawFiles)
    .where(and(eq(rawFiles.contentHash, hash), eq(rawFiles.userId, userId), isNull(rawFiles.deletedAt)))
    .limit(1)

  if (existing && spaceId && existing.spaceId !== spaceId) {
    await db
      .update(rawFiles)
      .set({ spaceId, updatedAt: new Date() })
      .where(eq(rawFiles.id, existing.id))
  }

  return c.json({
    data: { exists: !!existing, fileId: existing?.id ?? null },
    error: null,
  })
})

// POST /api/raw-files/upload-batch — Batch upload (DA-1, max 50 files)
rawFilesRouter.post('/upload-batch', async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = (c.get('workspaceId') as string) ?? ''
  const body = (await c.req.json()) as Array<{
    fileName: string
    filePath?: string
    mimeType: string
    contentHash: string
    extractedText?: string
    content: string // base64
  }>

  if (!Array.isArray(body) || body.length === 0) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'Expected non-empty array' } },
      400
    )
  }

  if (body.length > 50) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'Maximum 50 files per batch' } },
      400
    )
  }

  const results: Array<{ fileName: string; status: string; id?: string; error?: string }> = []

  for (const item of body) {
    try {
      const buffer = Buffer.from(item.content, 'base64')
      const record = await storeRawFile({
        userId,
        workspaceId,
        fileName: item.fileName,
        filePath: item.filePath,
        mimeType: item.mimeType,
        content: buffer,
        sourceType: 'local',
      })

      // Trigger indexing
      if (record.extractedText && record.extractedText.length > 0) {
        try {
          queueFileIndex({
            fileId: record.id,
            workspaceId,
            content: record.extractedText,
            isNew: record.version === 1,
            fileName: record.fileName,
            fileSize: record.fileSize,
            filePath: record.filePath,
          })
        } catch { /* non-fatal */ }
      }

      results.push({ fileName: item.fileName, status: 'ok', id: record.id })
    } catch (err) {
      results.push({
        fileName: item.fileName,
        status: 'error',
        error: (err as Error).message,
      })
    }
  }

  return c.json({ data: results, error: null })
})

// GET /api/raw-files — List raw files
rawFilesRouter.get('/', async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = (c.get('workspaceId') as string) ?? ''
  const limit = parseInt(c.req.query('limit') ?? '50', 10)
  const offset = parseInt(c.req.query('offset') ?? '0', 10)
  const sourceType = c.req.query('sourceType') ?? undefined
  const search = c.req.query('search') ?? undefined
  const spaceIdParam = c.req.query('spaceId')
  // ?spaceId=personal → null filter (personal index only)
  // ?spaceId=<uuid>   → that project only
  // (omitted)         → no filter (legacy / cross-project)
  const spaceId =
    spaceIdParam === 'personal'
      ? null
      : spaceIdParam || undefined

  const files = await listRawFiles(userId, workspaceId, {
    limit,
    offset,
    sourceType,
    fileNamePattern: search,
    spaceId,
  })

  // chat_artifact rows are internal wrappers the chat-indexing path uses to
  // feed transcripts into the file-indexing pipeline. They shouldn't appear
  // as standalone rows in the Items list — the conversation itself is the
  // user-facing object. Only surface them when the caller explicitly asks.
  const filtered =
    sourceType === 'chat_artifact'
      ? files
      : files.filter((f) => f.sourceType !== 'chat_artifact')

  return c.json({ data: filtered, error: null })
})

// GET /api/raw-files/:id — Get file metadata
rawFilesRouter.get('/:id', async (c) => {
  const userId = c.get('userId') as string
  const fileId = c.req.param('id')

  const [record] = await db
    .select()
    .from(rawFiles)
    .where(and(eq(rawFiles.id, fileId), eq(rawFiles.userId, userId)))
    .limit(1)

  if (!record) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'File not found' } },
      404
    )
  }

  return c.json({ data: record, error: null })
})

// GET /api/raw-files/:id/content — Download file content
rawFilesRouter.get('/:id/content', async (c) => {
  const userId = c.get('userId') as string
  const fileId = c.req.param('id')

  const result = await getRawFile(fileId)
  if (!result || result.record.userId !== userId) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'File not found' } },
      404
    )
  }

  c.header('Content-Type', result.record.mimeType)
  c.header('Content-Disposition', `attachment; filename="${result.record.fileName}"`)
  return c.body(new Uint8Array(result.content))
})

// DELETE /api/raw-files/:id — Soft delete
rawFilesRouter.delete('/:id', async (c) => {
  const userId = c.get('userId') as string
  const fileId = c.req.param('id')

  const [record] = await db
    .select()
    .from(rawFiles)
    .where(and(eq(rawFiles.id, fileId), eq(rawFiles.userId, userId)))
    .limit(1)

  if (!record) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'File not found' } },
      404
    )
  }

  await db
    .update(rawFiles)
    .set({ deletedAt: new Date() })
    .where(eq(rawFiles.id, fileId))

  return c.json({ data: { ok: true }, error: null })
})
