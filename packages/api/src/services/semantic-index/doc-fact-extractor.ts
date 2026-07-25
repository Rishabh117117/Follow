/**
 * Doc Fact Extractor (DOC-FACTS-B0)
 *
 * Bridges the native-file indexing pipeline (document_chunks + embeddings) into
 * the semantic-index pipeline (index_records) for NATIVE UPLOADED documents
 * (raw_files.source_type 'upload' | 'local'). It is the document analogue of
 * chat-fact-extractor, with three deliberate differences:
 *
 *   1. It creates a `type:'doc'` thread (vs 'ai'). indexDistilledEvents maps
 *      thread.type==='doc' → sourceType='file', so resolveSourceVersion stamps a
 *      REAL source_version (from raw_files.version) instead of the chat path's
 *      null — documents become version-linked for the first time.
 *   2. Events are `type:'edit'` / `distilledFrom:['document']` (NOT
 *      ai_interaction), so doc facts are correctly NOT flagged AI-involved.
 *   3. Salience-gated (see selectSalientChunks): only chunks at/above an
 *      importance threshold, content-hash-deduped per source file and bounded by
 *      a per-doc cap, become facts. Re-indexing identical content therefore
 *      produces zero new facts — which also closes the blind-append behavior the
 *      chat path has on re-index, for the document case.
 *
 * Routes through the UNCHANGED indexDistilledEvents so facet embeddings, episode
 * assignment, ANALYST edge formation, and live-state capture all run identically
 * to chat/realtime. Called at the end of handleFullIndex when the raw_file is a
 * native document. Failures are non-fatal: the chunk writes are the primary
 * deliverable.
 */
import { and, eq, isNull, inArray, sql } from 'drizzle-orm'
import { db } from '../../db/index'
import { threads, threadEvents, threadSessions } from '../../db/schema/threads'
import { rawFiles } from '../../db/schema/raw-files'
import { indexRecords } from '../../db/schema/semantic-index'
import { indexDistilledEvents, resolveSourceVersion } from './indexer'
import {
  selectSalientChunks,
  docChunkContentHash,
  type DocChunkForIndex,
  type SelectedDocChunk,
} from './doc-salience'

export type { DocChunkForIndex } from './doc-salience'

// magnitude/keyChange derivation — parity with chat-fact-extractor, kept local
// so the chat path stays untouched.
function magnitudeFromImportance(importance: number | null | undefined): 'low' | 'medium' | 'high' {
  if (importance == null) return 'low'
  if (importance >= 0.75) return 'high'
  if (importance >= 0.5) return 'medium'
  return 'low'
}

function labelFromChunk(chunk: DocChunkForIndex): string {
  const summary = (chunk.summary ?? '').trim()
  if (summary.length > 0) return summary.slice(0, 240)
  // Fall back to a short slice of the raw text so the index row has a
  // searchable label even when enrichment produced no summary.
  return chunk.text.trim().replace(/\s+/g, ' ').slice(0, 200)
}

/** The DistilledEvent shape indexDistilledEvents consumes (doc variant). */
export interface DocFactEvent {
  label: string
  type: 'edit'
  magnitude: 'low' | 'medium' | 'high'
  keyChange: boolean
  contextNotes: null
  distilledFrom: string[]
  metadata: Record<string, unknown>
}

/**
 * Pure: turn salient, hashed chunks into the DistilledEvent array (1 per chunk).
 * Exported for unit testing — no DB, no side effects.
 */
export function buildDocFactEvents(selected: SelectedDocChunk[], fileId: string): DocFactEvent[] {
  return selected.map(({ chunk, contentHash }) => ({
    label: labelFromChunk(chunk),
    type: 'edit',
    magnitude: magnitudeFromImportance(chunk.importance),
    keyChange: (chunk.importance ?? 0) >= 0.7,
    contextNotes: null,
    distilledFrom: ['document'],
    metadata: {
      fileId,
      chunkIndex: chunk.chunkIndex,
      sectionTitle: chunk.sectionTitle ?? null,
      // Give buildDocTemplate + the content facet the substantive text so the
      // doc fact's embedding carries the actual document content, not just a
      // summary. Cap at ~4KB — composeEmbeddingText clips to 8000 after joining.
      chunkContent: chunk.text.slice(0, 4000),
      topics: chunk.topics ?? null,
      entities: chunk.entities ?? null,
      // DOC-FACTS-B0: per-chunk content hash — the dedup key for identical
      // re-index (read back from existing facts in selectSalientChunks).
      docChunkHash: contentHash,
    },
  }))
}

/** Find-or-create the canonical 'doc' thread for a native file (one per fileId). */
async function ensureDocThread(params: {
  fileId: string
  workspaceId: string
  userId: string
  documentTitle: string
}): Promise<string> {
  const existing = await db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.workspaceId, params.workspaceId),
        eq(threads.type, 'doc'),
        sql`${threads.metadata}->>'fileId' = ${params.fileId}`
      )
    )
    .limit(1)
  if (existing[0]) return existing[0].id

  const [row] = await db
    .insert(threads)
    .values({
      workspaceId: params.workspaceId,
      ownerId: params.userId,
      type: 'doc',
      name: `Doc: ${params.documentTitle.slice(0, 120)}`,
      metadata: {
        // documentId resolution reads metadata.fileId (indexer.ts:213); a real
        // raw_files.id here lets resolveSourceVersion stamp raw_files.version.
        fileId: params.fileId,
        documentTitle: params.documentTitle,
        fileName: params.documentTitle,
        importSource: 'doc-fact-extractor',
      },
    })
    .returning({ id: threads.id })
  if (!row) throw new Error('Failed to create thread for document')
  return row.id
}

/**
 * Existing live (non-deleted) doc facts already indexed for this file, with their
 * per-chunk content hash + record id. Drives the salience dedup `seen` set AND the
 * VERSION-B1 carry-forward (re-stamp facts whose content is still present).
 * Superseded facts ARE included (no superseded filter) so reappearing content
 * REVIVES the existing fact via carry-forward instead of inserting a duplicate.
 */
export interface ExistingDocFact {
  id: string
  hash: string
  sourceVersion: number | null
  supersededAt: Date | null
}

async function existingDocFacts(workspaceId: string, fileId: string): Promise<ExistingDocFact[]> {
  const rows = await db
    .select({
      id: indexRecords.id,
      metadata: indexRecords.metadata,
      sourceVersion: indexRecords.sourceVersion,
      supersededAt: indexRecords.supersededAt,
    })
    .from(indexRecords)
    .where(
      and(
        eq(indexRecords.workspaceId, workspaceId),
        eq(indexRecords.sourceFileId, fileId),
        isNull(indexRecords.deletedAt)
      )
    )
  const out: ExistingDocFact[] = []
  for (const r of rows) {
    const h = (r.metadata as Record<string, unknown> | null)?.['docChunkHash']
    if (typeof h === 'string')
      out.push({ id: r.id, hash: h, sourceVersion: r.sourceVersion, supersededAt: r.supersededAt })
  }
  return out
}

/**
 * Pure: decide, for a re-sync of one file at `newVersion`, which existing facts to
 * CARRY FORWARD (their content is still present in the new document version → keep
 * them live, re-stamped to N) and which to SUPERSEDE (their content is gone and
 * they belong to an older version → retire them). Disjoint id sets; brand-new
 * content is inserted separately. No DB — unit-testable.
 *
 *  - content still present (hash ∈ incoming): carry forward, unless the fact is
 *    already exactly current (version === N AND not superseded) — then it's a no-op.
 *  - content gone (hash ∉ incoming) AND a strictly-older version AND not already
 *    superseded: supersede. (Unversioned facts are left untouched — we can't
 *    version-reason about them.)
 */
export function planDocSupersession(
  existing: ExistingDocFact[],
  incomingHashes: Set<string>,
  newVersion: number
): { carryForwardIds: string[]; supersededIds: string[] } {
  const carryForwardIds: string[] = []
  const supersededIds: string[] = []
  for (const f of existing) {
    if (incomingHashes.has(f.hash)) {
      if (f.sourceVersion !== newVersion || f.supersededAt != null) carryForwardIds.push(f.id)
    } else if (f.sourceVersion != null && f.sourceVersion < newVersion && f.supersededAt == null) {
      supersededIds.push(f.id)
    }
  }
  return { carryForwardIds, supersededIds }
}

export async function extractAndIndexDocFacts(params: {
  fileId: string
  workspaceId: string
  userId: string
  chunks: DocChunkForIndex[]
}): Promise<{
  factsIndexed: number
  threadId: string
  sessionId: string
  droppedLowSalience: number
  droppedDuplicate: number
  droppedOverCap: number
  carriedForward: number
  superseded: number
} | null> {
  if (params.chunks.length === 0) return null

  // Title from the raw_file (mirrors chat extractor's conversation-title lookup).
  const [raw] = await db
    .select({ fileName: rawFiles.fileName })
    .from(rawFiles)
    .where(eq(rawFiles.id, params.fileId))
    .limit(1)
  const documentTitle = raw?.fileName ?? 'Untitled document'

  // VERSION-B1: this pass's source_version for the file (the SAME resolver the
  // indexer stamps new facts with). `null` → unversioned file: skip carry-forward
  // + sweep entirely (we can't reason about which facts are stale) and keep pure
  // B-0 append behavior.
  const { sourceVersion: newVersion } = await resolveSourceVersion('file', params.fileId, '')

  // Existing facts for this file (including any already superseded), with their
  // per-chunk content hashes. Drives the salience dedup AND the carry-forward.
  const existing = await existingDocFacts(params.workspaceId, params.fileId)
  const seen = new Set(existing.map((f) => f.hash))

  // Salience gate: importance threshold → content-hash dedup (vs already-indexed
  // facts for this file) → per-doc cap. Nothing is written for dropped chunks.
  const { selected, droppedLowSalience, droppedDuplicate, droppedOverCap } = selectSalientChunks(
    params.chunks,
    seen
  )

  // ── VERSION-B1 plan + carry-forward ───────────────────────────────────────
  // Decide which existing facts survive (content still present → re-stamp to N,
  // revive if previously superseded) vs are retired (content gone, older version).
  // Carry-forward runs BEFORE the new-fact insert + sweep; the three id sets are
  // disjoint (still-present / brand-new / removed).
  let carriedForward = 0
  let supersededIds: string[] = []
  if (newVersion != null) {
    const incomingHashes = new Set(params.chunks.map((c) => docChunkContentHash(c.text)))
    const plan = planDocSupersession(existing, incomingHashes, newVersion)
    supersededIds = plan.supersededIds
    if (plan.carryForwardIds.length > 0) {
      await db
        .update(indexRecords)
        .set({ sourceVersion: newVersion, supersededAt: null })
        .where(inArray(indexRecords.id, plan.carryForwardIds))
      carriedForward = plan.carryForwardIds.length
    }
  }

  // ── Insert genuinely-new facts (unchanged B-0 path) ───────────────────────
  let threadId = ''
  let sessionId = ''
  let factsIndexed = 0
  if (selected.length > 0) {
    threadId = await ensureDocThread({
      fileId: params.fileId,
      workspaceId: params.workspaceId,
      userId: params.userId,
      documentTitle,
    })

    // A fresh session per indexing pass — indexDistilledEvents scopes its
    // thread_event lookup by sessionId.
    const [session] = await db
      .insert(threadSessions)
      .values({
        threadId,
        status: 'complete',
        rawSignalCount: selected.length,
        distilledEventCount: selected.length,
        lastProcessedAt: new Date(),
      })
      .returning({ id: threadSessions.id })
    if (!session) throw new Error('Failed to create thread session')
    sessionId = session.id

    const factEvents = buildDocFactEvents(selected, params.fileId)
    const eventsToInsert = factEvents.map((e) => ({ threadId, sessionId, ...e }))
    await db.insert(threadEvents).values(eventsToInsert)

    // Hand off to the existing indexer (unchanged) — facet embeddings, episode
    // assignment, ANALYST links, and live-state capture all run the same way. The
    // new facts are stamped at `newVersion` by resolveSourceVersion.
    await indexDistilledEvents(factEvents, threadId, sessionId, params.workspaceId)
    factsIndexed = factEvents.length
  }

  // ── VERSION-B1 sweep ──────────────────────────────────────────────────────
  // Retire the facts whose content is gone from this version (computed above).
  // Excluded from current retrieval, kept for audit / point-in-time. `now()` via
  // sql avoids binding a JS Date (DATE-BIND-1).
  let superseded = 0
  if (supersededIds.length > 0) {
    await db
      .update(indexRecords)
      .set({ supersededAt: sql`now()` })
      .where(inArray(indexRecords.id, supersededIds))
    superseded = supersededIds.length
  }

  return {
    factsIndexed,
    threadId,
    sessionId,
    droppedLowSalience,
    droppedDuplicate,
    droppedOverCap,
    carriedForward,
    superseded,
  }
}
