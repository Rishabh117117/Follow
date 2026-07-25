/**
 * Raw File Store Service (Sprint MCP-2)
 *
 * Content-addressed file storage backed by S3/MinIO.
 * Handles storing, retrieving, deduplication, and version chaining.
 */

import { db } from '../../db/index'
import { rawFiles } from '../../db/schema/raw-files'
import { eq, and, ilike, desc, isNull } from 'drizzle-orm'
import { uploadBuffer, downloadBuffer } from '../../lib/s3'
import { computeContentHash } from '../semantic-index/content-hash'

// ─── Types ──────────────────────────────────────────────────────────

export interface StoreFileInput {
  userId: string
  workspaceId: string
  fileName: string
  filePath?: string
  mimeType: string
  content: Buffer
  sourceType: 'local' | 'upload' | 'gws' | 'chat_artifact'
  sourceRef?: string
  /**
   * 'cloud' (default) — uploads bytes to S3 (storageKey = raw-files/{userId}/{hash}).
   * 'local_ref' — SKIPS S3 upload. `content` is still used to compute hash + extract
   * text, but the bytes never leave the originating machine. storageKey encodes the
   * on-disk path as "local-ref://<filePath>". Used by the Desktop Agent when a
   * watched folder has cloudCopy=false.
   */
  storageMode?: 'cloud' | 'local_ref'
  /**
   * STABILIZE-3: optional binding to a project index (spaces.id). When provided,
   * the resulting raw_files row carries space_id, so queries scoped to that
   * index can filter by it.
   */
  spaceId?: string
}

export interface RawFileRecord {
  id: string
  userId: string
  workspaceId: string
  fileName: string
  filePath: string | null
  mimeType: string
  fileSize: number
  contentHash: string
  version: number
  previousHash: string | null
  storageKey: string
  extractedText: string | null
  sourceType: string
  sourceRef: string | null
  createdAt: Date
  updatedAt: Date
}

// ─── Store ──────────────────────────────────────────────────────────

export async function storeRawFile(input: StoreFileInput): Promise<RawFileRecord> {
  const contentHash = computeContentHash(input.content.toString('base64'))
  const fileSize = input.content.length

  // Check for hash-based dedup — same content, same user
  const [existing] = await db
    .select()
    .from(rawFiles)
    .where(
      and(
        eq(rawFiles.contentHash, contentHash),
        eq(rawFiles.userId, input.userId),
        isNull(rawFiles.deletedAt)
      )
    )
    .limit(1)

  if (existing) {
    // STABILIZE-3: if a spaceId was declared on this upload but the existing
    // row isn't bound to it yet, patch the binding. Dedupe should not prevent
    // the user from adding an already-uploaded file to a new index.
    if (input.spaceId && existing.spaceId !== input.spaceId) {
      const [updated] = await db
        .update(rawFiles)
        .set({ spaceId: input.spaceId, updatedAt: new Date() })
        .where(eq(rawFiles.id, existing.id))
        .returning()
      return (updated ?? existing) as unknown as RawFileRecord
    }
    return existing as unknown as RawFileRecord
  }

  // Check for version chaining — same fileName, increment version
  const [previousVersion] = await db
    .select()
    .from(rawFiles)
    .where(
      and(
        eq(rawFiles.fileName, input.fileName),
        eq(rawFiles.userId, input.userId),
        eq(rawFiles.workspaceId, input.workspaceId),
        isNull(rawFiles.deletedAt)
      )
    )
    .orderBy(desc(rawFiles.version))
    .limit(1)

  const version = previousVersion ? previousVersion.version + 1 : 1
  const previousHash = previousVersion?.contentHash ?? null

  // Upload to S3 — unless we're in local-ref mode (agent saw the file, hashed
  // it, extracted text, but the user didn't opt into a cloud copy).
  const mode = input.storageMode ?? 'cloud'
  const storageKey =
    mode === 'local_ref'
      ? `local-ref://${input.filePath ?? input.fileName}`
      : `raw-files/${input.userId}/${contentHash}`
  if (mode === 'cloud') {
    await uploadBuffer(storageKey, input.content, input.mimeType)
  }

  // Normalize mime type — some OSes report text-format source files under binary
  // MIME types (e.g. Windows reports .ts as video/mp2t). Correct those before storing
  // so extractText and downstream consumers see the real type.
  const normalizedMimeType = normalizeMimeType(input.mimeType, input.fileName)

  // Extract text for indexing
  const extractedText = await extractText(input.content, normalizedMimeType, input.fileName)
  const extractedTextHash = extractedText ? computeContentHash(extractedText) : null

  // Insert DB record
  const [record] = await db
    .insert(rawFiles)
    .values({
      userId: input.userId,
      workspaceId: input.workspaceId,
      fileName: input.fileName,
      filePath: input.filePath ?? null,
      mimeType: normalizedMimeType,
      fileSize,
      contentHash,
      version,
      previousHash,
      storageKey,
      extractedText,
      extractedTextHash,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef ?? null,
      spaceId: input.spaceId ?? null,
    })
    .returning()

  return record as unknown as RawFileRecord
}

// ─── Retrieve ───────────────────────────────────────────────────────

export async function getRawFile(
  fileId: string
): Promise<{ record: RawFileRecord; content: Buffer } | null> {
  const [record] = await db
    .select()
    .from(rawFiles)
    .where(and(eq(rawFiles.id, fileId), isNull(rawFiles.deletedAt)))
    .limit(1)

  if (!record) return null

  const content = await downloadBuffer(record.storageKey)
  return { record: record as unknown as RawFileRecord, content }
}

export async function getRawFileByName(
  userId: string,
  workspaceId: string,
  fileName: string
): Promise<RawFileRecord | null> {
  const [record] = await db
    .select()
    .from(rawFiles)
    .where(
      and(
        ilike(rawFiles.fileName, `%${fileName}%`),
        eq(rawFiles.userId, userId),
        eq(rawFiles.workspaceId, workspaceId),
        isNull(rawFiles.deletedAt)
      )
    )
    .orderBy(desc(rawFiles.version))
    .limit(1)

  return (record as unknown as RawFileRecord) ?? null
}

export async function getRawFileByHash(contentHash: string): Promise<RawFileRecord | null> {
  const [record] = await db
    .select()
    .from(rawFiles)
    .where(and(eq(rawFiles.contentHash, contentHash), isNull(rawFiles.deletedAt)))
    .limit(1)

  return (record as unknown as RawFileRecord) ?? null
}

// ─── Repair (MCP-FIX-2) ─────────────────────────────────────────────
//
// Files ingested before MIME normalization landed have wrong mime_type values
// (e.g. `.ts` stored as `video/mp2t`) and null `extracted_text`. When read_file
// surfaces such a row, repairRawFileMime downloads the buffer, normalizes the
// MIME, re-runs text extraction, and persists the corrected row + extracted
// text. Returns the repaired record (or the original if no change was needed).

export async function repairRawFileMime(
  record: RawFileRecord,
  content: Buffer
): Promise<RawFileRecord> {
  const fixedMime = normalizeMimeType(record.mimeType, record.fileName)
  const needsMimeFix = fixedMime !== record.mimeType
  const needsTextFix = record.extractedText === null || record.extractedText.length === 0

  if (!needsMimeFix && !needsTextFix) return record

  // Re-run text extraction with the corrected MIME + filename hint. If the
  // file really is binary, extractedText stays null and we still persist the
  // mime fix so downstream consumers stop seeing `video/mp2t` for `.ts`.
  const extractedText = await extractText(content, fixedMime, record.fileName)
  const extractedTextHash = extractedText ? computeContentHash(extractedText) : null

  const updates: Partial<typeof rawFiles.$inferInsert> = {
    mimeType: fixedMime,
    updatedAt: new Date(),
  }
  if (extractedText !== null) {
    updates.extractedText = extractedText
    updates.extractedTextHash = extractedTextHash
  }

  const [updated] = await db
    .update(rawFiles)
    .set(updates)
    .where(eq(rawFiles.id, record.id))
    .returning()

  if (updated) return updated as unknown as RawFileRecord

  // Fallback: returning() may not be supported by every driver — synthesize
  // the post-update view from the inputs.
  void extractedTextHash
  return {
    ...record,
    mimeType: fixedMime,
    extractedText: extractedText ?? record.extractedText,
  }
}

/**
 * Find raw files in a workspace whose MIME type would be corrected by
 * `normalizeMimeType` (i.e. legacy `video/mp2t` for `.ts`, etc.). Used by the
 * MCP-FIX-2 backfill on read_file misses and by an admin repair script.
 */
export async function listRepairCandidates(
  workspaceId: string,
  limit = 50
): Promise<RawFileRecord[]> {
  const rows = await db
    .select()
    .from(rawFiles)
    .where(
      and(
        eq(rawFiles.workspaceId, workspaceId),
        isNull(rawFiles.deletedAt)
      )
    )
    .orderBy(desc(rawFiles.createdAt))
    .limit(limit * 4) // over-fetch then filter in JS

  return rows
    .filter((r) => normalizeMimeType(r.mimeType, r.fileName) !== r.mimeType)
    .slice(0, limit) as unknown as RawFileRecord[]
}

export async function listRawFiles(
  userId: string,
  workspaceId: string,
  opts?: {
    sourceType?: string
    mimeType?: string
    fileNamePattern?: string
    spaceId?: string | null
    limit?: number
    offset?: number
  }
): Promise<RawFileRecord[]> {
  const limit = opts?.limit ?? 50
  const offset = opts?.offset ?? 0

  const conditions = [
    eq(rawFiles.userId, userId),
    eq(rawFiles.workspaceId, workspaceId),
    isNull(rawFiles.deletedAt),
  ]

  if (opts?.sourceType) {
    conditions.push(eq(rawFiles.sourceType, opts.sourceType))
  }
  if (opts?.mimeType) {
    conditions.push(eq(rawFiles.mimeType, opts.mimeType))
  }
  if (opts?.fileNamePattern) {
    conditions.push(ilike(rawFiles.fileName, `%${opts.fileNamePattern}%`))
  }
  // Personal index uses spaceId=null; project index uses spaceId=<uuid>.
  // Callers explicitly pass null to mean "personal only" vs. omitting to
  // mean "across all spaces".
  if (opts?.spaceId === null) {
    conditions.push(isNull(rawFiles.spaceId))
  } else if (opts?.spaceId) {
    conditions.push(eq(rawFiles.spaceId, opts.spaceId))
  }

  const records = await db
    .select()
    .from(rawFiles)
    .where(and(...conditions))
    .orderBy(desc(rawFiles.createdAt))
    .limit(limit)
    .offset(offset)

  return records as unknown as RawFileRecord[]
}

// ─── Text Extraction ────────────────────────────────────────────────

/**
 * File extensions that are always text despite possibly misreported MIME types
 * (e.g. Windows reports .ts as `video/mp2t`, browsers may send empty strings).
 * Keep lowercase — caller lowercases before matching.
 */
const TEXT_FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'jsonc', 'json5',
  'yaml', 'yml', 'toml', 'xml',
  'md', 'mdx', 'markdown', 'rst',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift',
  'c', 'cc', 'cpp', 'cxx', 'h', 'hpp', 'hxx',
  'cs', 'php', 'pl', 'lua', 'r', 'scala', 'sh', 'bash', 'zsh', 'fish',
  'ps1', 'psm1', 'bat', 'cmd',
  'css', 'scss', 'sass', 'less', 'html', 'htm', 'svg',
  'sql', 'graphql', 'gql', 'proto',
  'ini', 'cfg', 'conf', 'env',
  'txt', 'log', 'csv', 'tsv',
])

/**
 * Map known-wrong MIME types (usually driven by OS filetype registries) back
 * to the correct type based on file extension. Idempotent: if the MIME type
 * is already plausible, it is returned unchanged.
 */
export function normalizeMimeType(mimeType: string, fileName?: string): string {
  const ext = fileName ? fileName.toLowerCase().split('.').pop() ?? '' : ''

  // Windows reports .ts as video/mp2t (MPEG Transport Stream) because of the
  // video codec file extension collision. Override for TypeScript source files.
  if ((ext === 'ts' || ext === 'tsx') && (mimeType === 'video/mp2t' || mimeType === 'application/octet-stream' || mimeType === '' || !mimeType)) {
    return 'text/typescript'
  }

  // Fallbacks for common text-like extensions when MIME is missing or generic
  if (!mimeType || mimeType === 'application/octet-stream') {
    if (TEXT_FILE_EXTENSIONS.has(ext)) {
      if (ext === 'json' || ext === 'jsonc' || ext === 'json5') return 'application/json'
      if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'application/javascript'
      if (ext === 'ts' || ext === 'tsx') return 'text/typescript'
      if (ext === 'xml' || ext === 'svg') return 'application/xml'
      if (ext === 'md' || ext === 'mdx' || ext === 'markdown') return 'text/markdown'
      if (ext === 'yaml' || ext === 'yml') return 'text/yaml'
      if (ext === 'csv') return 'text/csv'
      if (ext === 'html' || ext === 'htm') return 'text/html'
      if (ext === 'css') return 'text/css'
      return 'text/plain'
    }
  }

  return mimeType
}

export async function extractText(
  content: Buffer,
  mimeType: string,
  fileName?: string
): Promise<string | null> {
  // Text-based files: read as-is
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/javascript' ||
    mimeType === 'application/typescript' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/x-yaml' ||
    mimeType === 'application/x-sh'
  ) {
    return content.toString('utf-8')
  }

  // Fallback: extension-based detection for MIME types that miss the text
  // heuristic above (e.g. `video/mp2t` for .ts, `application/octet-stream`
  // for files served without a Content-Type).
  if (fileName) {
    const ext = fileName.toLowerCase().split('.').pop() ?? ''
    if (TEXT_FILE_EXTENSIONS.has(ext)) {
      return content.toString('utf-8')
    }
  }

  // PDF — parse the text layer with pdf-parse-fork. Scanned PDFs return empty
  // text here; the OCR fallback in services/doc-intelligence/pdf-ocr.ts is
  // wired separately for that case.
  const isPdf =
    mimeType === 'application/pdf' ||
    (fileName && fileName.toLowerCase().endsWith('.pdf'))
  if (isPdf) {
    try {
      // pdf-parse-fork ships no .d.ts; cast through unknown to keep tsc strict.
      const mod = (await import(
        // @ts-expect-error — no type declarations
        'pdf-parse-fork'
      )) as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }
      const parsed = await mod.default(content)
      const text = (parsed.text ?? '').trim()
      return text.length > 0 ? text : null
    } catch (err) {
      console.error('[extractText] PDF parse failed:', err)
      return null
    }
  }

  // Other binary formats (DOCX, images, etc.) — not yet supported
  return null
}
