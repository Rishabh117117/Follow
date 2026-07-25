/**
 * Semantic Indexer Service (Sprint IX-1)
 *
 * Core pipeline called after every distillation cycle to index new events.
 * Steps: dedup → compose text → embed → assign episode → insert → detect links
 *
 * CRITICAL: Indexing failure must NEVER block the distillation pipeline.
 * All operations are wrapped in try-catch with non-fatal error handling.
 */

import { db } from '../../db/index'
import { eq, and, desc, gt, sql } from 'drizzle-orm'
import { threads, threadEvents } from '../../db/schema/threads'
import { users } from '../../db/schema/users'
import { fileVersions } from '../../db/schema/files'
import { rawFiles } from '../../db/schema/raw-files'
import { indexRecords, semanticLinks, episodes, gwsSnapshots } from '../../db/schema/semantic-index'
import { generateEmbeddings, hasEmbeddingSupport } from '../embedding'
import {
  composeEmbeddingText,
  mapMagnitude,
  composeContentFacet,
  composeCausalFacet,
  composeContextFacet,
} from './compose-embedding-text'
import { cosineSimilarity } from './weighted-referencing'
import { isContradictionCandidate, type FacetSimilarity } from '../pipeline/facet-signal'
import { captureEvidence, detectSourceIntroductions } from './evidence-capture'
import { computeContentHash } from './content-hash'
import { isServerFeatureActive } from '../../config/server-vault'
import {
  writeAnchorsForRecords,
  mapArtifactType,
  spanForArtifact,
  type BuildAnchorInput,
} from '../pipeline/anchor-writer'
import { randomUUID } from 'node:crypto'

// ─── Types ───────────────────────────────────────────────────────────────────

interface DistilledEvent {
  label: string
  type: string
  magnitude: string
  keyChange: boolean
  contextNotes?: string | null
  distilledFrom?: string[]
  metadata: Record<string, unknown>
}

// ─── Constants ───────────────────────────────────────────────────────────────

const EPISODE_GAP_MINUTES = 30
const LINK_SIMILARITY_THRESHOLD_CROSS = 0.65
const LINK_SIMILARITY_THRESHOLD_SAME = 0.55
const MAX_LINK_CANDIDATES = 20
// ANALYST-ON-1 (FIX-2a): bounded concurrency for ANALYST edge classification
// in the index hot path. Worst case is inserted × MAX_LINK_CANDIDATES pairs;
// running them sequentially added tens of seconds per record at ~1–3 s/call.
const ANALYST_CONCURRENCY = 5

// ─── Version Linking (Sprint IX-8) ───────────────────────────────────────────

type SourceType = 'file' | 'chat' | 'notebook' | 'external'

interface SourceVersionInfo {
  sourceFileId: string | null
  sourceVersion: number | null
  sourceContentHash: string
}

/**
 * Resolve source version info for version-linking.
 * Looks up the latest file version when `sourceType === 'file'`;
 * chat/notebook/external return null version (no formal version scheme yet).
 * Always returns a content hash derived from the provided content.
 */
// VERSION-B1: exported so the doc-fact extractor resolves a file's source_version
// with the EXACT same logic the indexer stamps at insert time (no drift between
// the version a fact is written with and the version the supersession sweep keys on).
export async function resolveSourceVersion(
  sourceType: SourceType,
  sourceId: string | null,
  content: string
): Promise<SourceVersionInfo> {
  const sourceContentHash = computeContentHash(content)

  if (!sourceId) {
    return { sourceFileId: null, sourceVersion: null, sourceContentHash }
  }

  if (sourceType === 'file') {
    try {
      const [latest] = await db
        .select({ versionNumber: fileVersions.versionNumber })
        .from(fileVersions)
        .where(eq(fileVersions.fileId, sourceId))
        .orderBy(desc(fileVersions.versionNumber))
        .limit(1)
      if (latest) {
        return { sourceFileId: sourceId, sourceVersion: latest.versionNumber, sourceContentHash }
      }
      // DOC-FACTS-B0: native uploaded documents have no file_versions row — they
      // live in raw_files, whose own `version` chain + content-addressed
      // contentHash is the authoritative source version. Fall back to it so doc
      // facts get a real source_version (file-manager files still win above).
      // id spaces don't collide (both random UUIDs), so this is a safe fallback.
      const [rawFile] = await db
        .select({ version: rawFiles.version, contentHash: rawFiles.contentHash })
        .from(rawFiles)
        .where(eq(rawFiles.id, sourceId))
        .limit(1)
      if (rawFile) {
        return {
          sourceFileId: sourceId,
          sourceVersion: rawFile.version,
          sourceContentHash: rawFile.contentHash,
        }
      }
      return { sourceFileId: sourceId, sourceVersion: null, sourceContentHash }
    } catch {
      return { sourceFileId: sourceId, sourceVersion: null, sourceContentHash }
    }
  }

  if (sourceType === 'external') {
    // Sprint IX-9: GWS documents have their own versioned history in gws_snapshots.
    // Look up the latest snapshot for this external doc and use its version + hash.
    try {
      const [latest] = await db
        .select({
          version: gwsSnapshots.version,
          contentHash: gwsSnapshots.contentHash,
        })
        .from(gwsSnapshots)
        .where(eq(gwsSnapshots.externalDocId, sourceId))
        .orderBy(desc(gwsSnapshots.version))
        .limit(1)
      if (latest) {
        return {
          sourceFileId: sourceId,
          sourceVersion: latest.version,
          // Prefer the stored snapshot hash — it's the authoritative
          // "what was the doc when this index record was built" value.
          sourceContentHash: latest.contentHash,
        }
      }
    } catch {
      // fall through to hash-only
    }
    return { sourceFileId: sourceId, sourceVersion: null, sourceContentHash }
  }

  // chat: append-only conversations, no version number
  // notebook: no formal version scheme yet
  return { sourceFileId: sourceId, sourceVersion: null, sourceContentHash }
}

// ─── AI Involvement Detection ────────────────────────────────────────────────

function detectAIInvolvement(event: DistilledEvent): boolean {
  if (event.type === 'ai_interaction') return true
  const from = event.distilledFrom ?? []
  return (
    from.includes('ai_turn_native') ||
    from.includes('ai_turn_external') ||
    from.includes('doc_suggestion_accepted') ||
    from.includes('doc_suggestion_rejected')
  )
}

// ─── Link Type Classification ────────────────────────────────────────────────

function classifyLinkType(sourceType: string, targetType: string, sameUser: boolean): string {
  // Cross-type patterns
  if (sourceType === 'browser' && targetType === 'doc') return 'cause_effect'
  if (sourceType === 'ai' && targetType === 'doc') return 'cause_effect'
  if (sourceType === 'doc' && targetType === 'ai') return 'reference'

  // Same-type patterns
  if (sourceType === targetType) {
    if (!sameUser) return 'parallel'
    return 'continuation'
  }

  return 'reference'
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Index a batch of newly distilled events into the semantic index.
 * Called by the realtime scheduler after thread_events are inserted.
 */
export async function indexDistilledEvents(
  events: DistilledEvent[],
  threadId: string,
  sessionId: string,
  workspaceId: string
): Promise<void> {
  if (events.length === 0) return
  if (!hasEmbeddingSupport()) {
    console.warn('[SemanticIndex] Embedding not configured, skipping indexing')
    return
  }

  // 1. Fetch thread context (type, owner, document info)
  const [thread] = await db
    .select({
      id: threads.id,
      type: threads.type,
      ownerId: threads.ownerId,
      name: threads.name,
      metadata: threads.metadata,
    })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1)

  if (!thread) {
    console.warn(`[SemanticIndex] Thread ${threadId} not found, skipping`)
    return
  }

  // 2. Fetch user name
  const [user] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, thread.ownerId))
    .limit(1)

  const threadMeta = thread.metadata as Record<string, unknown> | null
  const documentId = (threadMeta?.fileId as string) ?? (threadMeta?.documentId as string) ?? null
  const documentTitle =
    (threadMeta?.documentTitle as string) ?? (threadMeta?.fileName as string) ?? thread.name

  // 3. Find matching thread_events (recently inserted by the scheduler)
  const recentEvents = await db
    .select()
    .from(threadEvents)
    .where(and(eq(threadEvents.threadId, threadId), eq(threadEvents.sessionId, sessionId)))
    .orderBy(desc(threadEvents.createdAt))
    .limit(events.length * 2) // fetch extra to ensure we cover all

  // Match distilled events to DB records by label (best-effort)
  const matchedEvents = matchEventsToRecords(events, recentEvents)

  if (matchedEvents.length === 0) {
    console.warn('[SemanticIndex] No events matched to DB records, skipping')
    return
  }

  // 4. Check for duplicates
  const eventIds = matchedEvents.map((m) => m.dbEvent.id)
  const existing = await db
    .select({ threadEventId: indexRecords.threadEventId })
    .from(indexRecords)
    .where(
      sql`${indexRecords.threadEventId} IN (${sql.join(
        eventIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    )

  const existingSet = new Set(existing.map((e) => e.threadEventId))
  const newEvents = matchedEvents.filter((m) => !existingSet.has(m.dbEvent.id))

  if (newEvents.length === 0) return

  // 5. Compose embedding texts
  const composedTexts = newEvents.map((m) =>
    composeEmbeddingText({
      event: {
        label: m.distilled.label,
        type: m.distilled.type,
        magnitude: m.distilled.magnitude,
        keyChange: m.distilled.keyChange,
        contextNotes: m.distilled.contextNotes ?? null,
        metadata: m.distilled.metadata,
      },
      threadType: thread.type,
      userName: user?.name ?? null,
      documentTitle,
      sectionAlias: (m.distilled.metadata?.sectionTitle as string) ?? null,
    })
  )

  // 6. Generate embeddings in batch (main + facets)
  let embeddings: number[][]

  // Compose facet texts (Sprint IX-7)
  const composeInputs = newEvents.map((m) => ({
    event: {
      label: m.distilled.label,
      type: m.distilled.type,
      magnitude: m.distilled.magnitude,
      keyChange: m.distilled.keyChange,
      contextNotes: m.distilled.contextNotes ?? null,
      metadata: m.distilled.metadata,
    },
    threadType: thread.type,
    userName: user?.name ?? null,
    documentTitle,
    sectionAlias: (m.distilled.metadata?.sectionTitle as string) ?? null,
  }))
  const contentTexts = composeInputs.map(composeContentFacet)
  const causalTexts = composeInputs.map(composeCausalFacet)
  const contextTexts = composeInputs.map(composeContextFacet)

  let contentEmbeddings: (number[] | null)[] = []
  let causalEmbeddings: (number[] | null)[] = []
  let contextEmbeddings: (number[] | null)[] = []

  try {
    // Generate main + facet embeddings in parallel. FACET-FIX-1: facets embed
    // SPARSELY — only non-empty texts are sent and results scatter back, so an
    // empty facet (e.g. a record with no genuine WHY) stores NULL instead of a
    // garbage embedding of "".
    const [main, content, causal, context] = await Promise.all([
      generateEmbeddings(composedTexts),
      embedFacetSparse(contentTexts, 768),
      embedFacetSparse(causalTexts, 512),
      embedFacetSparse(contextTexts, 512),
    ])
    embeddings = main
    contentEmbeddings = content
    causalEmbeddings = causal
    contextEmbeddings = context
  } catch (err) {
    console.error('[SemanticIndex] Embedding generation failed:', err)
    return
  }

  // 7. Assign episodes and build insert records
  // Sprint IX-8: also resolve version info per record for version-linking.
  // Thread type → source type mapping: doc → file, ai → chat, import → external,
  // everything else is treated as external (no version linkage).
  const sourceType: SourceType =
    thread.type === 'doc' ? 'file' : thread.type === 'ai' ? 'chat' : 'external'

  const insertValues = await Promise.all(
    newEvents.map(async (m, i) => {
      const episodeId = await assignEpisode(threadId, workspaceId, m.dbEvent.time)
      const isAI = detectAIInvolvement(m.distilled)
      const versionInfo = await resolveSourceVersion(sourceType, documentId, composedTexts[i] ?? '')

      return {
        workspaceId,
        threadId,
        threadEventId: m.dbEvent.id,
        threadType: thread.type,
        embedding: embeddings[i] ?? [],
        embeddingText: composedTexts[i] ?? '',
        embeddingContent: contentEmbeddings[i] ?? null,
        embeddingCausal: causalEmbeddings[i] ?? null,
        embeddingContext: contextEmbeddings[i] ?? null,
        indexMagnitude: mapMagnitude(m.distilled.magnitude),
        isKeyChange: m.distilled.keyChange,
        isAIInvolved: isAI,
        hasEvidence: false,
        engagementDepth: 0,
        episodeId,
        documentId,
        documentTitle,
        sectionAlias: (m.distilled.metadata?.sectionTitle as string) ?? null,
        userId: thread.ownerId,
        userName: user?.name ?? null,
        eventTime: m.dbEvent.time,
        metadata: {
          ...(m.distilled.metadata ?? {}),
          ...(sourceType === 'chat' && m.distilled.metadata?.chat_source_type
            ? { chatSourceType: m.distilled.metadata.chat_source_type }
            : {}),
        },
        // Sprint IX-8: version-linking
        sourceFileId: versionInfo.sourceFileId,
        sourceVersion: versionInfo.sourceVersion,
        sourceContentHash: versionInfo.sourceContentHash,
        indexedAt: new Date(),
      }
    })
  )

  // 8. Batch insert index records
  const inserted = await db.insert(indexRecords).values(insertValues).returning({
    id: indexRecords.id,
    threadEventId: indexRecords.threadEventId,
    episodeId: indexRecords.episodeId,
  })

  // Sprint IX-10: capture initial live state for each new record.
  // Fire-and-forget — indexing must never fail because of state capture.
  // Dynamic import avoids any circular-dependency hazard with semantic-index.
  try {
    const { batchCaptureInitialStates } = await import('./state-capture')
    const insertedIds = inserted.map((r) => r.id)
    batchCaptureInitialStates(insertedIds, 'indexer').catch((err) => {
      console.warn('[SemanticIndex] Batch state capture failed (non-fatal):', err)
    })
  } catch (err) {
    console.warn('[SemanticIndex] State capture import failed (non-fatal):', err)
  }

  // Sprint SH-3: trigger live-slice sync for any slices whose scope matches
  // the newly indexed records. Fire-and-forget — indexing must not block
  // on sync fan-out. All records in this batch share the same documentId
  // (derived from the thread), so a single-element documentIds array is
  // sufficient for the scope check.
  try {
    const { triggerSyncForNewRecords } = await import('../sharing/sync-trigger')
    triggerSyncForNewRecords({
      workspaceId,
      userId: thread.ownerId,
      documentIds: [documentId],
    }).catch((err) => {
      console.warn('[SemanticIndex] Sync trigger failed (non-fatal):', err)
    })
  } catch (err) {
    console.warn('[SemanticIndex] Sync trigger import failed (non-fatal):', err)
  }

  // 9. Update episode record counts
  const episodeCounts = new Map<string, number>()
  for (const rec of inserted) {
    if (rec.episodeId) {
      episodeCounts.set(rec.episodeId, (episodeCounts.get(rec.episodeId) ?? 0) + 1)
    }
  }
  for (const [epId, count] of episodeCounts) {
    await db
      .update(episodes)
      .set({
        recordCount: sql`${episodes.recordCount} + ${count}`,
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, epId))
  }

  // 10. Detect and insert semantic links (non-blocking)
  const linkValues = insertValues.map((v) => ({
    threadId: v.threadId,
    userId: v.userId,
    threadType: v.threadType as string,
    embedding: v.embedding ?? [],
    // EDGE-FACET-1: carry the new record's per-facet embeddings into link
    // detection so it can compute per-facet cosines, not just the composite.
    embeddingContent: v.embeddingContent ?? null,
    embeddingCausal: v.embeddingCausal ?? null,
    embeddingContext: v.embeddingContext ?? null,
    // ANALYST-ON-1 (FIX-1): carry the new record's text + identity so the
    // ANALYST sees BOTH sides of the pair (not just the candidate). Symmetric
    // with the candidate fields already supplied from the index_records row.
    embeddingText: v.embeddingText ?? '',
    documentTitle: v.documentTitle ?? null,
    userName: v.userName ?? null,
    eventTime: v.eventTime ?? null,
    metadata: v.metadata as Record<string, unknown> | null,
  }))
  detectAndInsertLinks(inserted, linkValues, embeddings, workspaceId).catch((err) =>
    console.warn('[SemanticIndex] Link detection failed (non-fatal):', err)
  )

  // ANCHOR-1 (gated by `node-anchors`): write an anchor per inserted record
  // alongside the legacy index_records row, embedding the meaning gloss across
  // the three facets. Flag off ⇒ this block is skipped entirely, so the
  // pipeline stays byte-identical. Non-fatal.
  if (isServerFeatureActive('node-anchors')) {
    try {
      const artifactType = mapArtifactType(thread.type)
      const anchorInputs: BuildAnchorInput[] = []
      for (let i = 0; i < inserted.length; i++) {
        const rec = inserted[i]
        const v = insertValues[i]
        if (!rec || !v) continue
        const meaningText = v.embeddingText ?? ''
        if (!meaningText.trim()) continue
        anchorInputs.push({
          id: randomUUID(),
          workspaceId,
          indexRecordId: rec.id,
          artifact: { id: documentId ?? threadId, type: artifactType },
          span: spanForArtifact(artifactType, {
            messageId: rec.threadEventId,
            threadId,
            textLength: meaningText.length,
            sectionAlias: v.sectionAlias ?? undefined,
          }),
          meaningText,
          addedBy: 'reporter',
          addedAt: v.eventTime?.toISOString?.() ?? new Date().toISOString(),
          facets: {
            content: contentEmbeddings[i] ?? null,
            causal: causalEmbeddings[i] ?? null,
            context: contextEmbeddings[i] ?? null,
          },
        })
      }
      await writeAnchorsForRecords(db, anchorInputs)
    } catch (err) {
      console.warn('[SemanticIndex] Anchor write failed (non-fatal):', err)
    }
  }

  // 11. Capture evidence (non-blocking)
  const insertedRecords = inserted.map((ins, i) => {
    const val = insertValues[i]!
    return {
      id: ins.id,
      workspaceId: val.workspaceId,
      threadType: val.threadType as string,
      indexMagnitude: val.indexMagnitude,
      isKeyChange: val.isKeyChange,
      isAIInvolved: val.isAIInvolved,
      documentId: val.documentId,
      sectionAlias: val.sectionAlias,
      userId: val.userId,
      embeddingText: val.embeddingText,
      metadata: val.metadata as Record<string, unknown>,
      // Sprint IX-8: version refs for evidence capture
      sourceFileId: val.sourceFileId,
      sourceVersion: val.sourceVersion,
      sourceContentHash: val.sourceContentHash,
    }
  })
  captureEvidence(
    insertedRecords,
    newEvents.map((m) => m.dbEvent),
    workspaceId
  ).catch((err) => console.warn('[SemanticIndex] Evidence capture failed (non-fatal):', err))

  // 12. Detect source introductions — browse → edit chains (non-blocking)
  detectSourceIntroductions(insertedRecords, workspaceId).catch((err) =>
    console.warn('[SemanticIndex] Source detection failed (non-fatal):', err)
  )

  // 13. Reflect on significant events + update AI state (Sprint IX-5, replaces IX-4 plain update)
  try {
    const { reflectOnEvent } = await import('../ai-state/reflector')
    const { updateStateFromEventsWithReflections } = await import('../ai-state/event-updater')
    type ReflectionOutput = Awaited<ReturnType<typeof reflectOnEvent>>

    // Get the thread owner's userId
    const thread = await db
      .select({ ownerId: threads.ownerId })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1)

    if (thread[0]) {
      const ownerId = thread[0].ownerId

      // Reflect on medium+ magnitude or key change events
      const reflections = new Map<string, NonNullable<ReflectionOutput>>()
      for (const record of insertedRecords) {
        const eventIdx = insertedRecords.indexOf(record)
        const event = events[eventIdx]
        if (!event) continue

        // Only reflect on medium+ magnitude or key changes
        if (event.magnitude === 'tiny' || event.magnitude === 'small') {
          if (!event.keyChange) continue
        }

        const reflection = await reflectOnEvent({
          event: {
            eventId: record.id,
            label: event.label,
            type: event.type,
            section:
              typeof record.metadata?.sectionRef === 'string'
                ? record.metadata.sectionRef
                : ((record.metadata?.sectionRef as { heading?: string })?.heading ?? null),
            threadType: record.threadType,
            timestamp: new Date().toISOString(),
            isKeyChange: event.keyChange || false,
            isAIInvolved: record.isAIInvolved || false,
            contextNotes: event.contextNotes || null,
            magnitude: event.magnitude,
          },
          userId: ownerId,
          workspaceId,
          documentId: (record.metadata?.documentId as string) ?? null,
          documentTitle: (record.metadata?.documentTitle as string) ?? null,
        })

        if (reflection) {
          reflections.set(record.id, reflection)
        }
      }

      // Build indexed events with reflections
      const indexedEvents = insertedRecords.map((record, i) => ({
        eventId: record.id,
        label: events[i]?.label || '',
        type: events[i]?.type || '',
        section:
          typeof record.metadata?.sectionRef === 'string'
            ? record.metadata.sectionRef
            : ((record.metadata?.sectionRef as { heading?: string })?.heading ?? null),
        threadType: record.threadType,
        timestamp: new Date().toISOString(),
        isKeyChange: record.isKeyChange || false,
        isAIInvolved: record.isAIInvolved || false,
        documentId: (record.metadata?.documentId as string) ?? null,
        documentTitle: (record.metadata?.documentTitle as string) ?? null,
        episodeId: (record.metadata?.episodeId as string) ?? null,
        reflection: reflections.get(record.id) || null,
      }))

      await updateStateFromEventsWithReflections(ownerId, workspaceId, indexedEvents)

      // Update shared document state for events on shared documents (Sprint IX-6)
      try {
        const { updateSharedStateFromEvents, isSharedDocument } =
          await import('../ai-state/shared-state-updater')
        const { users: usersTable } = await import('../../db/schema/index')

        const user = await db
          .select({ name: usersTable.name })
          .from(usersTable)
          .where(eq(usersTable.id, ownerId))
          .limit(1)
        const ownerName = user[0]?.name || 'Unknown'

        // Group events by documentId
        const eventsByDocument = new Map<string, typeof indexedEvents>()
        for (const event of indexedEvents) {
          if (!event.documentId) continue
          const existing = eventsByDocument.get(event.documentId) || []
          existing.push(event)
          eventsByDocument.set(event.documentId, existing)
        }

        for (const [docId, docEvents] of eventsByDocument) {
          const shared = await isSharedDocument(docId, workspaceId)
          if (!shared) continue

          const sharedEvents = docEvents.map((e) => ({
            eventId: e.eventId,
            label: e.label,
            type: e.type,
            section: e.section,
            threadType: e.threadType,
            timestamp: e.timestamp,
            isKeyChange: e.isKeyChange,
            isAIInvolved: e.isAIInvolved,
            magnitude: 'medium',
            userId: ownerId,
            userName: ownerName,
            documentId: docId,
            documentTitle: e.documentTitle,
            wordsDelta: 0,
            reflection: reflections.get(e.eventId)
              ? {
                  tension: reflections.get(e.eventId)!.tension,
                  knowledge: reflections.get(e.eventId)!.knowledge,
                }
              : null,
          }))

          await updateSharedStateFromEvents(docId, workspaceId, sharedEvents)
        }
      } catch (err) {
        console.warn('[Indexer] Shared state update failed (non-blocking):', err)
      }
    }
  } catch (err) {
    console.warn('[AIState] Event state update with reflection failed (non-blocking):', err)
  }
}

// ─── Episode Assignment ──────────────────────────────────────────────────────

async function assignEpisode(
  threadId: string,
  workspaceId: string,
  eventTime: Date
): Promise<string> {
  const cutoff = new Date(eventTime.getTime() - EPISODE_GAP_MINUTES * 60 * 1000)

  // Check for recent open episode on this thread
  const [recentEpisode] = await db
    .select()
    .from(episodes)
    .where(
      and(
        eq(episodes.threadId, threadId),
        eq(episodes.status, 'open'),
        gt(episodes.updatedAt, cutoff)
      )
    )
    .orderBy(desc(episodes.updatedAt))
    .limit(1)

  if (recentEpisode) {
    return recentEpisode.id
  }

  // Create new episode
  const [newEpisode] = await db
    .insert(episodes)
    .values({
      workspaceId,
      threadId,
      status: 'open',
      startedAt: eventTime,
      recordCount: 0,
    })
    .returning({ id: episodes.id })

  return newEpisode!.id
}

// ─── Event Matching ──────────────────────────────────────────────────────────

interface MatchedEvent {
  distilled: DistilledEvent
  dbEvent: {
    id: string
    time: Date
    label: string
    type: string
    magnitude: string
    keyChange: boolean
    contextNotes: string | null
    metadata: Record<string, unknown>
  }
}

function matchEventsToRecords(
  distilled: DistilledEvent[],
  dbRecords: (typeof threadEvents.$inferSelect)[]
): MatchedEvent[] {
  const matched: MatchedEvent[] = []
  const usedRecords = new Set<string>()

  for (const event of distilled) {
    // Find best matching DB record by label
    const match = dbRecords.find(
      (r) => !usedRecords.has(r.id) && r.label === event.label && r.type === event.type
    )
    if (match) {
      usedRecords.add(match.id)
      matched.push({
        distilled: event,
        dbEvent: {
          id: match.id,
          time: match.time,
          label: match.label,
          type: match.type,
          magnitude: match.magnitude,
          keyChange: match.keyChange,
          contextNotes: match.contextNotes,
          metadata: (match.metadata as Record<string, unknown>) ?? {},
        },
      })
    }
  }

  return matched
}

// ─── Link Detection ──────────────────────────────────────────────────────────

// Exported for ANALYST-ON-1 unit tests (FIX-1 both-texts assertion); the
// production caller is `detectAndInsertLinks(...)` inside the indexer body.
export async function detectAndInsertLinks(
  inserted: { id: string; threadEventId: string }[],
  values: {
    threadId: string
    userId: string
    threadType: string
    embedding: number[]
    embeddingContent?: number[] | null
    embeddingCausal?: number[] | null
    embeddingContext?: number[] | null
    // ANALYST-ON-1 (FIX-1): the new record's own text + identity, for the
    // ANALYST `b` side. Optional so non-analyst callers/tests stay valid.
    embeddingText?: string | null
    documentTitle?: string | null
    userName?: string | null
    eventTime?: Date | null
    metadata?: Record<string, unknown> | null
  }[],
  embeddings: number[][],
  workspaceId: string
): Promise<void> {
  if (inserted.length === 0) return

  // Fetch recent records from the same workspace for comparison
  const cutoff = new Date(Date.now() - 60 * 60 * 1000) // last hour
  const candidates = await db
    .select()
    .from(indexRecords)
    .where(
      and(
        eq(indexRecords.workspaceId, workspaceId),
        gt(indexRecords.eventTime, cutoff),
        // Don't link to tombstoned records — they shouldn't influence new edges.
        sql`${indexRecords.deletedAt} IS NULL`
      )
    )
    .orderBy(desc(indexRecords.eventTime))
    .limit(MAX_LINK_CANDIDATES)

  // Exclude just-inserted records
  const insertedIds = new Set(inserted.map((i) => i.id))
  const existingCandidates = candidates.filter((c) => !insertedIds.has(c.id))

  if (existingCandidates.length === 0) return

  // Pipeline-analyst-llm flag (2026-04-29). When ON, every cosine-near pair
  // gets routed through the canonical Analyst LLM (MODEL_TIERS.ANALYST). When
  // OFF, the legacy heuristic in classifyLinkType still runs.
  const { isServerFeatureActive } = await import('../../config/server-vault')
  const useAnalystLLM = isServerFeatureActive('pipeline-analyst-llm')
  const classifyEdgeFn = useAnalystLLM ? (await import('../pipeline/analyst')).classifyEdge : null

  const links: {
    workspaceId: string
    sourceRecordId: string
    targetRecordId: string
    similarity: number
    linkType: string
    crossUser: boolean
    metadata?: Record<string, unknown>
  }[] = []

  // ANALYST-ON-1 (FIX-2a): collect every qualifying (new × candidate) pair
  // first, then classify. The heuristic path builds links inline (cheap, no
  // I/O); the ANALYST path runs classifyEdge with bounded concurrency rather
  // than awaiting each call sequentially inside nested loops.
  interface QualifyingPair {
    candidate: (typeof existingCandidates)[number]
    newVal: (typeof values)[number]
    newId: string
    sim: number
    facetSimilarity: FacetSimilarity | undefined
    crossUser: boolean
  }
  const qualifying: QualifyingPair[] = []

  for (let i = 0; i < inserted.length; i++) {
    const ins = inserted[i]
    const newVal = values[i]
    if (!ins || !newVal) continue
    const newId = ins.id
    const newEmb = embeddings[i] ?? null
    const newContentEmb = newVal.embeddingContent ?? null
    const newCausalEmb = newVal.embeddingCausal ?? null
    const newContextEmb = newVal.embeddingContext ?? null

    for (const candidate of existingCandidates) {
      if (!candidate.embedding) continue
      const candidateEmb = candidate.embedding as unknown as number[]

      const sim = cosineSimilarity(newEmb, candidateEmb)

      // EDGE-FACET-1: per-facet cosine triple. Built only when BOTH records
      // carry the content facet; legacy/retro records (null facets) keep the
      // scalar-only, back-compat path (facetSimilarity stays undefined).
      const candContentEmb = (candidate.embeddingContent as unknown as number[] | null) ?? null
      const candCausalEmb = (candidate.embeddingCausal as unknown as number[] | null) ?? null
      const candContextEmb = (candidate.embeddingContext as unknown as number[] | null) ?? null
      const facetSimilarity: FacetSimilarity | undefined =
        newContentEmb && candContentEmb
          ? {
              content: cosineSimilarity(newContentEmb, candContentEmb),
              causal: cosineSimilarity(newCausalEmb, candCausalEmb),
              context: cosineSimilarity(newContextEmb, candContextEmb),
            }
          : undefined

      const threshold =
        candidate.threadId === newVal.threadId
          ? LINK_SIMILARITY_THRESHOLD_SAME
          : LINK_SIMILARITY_THRESHOLD_CROSS

      // EDGE-FACET-1 candidate surfacing: route a near-content/far-causal pair
      // (the contradiction signature) to ANALYST even when the composite cosine
      // misses the threshold — the scalar would silently drop it. Gated to the
      // LLM path so the legacy heuristic path stays byte-identical.
      const surfacedContradiction =
        classifyEdgeFn != null &&
        facetSimilarity != null &&
        isContradictionCandidate(facetSimilarity)

      if (sim < threshold && !surfacedContradiction) continue
      const crossUser = candidate.userId !== newVal.userId

      qualifying.push({ candidate, newVal, newId, sim, facetSimilarity, crossUser })
    }
  }

  if (classifyEdgeFn) {
    // ANALYST LLM path: classify all qualifying pairs with bounded concurrency.
    const fn = classifyEdgeFn
    const classified = await mapWithConcurrency(qualifying, ANALYST_CONCURRENCY, async (p) => {
      const verdict = await fn({
        userId: p.newVal.userId,
        workspaceId,
        cosineSimilarity: p.sim,
        facetSimilarity: p.facetSimilarity,
        a: {
          id: p.candidate.id,
          text: p.candidate.embeddingText ?? '',
          documentTitle: p.candidate.documentTitle,
          contributor: p.candidate.userName,
          timestamp: p.candidate.eventTime?.toISOString?.() ?? null,
          threadType: p.candidate.threadType,
          topics: extractTopicsFromMetadata(p.candidate.metadata),
        },
        b: {
          // ANALYST-ON-1 (FIX-1): the new record's OWN text + identity — the
          // model now sees both sides, symmetric with the candidate.
          id: p.newId,
          text: p.newVal.embeddingText ?? '',
          documentTitle: p.newVal.documentTitle ?? null,
          contributor: p.newVal.userName ?? null,
          timestamp: p.newVal.eventTime?.toISOString?.() ?? null,
          threadType: p.newVal.threadType,
          topics: extractTopicsFromMetadata(p.newVal.metadata),
        },
      })
      return { p, verdict }
    })

    for (const { p, verdict } of classified) {
      if (!verdict) continue // model said 'none' or call failed — skip
      links.push({
        workspaceId,
        sourceRecordId: p.candidate.id,
        targetRecordId: p.newId,
        similarity: Math.round(p.sim * 1000) / 1000,
        linkType: verdict.edgeType,
        crossUser: p.crossUser,
        metadata: {
          analyst: {
            confidence: verdict.confidence,
            reason: verdict.reason,
            directionality: verdict.directionality,
            ...(p.facetSimilarity ? { facets: p.facetSimilarity } : {}),
          },
        },
      })
    }
  } else {
    // Legacy heuristic path (byte-identical to pre-ANALYST-ON-1).
    for (const p of qualifying) {
      const linkType = classifyLinkType(p.candidate.threadType, p.newVal.threadType, !p.crossUser)
      links.push({
        workspaceId,
        sourceRecordId: p.candidate.id,
        targetRecordId: p.newId,
        similarity: Math.round(p.sim * 1000) / 1000,
        linkType,
        crossUser: p.crossUser,
      })
    }
  }

  if (links.length > 0) {
    // Use onConflictDoNothing for the unique pair constraint
    await db.insert(semanticLinks).values(links).onConflictDoNothing()
  }
}

/**
 * FACET-FIX-1: embed only the non-empty facet texts and scatter the results
 * back to their original indices, so empty/whitespace facet text → `null` (not
 * an embedding of the empty string). Returns one slot per input text. On API
 * failure the whole facet degrades to all-null (the scalar path still works).
 */
async function embedFacetSparse(texts: string[], dim: number): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = new Array(texts.length).fill(null)
  const present: { idx: number; text: string }[] = []
  texts.forEach((t, i) => {
    if (t && t.trim().length > 0) present.push({ idx: i, text: t })
  })
  if (present.length === 0) return out
  try {
    const embs = await generateEmbeddings(present.map((p) => p.text))
    embs.forEach((e, k) => {
      const p = present[k]
      if (p) out[p.idx] = e.slice(0, dim)
    })
  } catch {
    return new Array(texts.length).fill(null)
  }
  return out
}

/**
 * ANALYST-ON-1 (FIX-2a): run `fn` over `items` with at most `limit` in flight,
 * preserving input→output order. Used to parallelize the per-record ANALYST
 * edge-classification calls without an unbounded fan-out.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i]!, i)
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

function extractTopicsFromMetadata(meta: unknown): string[] {
  if (!meta || typeof meta !== 'object') return []
  const topics = (meta as Record<string, unknown>)['topics']
  if (!Array.isArray(topics)) return []
  return topics.filter((t): t is string => typeof t === 'string').slice(0, 6)
}
