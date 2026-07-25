/**
 * Index Management Routes (Sprint CTX-1)
 *
 * Hide/unhide/delete/bulk + upload/paste/import-conversation
 * for individual records in a user's semantic index.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/index'
import { indexRecords } from '../db/schema/semantic-index'
import { rawFiles } from '../db/schema/raw-files'
import { chatConversations, chatMessages } from '../db/schema/chat'
import { authMiddleware } from '../middleware/auth'
import { storeRawFile } from '../services/raw-file-store'
import { extractText } from '../services/raw-file-store/store'
import { downloadBuffer } from '../lib/s3'
import { computeContentHash } from '../services/semantic-index/content-hash'
import { queueFileIndex } from '../services/indexing/file-indexer'

/**
 * Per-conversation index wrapper: each chat_conversation can have at most
 * one raw_files row that represents its whole transcript, joined by
 * (source_type='chat_artifact', source_ref=<conversationId>). That row is
 * what the indexer consumes. The helpers below keep this contract in one
 * place so /status lookups and /:id/index enqueues agree.
 */
async function getConversationWrapperFile(
  conversationId: string
): Promise<{ id: string; deletedAt: Date | null; extractedText: string | null; version: number; workspaceId: string | null; fileName: string; fileSize: number; filePath: string | null } | null> {
  const rows = await db
    .select({
      id: rawFiles.id,
      deletedAt: rawFiles.deletedAt,
      extractedText: rawFiles.extractedText,
      version: rawFiles.version,
      workspaceId: rawFiles.workspaceId,
      fileName: rawFiles.fileName,
      fileSize: rawFiles.fileSize,
      filePath: rawFiles.filePath,
    })
    .from(rawFiles)
    .where(
      and(eq(rawFiles.sourceType, 'chat_artifact'), eq(rawFiles.sourceRef, conversationId))
    )
    .limit(1)
  return rows[0] ?? null
}

async function buildConversationTranscript(conversationId: string): Promise<string> {
  const msgs = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.createdAt))
  return msgs.map((m) => `[${m.role}] ${m.content ?? ''}`).join('\n\n')
}

export const indexManageRouter = new Hono()
indexManageRouter.use('*', authMiddleware)

// ─── Hide / Unhide ──────────────────────────────────────────────────────────

indexManageRouter.patch('/:id/hide', async (c) => {
  const id = c.req.param('id')
  await db
    .update(indexRecords)
    .set({ hidden: true, hiddenAt: new Date() })
    .where(eq(indexRecords.id, id))

  return c.json({ data: { id, hidden: true }, error: null })
})

indexManageRouter.patch('/:id/unhide', async (c) => {
  const id = c.req.param('id')
  await db
    .update(indexRecords)
    .set({ hidden: false, hiddenAt: null })
    .where(eq(indexRecords.id, id))

  return c.json({ data: { id, hidden: false }, error: null })
})

// ─── Delete (tombstones record + cascades to siblings + audit) ─────────────
//
// 2026-04-29: Soft-delete via tombstoneRecord (services/pipeline/tombstone.ts).
// Preserves the supersession chain + writes a hash-chained evidence_records
// audit row. The record is recoverable until the GC window expires.
//
// Behavior preserved for existing callers: deleting one record still removes
// every sibling sharing the same `sourceFileId`. A future PR will split this
// into per-record `forget` vs per-source `forget` so the user can choose.

async function deleteIndexItem(id: string, deletedBy: string): Promise<void> {
  const { tombstoneRecord, tombstoneSource } = await import(
    '../services/pipeline/tombstone'
  )

  const [record] = await db
    .select({
      id: indexRecords.id,
      sourceFileId: indexRecords.sourceFileId,
    })
    .from(indexRecords)
    .where(eq(indexRecords.id, id))
    .limit(1)
  if (!record) return

  if (record.sourceFileId) {
    // Tombstone every record sharing this source — preserves the v5.1
    // cascade behavior, but each removal now writes its own audit row.
    await tombstoneSource({
      sourceFileId: record.sourceFileId,
      deletedBy,
      reason: 'user',
    })
    // Soft-delete the raw file with the audit fields populated.
    try {
      await db
        .update(rawFiles)
        .set({
          deletedAt: new Date(),
          deletedBy,
          deletionReason: 'user',
        })
        .where(eq(rawFiles.id, record.sourceFileId))
    } catch {
      /* raw file may not exist */
    }
  } else {
    // No source — tombstone just this record.
    await tombstoneRecord({ recordId: id, deletedBy, reason: 'user', scope: 'record' })
  }
}

/**
 * 2026-04-29: Lifecycle endpoints.
 *
 *   POST /:id/forget   { scope?: 'record' | 'source' }  — soft tombstone, recoverable for 30d
 *   POST /:id/erase    { reason: string }               — gdpr-style; redacts content + GC sweeps next pass
 *   POST /:id/restore                                   — reverse a forget while still tombstoned
 *
 * The legacy DELETE /:id is preserved as an alias for `forget` with
 * `scope: 'source'` (matching v5.1 behavior — deleting one record removed
 * every sibling sharing the same sourceFileId).
 */

const ForgetSchema = z
  .object({
    scope: z.enum(['record', 'source']).optional(),
  })
  .optional()

indexManageRouter.post('/:id/forget', async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId') as string
  let scope: 'record' | 'source' = 'record'
  try {
    const body = await c.req.json()
    const parsed = ForgetSchema.parse(body)
    if (parsed?.scope) scope = parsed.scope
  } catch {
    /* empty body is fine — defaults to 'record' */
  }

  const { tombstoneRecord, tombstoneSource } = await import(
    '../services/pipeline/tombstone'
  )

  if (scope === 'source') {
    const [record] = await db
      .select({ sourceFileId: indexRecords.sourceFileId })
      .from(indexRecords)
      .where(eq(indexRecords.id, id))
      .limit(1)
    if (!record?.sourceFileId) {
      // Fallback to record-only when there's no source file.
      const result = await tombstoneRecord({
        recordId: id,
        deletedBy: userId,
        reason: 'user',
        scope: 'record',
      })
      return c.json({ data: { scope: 'record', recordsTouched: 1, ...result }, error: null })
    }
    const results = await tombstoneSource({
      sourceFileId: record.sourceFileId,
      deletedBy: userId,
      reason: 'user',
    })
    // Soft-delete the raw file too, with audit metadata.
    await db
      .update(rawFiles)
      .set({ deletedAt: new Date(), deletedBy: userId, deletionReason: 'user' })
      .where(eq(rawFiles.id, record.sourceFileId))
    return c.json({
      data: { scope: 'source', recordsTouched: results.length, sourceFileId: record.sourceFileId },
      error: null,
    })
  }

  const result = await tombstoneRecord({
    recordId: id,
    deletedBy: userId,
    reason: 'user',
    scope: 'record',
  })
  return c.json({ data: { scope: 'record', recordsTouched: 1, ...result }, error: null })
})

const EraseSchema = z.object({
  reason: z.string().min(1).max(280),
  scope: z.enum(['record', 'source']).optional().default('record'),
})

indexManageRouter.post('/:id/erase', zValidator('json', EraseSchema), async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId') as string
  const { reason, scope } = c.req.valid('json')

  const { tombstoneRecord, tombstoneSource } = await import(
    '../services/pipeline/tombstone'
  )
  const { evidenceRecords } = await import('../db/schema/semantic-index')

  // Tombstone with reason='gdpr' so the audit row gets retentionPolicy='redacted'
  // and the GC picks it up on the next sweep without waiting for retention.
  let touchedRecordIds: string[] = []
  if (scope === 'source') {
    const [record] = await db
      .select({ sourceFileId: indexRecords.sourceFileId })
      .from(indexRecords)
      .where(eq(indexRecords.id, id))
      .limit(1)
    if (record?.sourceFileId) {
      const results = await tombstoneSource({
        sourceFileId: record.sourceFileId,
        deletedBy: userId,
        reason: 'gdpr',
        context: { eraseReason: reason },
      })
      touchedRecordIds = results.map((r) => r.recordId)
      await db
        .update(rawFiles)
        .set({ deletedAt: new Date(), deletedBy: userId, deletionReason: 'gdpr' })
        .where(eq(rawFiles.id, record.sourceFileId))
    } else {
      const r = await tombstoneRecord({
        recordId: id,
        deletedBy: userId,
        reason: 'gdpr',
        scope: 'record',
        context: { eraseReason: reason },
      })
      touchedRecordIds = [r.recordId]
    }
  } else {
    const r = await tombstoneRecord({
      recordId: id,
      deletedBy: userId,
      reason: 'gdpr',
      scope: 'record',
      context: { eraseReason: reason },
    })
    touchedRecordIds = [r.recordId]
  }

  // Strip contentBefore from the just-written audit rows — erase means even
  // the audit trail doesn't keep the content. The hash chain stays intact;
  // a verifier sees that something was erased without seeing what.
  if (touchedRecordIds.length > 0) {
    await db
      .update(evidenceRecords)
      .set({ contentBefore: null, redactedAt: new Date(), redactedFields: ['contentBefore'] })
      .where(inArray(evidenceRecords.indexRecordId, touchedRecordIds))
  }

  return c.json({
    data: { scope, recordsTouched: touchedRecordIds.length, eraseReason: reason },
    error: null,
  })
})

indexManageRouter.post('/:id/restore', async (c) => {
  const id = c.req.param('id')
  const { restoreRecord } = await import('../services/pipeline/tombstone')

  // Block restore if the record was erased (retentionPolicy='redacted').
  // We check the most recent evidence row for this record.
  const { evidenceRecords } = await import('../db/schema/semantic-index')
  const [last] = await db
    .select({ retentionPolicy: evidenceRecords.retentionPolicy })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.indexRecordId, id))
    .orderBy(desc(evidenceRecords.createdAt))
    .limit(1)
  if (last?.retentionPolicy === 'redacted') {
    return c.json(
      {
        data: null,
        error: {
          code: 'NOT_RESTORABLE',
          message: 'This item was erased (GDPR-style). Erased items cannot be restored.',
        },
      },
      400
    )
  }

  const ok = await restoreRecord(id)
  if (!ok) {
    return c.json(
      { data: null, error: { code: 'NOT_TOMBSTONED', message: 'Item is not currently tombstoned' } },
      404
    )
  }
  return c.json({ data: { restored: true }, error: null })
})

// Legacy alias — old clients hit DELETE /:id; keep it working with the
// pre-2026-04-29 cascade behavior (scope='source').
indexManageRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId') as string
  await deleteIndexItem(id, userId)
  return c.json({ data: { deleted: true }, error: null })
})

// ─── Bulk ───────────────────────────────────────────────────────────────────

const BulkSchema = z.object({
  action: z.enum(['hide', 'unhide', 'delete']),
  ids: z.array(z.string().uuid()).min(1).max(50),
})

indexManageRouter.post('/bulk', zValidator('json', BulkSchema), async (c) => {
  const { action, ids } = c.req.valid('json')
  const userId = c.get('userId') as string
  let affected = 0

  if (action === 'hide') {
    const res = await db
      .update(indexRecords)
      .set({ hidden: true, hiddenAt: new Date() })
      .where(inArray(indexRecords.id, ids))
    affected = (res as any)?.rowCount ?? ids.length
  } else if (action === 'unhide') {
    const res = await db
      .update(indexRecords)
      .set({ hidden: false, hiddenAt: null })
      .where(inArray(indexRecords.id, ids))
    affected = (res as any)?.rowCount ?? ids.length
  } else if (action === 'delete') {
    for (const id of ids) {
      await deleteIndexItem(id, userId)
      affected++
    }
  }

  return c.json({ data: { affected }, error: null })
})

// ─── Upload (multipart, multiple files, SHA-256 dedup) ──────────────────────
//
// Sprint MCP-3 split: upload and indexing are now separate steps so the UI
// can surface them as distinct phases with per-file status.
//
// Default: upload stores the raw file (with text extraction for dedup hash)
// but does NOT enqueue indexing. Callers that want the old one-shot
// behaviour can pass ?autoIndex=true (used by paste + import-conversation
// paths, and by legacy clients like the Desktop Agent).

indexManageRouter.post('/upload', async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = (c.get('workspaceId') as string) ?? ''
  const autoIndex = c.req.query('autoIndex') === 'true'

  const formData = await c.req.formData()
  const files = formData.getAll('files').filter((v) => v instanceof File) as File[]
  const singleFile = formData.get('file')
  if (singleFile instanceof File) files.push(singleFile)

  // Optional project association — Files row's "+" button on the project
  // dashboard sends spaceId so uploaded files land tagged with that project.
  // Header takes precedence over form field when both are present.
  const spaceIdRaw =
    c.req.header('x-space-id') ??
    (typeof formData.get('spaceId') === 'string' ? (formData.get('spaceId') as string) : null)
  const spaceId = spaceIdRaw && spaceIdRaw !== 'personal' ? spaceIdRaw : undefined

  // MCP-FIX-4 (folder uploads): clients may send a parallel `filePaths[]`
  // array whose entries line up 1:1 with `files[]`. Each entry is the
  // relative path under the folder the user selected (e.g.
  // `codebase/apps/web/page.tsx`). When present we persist it so the Files
  // view can render a folder tree; when absent the file lands at tree root.
  const rawPaths = formData.getAll('filePaths').map((v) => (typeof v === 'string' ? v : null))

  if (files.length === 0) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'No files provided' } },
      400
    )
  }

  let uploaded = 0
  let duplicates = 0
  const items: Array<{
    id: string
    fileName: string
    contentHash: string
    indexable: boolean
    indexQueued: boolean
  }> = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!
    const buffer = Buffer.from(await file.arrayBuffer())
    // A path is only adopted when the parallel array has an entry at this
    // index AND it carries at least one path separator — a bare filename is
    // no better than `null` for tree construction.
    const rawPath = rawPaths[i] ?? null
    const filePath =
      rawPath && (rawPath.includes('/') || rawPath.includes('\\')) ? rawPath : null

    const beforeVersion = await db
      .select({ id: rawFiles.id })
      .from(rawFiles)
      .where(eq(rawFiles.fileName, file.name))
      .limit(1)

    const record = await storeRawFile({
      userId,
      workspaceId,
      fileName: file.name,
      filePath: filePath ?? undefined,
      mimeType: file.type || 'application/octet-stream',
      content: buffer,
      sourceType: 'upload',
      spaceId,
    })

    if (beforeVersion.length > 0 && beforeVersion[0]?.id === record.id) {
      duplicates++
    } else {
      uploaded++
    }

    const indexable = !!(record.extractedText && record.extractedText.length > 0)
    let indexQueued = false
    if (indexable && autoIndex) {
      try {
        queueFileIndex({
          fileId: record.id,
          workspaceId,
          content: record.extractedText!,
          isNew: record.version === 1,
          fileName: record.fileName,
          fileSize: record.fileSize,
          filePath: record.filePath,
        })
        indexQueued = true
      } catch {
        /* non-fatal */
      }
    }

    items.push({
      id: record.id,
      fileName: record.fileName,
      contentHash: record.contentHash,
      indexable,
      indexQueued,
    })
  }

  return c.json({ data: { uploaded, duplicates, items }, error: null })
})

// ─── Index a previously-uploaded raw file on demand (Sprint MCP-3) ─────────

indexManageRouter.post('/:id/index', async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId') as string
  const workspaceId = (c.get('workspaceId') as string) ?? ''

  let [record] = await db
    .select()
    .from(rawFiles)
    .where(eq(rawFiles.id, id))
    .limit(1)

  // If the id isn't a raw_file, it may be a conversation id. Look up or
  // create a wrapper raw_file for its transcript, then fall through to
  // the usual enqueue path.
  if (!record) {
    const [convo] = await db
      .select({ id: chatConversations.id, title: chatConversations.title, workspaceId: chatConversations.workspaceId })
      .from(chatConversations)
      .where(eq(chatConversations.id, id))
      .limit(1)
    if (convo) {
      const transcript = await buildConversationTranscript(convo.id)
      if (!transcript || transcript.trim().length === 0) {
        return c.json(
          { data: null, error: { code: 'NOT_INDEXABLE', message: 'Conversation has no messages to index.' } },
          400
        )
      }
      const wrapped = await storeRawFile({
        userId,
        workspaceId: convo.workspaceId ?? workspaceId,
        fileName: `conversation-${convo.id}.txt`,
        mimeType: 'text/plain',
        content: Buffer.from(transcript, 'utf-8'),
        sourceType: 'chat_artifact',
        sourceRef: convo.id,
      })
      const [fresh] = await db
        .select()
        .from(rawFiles)
        .where(eq(rawFiles.id, wrapped.id))
        .limit(1)
      record = fresh
    }
  }

  if (!record) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Item not found' } },
      404
    )
  }

  // On-demand extraction for files stored before PDF/binary parsers were
  // wired up. Download the bytes, run extractText with the row's MIME +
  // filename, and persist the result so indexing can proceed.
  if (!record.extractedText || record.extractedText.length === 0) {
    try {
      const content = await downloadBuffer(record.storageKey)
      const extracted = await extractText(content, record.mimeType, record.fileName)
      if (extracted && extracted.length > 0) {
        await db
          .update(rawFiles)
          .set({
            extractedText: extracted,
            extractedTextHash: computeContentHash(extracted),
            updatedAt: new Date(),
          })
          .where(eq(rawFiles.id, record.id))
        record = { ...record, extractedText: extracted }
      }
    } catch (err) {
      console.error('[index-manage] On-demand extraction failed:', err)
    }
  }

  if (!record.extractedText || record.extractedText.length === 0) {
    return c.json(
      {
        data: null,
        error: {
          code: 'NOT_INDEXABLE',
          message: 'This file has no extractable text and cannot be indexed.',
        },
      },
      400
    )
  }

  try {
    const job = queueFileIndex({
      fileId: record.id,
      workspaceId: record.workspaceId ?? workspaceId,
      content: record.extractedText,
      isNew: true, // re-index as full pass; queue dedupes if one is already running
      fileName: record.fileName,
      fileSize: record.fileSize,
      filePath: record.filePath,
      // Per-file "Index now" is an explicit user click — honor it even if
      // the global auto-index toggle is off.
      bypassAutoIndex: true,
    })
    return c.json({
      data: {
        fileId: record.id,
        jobId: job?.id ?? null,
        queued: !!job,
        alreadyInFlight: !job,
      },
      error: null,
    })
  } catch (err) {
    return c.json(
      {
        data: null,
        error: {
          code: 'ENQUEUE_FAILED',
          message: err instanceof Error ? err.message : 'Failed to enqueue',
        },
      },
      500
    )
  }
})

// ─── Per-file index status (batch) ─────────────────────────────────────────
//
// Returns, for each requested id, the current indexing state the UI should
// render next to the file row. Derived from:
//   - raw_files row: does the file still exist (not soft-deleted)
//   - index_records: does an indexed record already exist → 'indexed'
//   - queue: is there an active or recently-terminal job for this sourceId

indexManageRouter.get('/status', async (c) => {
  const idsParam = c.req.query('ids') ?? ''
  const ids = idsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (ids.length === 0) {
    return c.json({ data: {}, error: null })
  }

  const { getJobsBySourceIds } = await import('../services/indexing/index-queue')

  // Raw file presence check (filters ids that don't exist at all).
  const rawRows = await db
    .select({ id: rawFiles.id, deletedAt: rawFiles.deletedAt })
    .from(rawFiles)
    .where(inArray(rawFiles.id, ids))
  const rawById = new Map(rawRows.map((r) => [r.id, r]))

  // For any id that isn't a raw_file, check whether it's a conversation id
  // with a wrapper raw_file (source_type='chat_artifact', source_ref=id).
  // The wrapper's id is what the queue + index_records key off, so we
  // alias the conversation id → wrapper id before the usual lookups.
  const unresolvedIds = ids.filter((id) => !rawById.has(id))
  const convoAlias = new Map<string, string>() // conversationId → wrapperRawFileId
  if (unresolvedIds.length > 0) {
    const wrapperRows = await db
      .select({
        id: rawFiles.id,
        deletedAt: rawFiles.deletedAt,
        sourceRef: rawFiles.sourceRef,
      })
      .from(rawFiles)
      .where(
        and(
          eq(rawFiles.sourceType, 'chat_artifact'),
          inArray(rawFiles.sourceRef, unresolvedIds)
        )
      )
    for (const w of wrapperRows) {
      if (!w.sourceRef) continue
      convoAlias.set(w.sourceRef, w.id)
      rawById.set(w.id, { id: w.id, deletedAt: w.deletedAt })
    }
  }

  // The set of underlying raw_file ids we need to check index_records + jobs for
  const rawIds = Array.from(new Set(ids.map((id) => convoAlias.get(id) ?? id)))

  // For index_records lookup we also need to include the ORIGINAL ids (not
  // just their resolved wrappers): the chat-fact-extractor writes
  // index_records with sourceFileId = conversationId, not the wrapper
  // raw_file id (resolveSourceVersion sets sourceFileId to the semantic
  // document id for chat threads). Without this, conversations flip back to
  // "not_indexed" after restart because the resolved-id lookup misses them.
  const indexedLookupIds = Array.from(new Set([...rawIds, ...ids]))
  const indexed = await db
    .select({ sourceFileId: indexRecords.sourceFileId })
    .from(indexRecords)
    .where(
      and(
        inArray(indexRecords.sourceFileId, indexedLookupIds),
        // Tombstoned records don't count as "indexed" — the UI should show
        // an Index button so the user can restore by re-indexing.
        sql`${indexRecords.deletedAt} IS NULL`
      )
    )
  const indexedSet = new Set(indexed.map((r) => r.sourceFileId).filter(Boolean) as string[])

  const jobs = getJobsBySourceIds(rawIds)

  const out: Record<
    string,
    {
      upload: 'uploaded' | 'missing'
      index: 'not_indexed' | 'queued' | 'indexing' | 'indexed' | 'failed' | 'cancelled'
      phase?: string
      chunksDone?: number
      chunksTotal?: number
      etaMs?: number | null
      jobId?: string
      errorMessage?: string
    }
  > = {}

  for (const id of ids) {
    // Conversations with no wrapper raw_file yet: they exist (we assume the
    // caller only passes valid ids) but haven't been queued. Surface that so
    // the UI can show an "Index" button rather than "missing".
    const resolvedId = convoAlias.get(id) ?? id
    const raw = rawById.get(resolvedId)
    if (!raw) {
      // No raw_file, no wrapper. Treat as an indexable item that hasn't
      // been queued yet (e.g. a brand-new conversation).
      out[id] = { upload: 'uploaded', index: 'not_indexed' }
      continue
    }
    if (raw.deletedAt) {
      out[id] = { upload: 'missing', index: 'not_indexed' }
      continue
    }

    const job = jobs[resolvedId]
    // Match on either the incoming id (conversation case) or the resolved
    // wrapper id (raw-file case). Without the `id` check, conversations
    // show "not_indexed" even when index_records rows exist for them.
    const isIndexed = indexedSet.has(id) || indexedSet.has(resolvedId)

    if (!job) {
      out[id] = {
        upload: 'uploaded',
        index: isIndexed ? 'indexed' : 'not_indexed',
      }
      continue
    }

    // Map job status to UI phase
    const statusMap: Record<string, 'queued' | 'indexing' | 'indexed' | 'failed' | 'cancelled'> = {
      pending: 'queued',
      processing: 'indexing',
      completed: 'indexed',
      failed: 'failed',
      cancelled: 'cancelled',
    }
    out[id] = {
      upload: 'uploaded',
      index: statusMap[job.status] ?? (isIndexed ? 'indexed' : 'not_indexed'),
      phase: job.progress.phase,
      chunksDone: job.progress.chunksDone,
      chunksTotal: job.progress.chunksTotal,
      etaMs: job.progress.etaMs,
      jobId: job.id,
      errorMessage: job.lastError,
    }
  }

  return c.json({ data: out, error: null })
})

// ─── Paste (text/URL → raw file + index queue) ──────────────────────────────

const PasteSchema = z.object({
  content: z.string().min(1).max(1_000_000),
  title: z.string().optional(),
  type: z.enum(['text', 'url']).default('text'),
})

// 2026-04-29: list of currently-tombstoned items for the "Recently forgotten"
// bin in the items view. Excludes anything past the recoverable retention
// window (those are dropped by the GC; surfacing them here would falsely
// suggest restorability).
indexManageRouter.get('/tombstoned', async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = (c.get('workspaceId') as string) ?? ''
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)

  const rows = await db.execute(sql`
    SELECT
      ir.id,
      ir.document_title,
      ir.section_alias,
      ir.embedding_text,
      ir.deleted_at,
      ir.deleted_by,
      ir.deletion_reason,
      ir.deletion_scope,
      u.name        AS deleted_by_name,
      ev.retention_policy,
      ev.created_at AS evidence_at
    FROM index_records ir
    LEFT JOIN users u ON u.id = ir.deleted_by
    LEFT JOIN LATERAL (
      SELECT retention_policy, created_at
      FROM evidence_records
      WHERE index_record_id = ir.id
      ORDER BY created_at DESC
      LIMIT 1
    ) ev ON true
    WHERE ir.user_id = ${userId}::uuid
      ${workspaceId ? sql`AND ir.workspace_id = ${workspaceId}::uuid` : sql``}
      AND ir.deleted_at IS NOT NULL
      AND ir.deleted_at > now() - interval '30 days'
      AND COALESCE(ev.retention_policy, 'recoverable_30d') <> 'redacted'
    ORDER BY ir.deleted_at DESC
    LIMIT ${limit}
  `)
  const list: Array<Record<string, unknown>> = Array.isArray(rows)
    ? (rows as Array<Record<string, unknown>>)
    : ((rows as { rows?: Array<Record<string, unknown>> })?.rows ?? [])

  const data = list.map((r) => {
    const deletedAt = r['deleted_at'] ? new Date(String(r['deleted_at'])) : null
    const expiresAt = deletedAt
      ? new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null
    return {
      id: String(r['id']),
      documentTitle: r['document_title'] ? String(r['document_title']) : null,
      sectionAlias: r['section_alias'] ? String(r['section_alias']) : null,
      embeddingText:
        typeof r['embedding_text'] === 'string'
          ? (r['embedding_text'] as string).slice(0, 240)
          : '',
      deletedAt: deletedAt?.toISOString() ?? null,
      deletedByName: r['deleted_by_name'] ? String(r['deleted_by_name']) : null,
      deletionReason: r['deletion_reason'] ? String(r['deletion_reason']) : null,
      deletionScope: r['deletion_scope'] ? String(r['deletion_scope']) : null,
      retentionPolicy: r['retention_policy'] ? String(r['retention_policy']) : 'recoverable_30d',
      expiresAt,
    }
  })

  return c.json({ data, error: null })
})

indexManageRouter.post('/paste', zValidator('json', PasteSchema), async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = (c.get('workspaceId') as string) ?? ''
  const { content, title, type } = c.req.valid('json')

  const spaceIdHeader = c.req.header('x-space-id')
  const spaceId = spaceIdHeader && spaceIdHeader !== 'personal' ? spaceIdHeader : undefined

  const fileName =
    title ||
    (type === 'url' ? `Pasted URL ${new Date().toISOString()}` : `Pasted text ${new Date().toISOString()}`)
  const mimeType = type === 'url' ? 'text/uri-list' : 'text/plain'

  const record = await storeRawFile({
    userId,
    workspaceId,
    fileName,
    mimeType,
    content: Buffer.from(content, 'utf-8'),
    sourceType: 'upload',
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
      /* non-fatal */
    }
  }

  return c.json({
    data: {
      id: record.id,
      fileName: record.fileName,
      contentHash: record.contentHash,
    },
    error: null,
  })
})

// ─── Import conversation ────────────────────────────────────────────────────

const ImportConvoSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.string(),
        content: z.string(),
      })
    )
    .min(1)
    .max(5000),
  source: z.string(),
  title: z.string().optional(),
})

indexManageRouter.post('/import-conversation', zValidator('json', ImportConvoSchema), async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = (c.get('workspaceId') as string) ?? ''
  const { messages, source, title } = c.req.valid('json')

  const spaceIdHeader = c.req.header('x-space-id')
  const spaceId = spaceIdHeader && spaceIdHeader !== 'personal' ? spaceIdHeader : undefined

  const chatSourceType =
    source === 'claude' ? 'claude'
      : source === 'chatgpt' ? 'chatgpt'
        : source === 'cursor' ? 'cursor'
          : source === 'gemini' ? 'gemini'
            : 'custom'

  const [conversation] = await db
    .insert(chatConversations)
    .values({
      workspaceId,
      userId,
      title: title || `Imported from ${source}`,
      type: 'standard',
      status: 'active',
      chatSourceType,
      spaceId,
      metadata: { imported: true, source },
    })
    .returning()

  const conversationId = conversation?.id
  if (!conversationId) {
    return c.json(
      { data: null, error: { code: 'INTERNAL', message: 'Failed to create conversation' } },
      500
    )
  }

  // Insert messages
  for (const msg of messages) {
    const role =
      msg.role === 'assistant' || msg.role === 'system' || msg.role === 'user'
        ? (msg.role as 'assistant' | 'system' | 'user')
        : 'user'
    await db.insert(chatMessages).values({
      conversationId,
      userId: role === 'user' ? userId : null,
      role,
      content: msg.content,
    })
  }

  // Queue for intelligence pipeline via a raw file wrapper so reporter picks it up
  const transcript = messages.map((m) => `[${m.role}] ${m.content}`).join('\n\n')
  try {
    const wrapped = await storeRawFile({
      userId,
      workspaceId,
      fileName: `conversation-${conversationId}.txt`,
      mimeType: 'text/plain',
      content: Buffer.from(transcript, 'utf-8'),
      sourceType: 'chat_artifact',
      sourceRef: conversationId,
    })
    if (wrapped.extractedText) {
      queueFileIndex({
        fileId: wrapped.id,
        workspaceId,
        content: wrapped.extractedText,
        isNew: true,
        fileName: wrapped.fileName,
        fileSize: wrapped.fileSize,
        // Chat import is an explicit user-triggered ingestion; index it
        // regardless of the auto-index toggle.
        bypassAutoIndex: true,
      })
    }
  } catch {
    /* non-fatal */
  }

  // Count how many facts already exist (proxy for "extracted")
  const [factCount] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(indexRecords)
    .where(eq(indexRecords.sourceFileId, conversationId))

  return c.json({
    data: {
      conversationId,
      factsExtracted: factCount?.cnt ?? 0,
    },
    error: null,
  })
})

// ─── By-contributor summary (Sprint CTX-2, mounted here for convenience) ────

indexManageRouter.get('/by-contributor', async (c) => {
  const requestingUserId = c.get('userId') as string
  const rows = await db
    .select({
      userId: indexRecords.userId,
      userName: indexRecords.userName,
      threadType: indexRecords.threadType,
      sourceFileId: indexRecords.sourceFileId,
      indexedAt: indexRecords.indexedAt,
    })
    .from(indexRecords)
    .where(
      and(
        eq(indexRecords.hidden, false),
        sql`${indexRecords.deletedAt} IS NULL`
      )
    )
    .limit(1000)

  const byUser = new Map<
    string,
    { userId: string; name: string | null; factCount: number; fileCount: number; latestAt: Date | string | null }
  >()
  for (const row of rows) {
    const current = byUser.get(row.userId) ?? {
      userId: row.userId,
      name: row.userName,
      factCount: 0,
      fileCount: 0,
      latestAt: null as Date | string | null,
    }
    current.factCount++
    if (row.sourceFileId) current.fileCount++
    if (!current.latestAt || (row.indexedAt && row.indexedAt > (current.latestAt as any))) {
      current.latestAt = row.indexedAt
    }
    byUser.set(row.userId, current)
  }

  const contributors = Array.from(byUser.values()).sort((a, b) => {
    const aT = a.latestAt ? new Date(a.latestAt as any).getTime() : 0
    const bT = b.latestAt ? new Date(b.latestAt as any).getTime() : 0
    return bT - aT
  })

  return c.json({ data: { contributors, requestingUserId }, error: null })
})
