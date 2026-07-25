/**
 * Semantic Index Query Executor (Sprint IX-2)
 *
 * Core query logic extracted from the index-query route.
 * Used by system-prompt.ts, thread-speaker.ts, doc-memory.ts, and the route itself.
 */

import { db } from '../../db/index'
import { eq, and, desc, gt, sql } from 'drizzle-orm'
import { indexRecords, evidenceRecords, episodes } from '../../db/schema/semantic-index'
import { strandCollaborators } from '../../db/schema/threads'
import { generateEmbedding, hasEmbeddingSupport } from '../embedding'
import { scoreResults, detectQueryProfile, type CandidateRecord } from './weighted-referencing'
import { applyPermissions, type PermissionContext } from './permission-filter'
import { generateInterpretation } from './interpretation-generator'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IndexQueryParams {
  query?: string
  workspaceId: string
  userId: string
  weightProfile?: string
  documentId?: string
  targetSection?: string
  threadTypes?: string[]
  strandId?: string
  episodeId?: string
  timeRangeMinutes?: number
  magnitudeMin?: string
  aiOnly?: boolean
  includeEvidence?: boolean
  includeEpisodes?: boolean
  includeSummary?: boolean
  includeHidden?: boolean
  limit?: number
}

export interface IndexQueryResultItem {
  id: string
  score: number
  signals: Record<string, number>
  permissionLevel: string
  threadType: string
  indexMagnitude: string
  isKeyChange: boolean
  isAIInvolved: boolean
  documentId: string | null
  documentTitle: string | null
  sectionAlias: string | null
  userId: string
  userName: string | null
  eventTime: Date | string
  embeddingText: string
  episodeId: string | null
  evidence: unknown[]
  metadata: Record<string, unknown>
  // Sprint FE-5 (Gap 2): IX-8 version-linking columns surfaced for the
  // FE-4 INDEX SOURCES pills + version-cited chat citations.
  sourceFileId: string | null
  sourceVersion: number | null
  sourceContentHash: string | null
  indexedAt: Date | string | null
}

export interface IndexQueryResult {
  results: IndexQueryResultItem[]
  totalCandidates: number
  profile: string
  episodes?: Record<string, unknown>
  aiSummary?: Record<string, unknown>
  interpretation?: Record<string, unknown> | null
}

// ─── Main Executor ──────────────────────────────────────────────────────────

export async function executeIndexQuery(params: IndexQueryParams): Promise<IndexQueryResult> {
  const {
    query,
    workspaceId,
    userId,
    weightProfile: requestedProfile = 'history',
    documentId,
    targetSection,
    threadTypes,
    strandId,
    episodeId,
    timeRangeMinutes,
    magnitudeMin,
    aiOnly,
    includeEvidence = false,
    includeEpisodes = false,
    includeSummary = false,
    includeHidden = false,
    limit = 50,
  } = params

  // 0. Auto-detect query profile (Sprint IX-7)
  const weightProfile = detectQueryProfile(query, requestedProfile)

  // 1. Generate query embedding if text provided
  let queryEmbedding: number[] | null = null
  if (query && hasEmbeddingSupport()) {
    try {
      queryEmbedding = await generateEmbedding(query)
    } catch (err) {
      console.warn('[IndexQuery] Query embedding failed:', err)
    }
  }

  // 2. Build SQL conditions
  const conditions = [eq(indexRecords.workspaceId, workspaceId)]

  // Sprint CTX-1: exclude hidden records by default
  if (!includeHidden) {
    conditions.push(eq(indexRecords.hidden, false))
  }
  // 2026-04-29: tombstones are always excluded from query results.
  conditions.push(sql`${indexRecords.deletedAt} IS NULL`)
  // VERSION-B1: superseded facts (older doc versions, retired on re-sync) are
  // excluded from current results too. Filter on superseded_at only, not version.
  conditions.push(sql`${indexRecords.supersededAt} IS NULL`)

  if (documentId) conditions.push(eq(indexRecords.documentId, documentId))
  if (episodeId) conditions.push(eq(indexRecords.episodeId, episodeId))
  if (aiOnly) conditions.push(eq(indexRecords.isAIInvolved, true))
  if (threadTypes && threadTypes.length > 0) {
    conditions.push(
      sql`${indexRecords.threadType} IN (${sql.join(
        threadTypes.map((t) => sql`${t}`),
        sql`, `
      )})`
    )
  }
  if (timeRangeMinutes) {
    const cutoff = new Date(Date.now() - timeRangeMinutes * 60 * 1000)
    conditions.push(gt(indexRecords.eventTime, cutoff))
  }
  if (magnitudeMin) {
    const minValues =
      magnitudeMin === 'large'
        ? ['large', 'major']
        : magnitudeMin === 'medium'
          ? ['medium', 'large', 'major']
          : ['small', 'medium', 'large', 'major']
    conditions.push(
      sql`${indexRecords.indexMagnitude} IN (${sql.join(
        minValues.map((v) => sql`${v}`),
        sql`, `
      )})`
    )
  }
  if (weightProfile === 'realtime' && !timeRangeMinutes) {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000)
    conditions.push(gt(indexRecords.eventTime, cutoff))
  }

  // 3. Fetch candidates
  const candidateLimit = Math.min(limit * 3, 200)
  const candidates = await db
    .select()
    .from(indexRecords)
    .where(and(...conditions))
    .orderBy(desc(indexRecords.eventTime))
    .limit(candidateLimit)

  // 4. Map to CandidateRecord
  const candidateRecords: CandidateRecord[] = candidates.map((c) => ({
    id: c.id,
    workspaceId: c.workspaceId,
    threadId: c.threadId,
    threadType: c.threadType,
    indexMagnitude: c.indexMagnitude,
    isKeyChange: c.isKeyChange,
    isAIInvolved: c.isAIInvolved,
    hasEvidence: c.hasEvidence,
    engagementDepth: c.engagementDepth,
    episodeId: c.episodeId,
    documentId: c.documentId,
    documentTitle: c.documentTitle,
    sectionAlias: c.sectionAlias,
    userId: c.userId,
    userName: c.userName,
    eventTime: c.eventTime,
    embeddingText: c.embeddingText,
    embedding: c.embedding as unknown as number[] | null,
    metadata: (c.metadata as Record<string, unknown>) ?? {},
    // Sprint FE-5 (Gap 2): IX-8 version columns
    sourceFileId: c.sourceFileId ?? null,
    sourceVersion: c.sourceVersion ?? null,
    sourceContentHash: c.sourceContentHash ?? null,
    indexedAt: c.indexedAt ?? null,
  }))

  // 5. Get collaborator IDs
  let collaboratorIds: string[] = []
  if (strandId) {
    const collabs = await db
      .select({ userId: strandCollaborators.userId })
      .from(strandCollaborators)
      .where(eq(strandCollaborators.strandId, strandId))
    collaboratorIds = collabs.map((c) => c.userId)
  }

  // 6. Score
  const scored = scoreResults(candidateRecords, {
    queryType: weightProfile,
    queryEmbedding,
    targetDocumentId: documentId ?? null,
    targetSection: targetSection ?? null,
    requestingUserId: userId,
    collaboratorIds,
  })

  // 7. Apply permissions
  const permissions: PermissionContext = { requestingUserId: userId }
  if (strandId) {
    const [collab] = await db
      .select()
      .from(strandCollaborators)
      .where(
        and(eq(strandCollaborators.strandId, strandId), eq(strandCollaborators.userId, userId))
      )
      .limit(1)

    if (collab) {
      permissions.strandVisibility = {
        canSeeUserThread: collab.canSeeUserThread,
        canSeeAiThread: collab.canSeeAiThread,
        canSeeDocThreads: collab.canSeeDocThreads,
        canSeeBrowserThread: collab.canSeeBrowserThread,
      }
    }
  }

  const permitted = applyPermissions(scored, permissions)
  const limited = permitted.slice(0, limit)

  // 8. Fetch evidence
  const evidence: Record<string, unknown[]> = {}
  if (includeEvidence && limited.length > 0) {
    const recordIds = limited.map((r) => r.recordId)
    const evidenceRows = await db
      .select()
      .from(evidenceRecords)
      .where(
        sql`${evidenceRecords.indexRecordId} IN (${sql.join(
          recordIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      )

    for (const row of evidenceRows) {
      const key = row.indexRecordId
      if (!evidence[key]) evidence[key] = []
      evidence[key]!.push({
        id: row.id,
        evidenceType: row.evidenceType,
        contentBefore: row.contentBefore,
        contentAfter: row.contentAfter,
        chatExchange: row.chatExchange,
        sourceSnapshot: row.sourceSnapshot,
        recordHash: row.recordHash,
        createdAt: row.createdAt,
      })
    }
  }

  // 9. Group by episodes
  const episodeData: Record<string, unknown> = {}
  if (includeEpisodes) {
    const episodeIds = [
      ...new Set(limited.map((r) => r.record.episodeId).filter(Boolean)),
    ] as string[]
    if (episodeIds.length > 0) {
      const episodeRows = await db
        .select()
        .from(episodes)
        .where(
          sql`${episodes.id} IN (${sql.join(
            episodeIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        )

      for (const ep of episodeRows) {
        episodeData[ep.id] = {
          id: ep.id,
          title: ep.title,
          status: ep.status,
          summaryText: ep.summaryText,
          startedAt: ep.startedAt,
          endedAt: ep.endedAt,
          recordCount: ep.recordCount,
        }
      }
    }
  }

  // 10. AI usage summary
  let aiSummary: Record<string, unknown> | undefined
  if (weightProfile === 'ai_usage') {
    const aiResults = limited.filter((r) => r.record.isAIInvolved)
    aiSummary = {
      totalAIEvents: aiResults.length,
      acceptedCount: Object.values(evidence)
        .flat()
        .filter((e) => (e as { evidenceType?: string }).evidenceType === 'ai_accepted').length,
      rejectedCount: Object.values(evidence)
        .flat()
        .filter((e) => (e as { evidenceType?: string }).evidenceType === 'ai_rejected').length,
      sectionsAffected: [...new Set(aiResults.map((r) => r.record.sectionAlias).filter(Boolean))],
    }
  }

  // 11. Map results
  const results: IndexQueryResultItem[] = limited.map((r) => ({
    id: r.recordId,
    score: Math.round(r.score * 1000) / 1000,
    signals: r.signals,
    permissionLevel: r.permissionLevel,
    threadType: r.record.threadType,
    indexMagnitude: r.record.indexMagnitude,
    isKeyChange: r.record.isKeyChange,
    isAIInvolved: r.record.isAIInvolved,
    documentId: r.record.documentId,
    documentTitle: r.record.documentTitle,
    sectionAlias: r.record.sectionAlias,
    userId: r.record.userId,
    userName: r.record.userName,
    eventTime: r.record.eventTime,
    embeddingText: r.record.embeddingText,
    episodeId: r.record.episodeId,
    evidence: evidence[r.recordId] ?? [],
    metadata: (r.record.metadata ?? {}) as Record<string, unknown>,
    // Sprint FE-5 (Gap 2): IX-8 version columns
    sourceFileId: r.record.sourceFileId ?? null,
    sourceVersion: r.record.sourceVersion ?? null,
    sourceContentHash: r.record.sourceContentHash ?? null,
    indexedAt: r.record.indexedAt ?? null,
  }))

  // 12. Generate interpretation summary if requested
  let interpretation: Record<string, unknown> | null | undefined
  if (includeSummary && results.length > 0) {
    try {
      const interp = await generateInterpretation(
        results,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- episodeData is untyped jsonb; generateInterpretation accepts Record<string, EpisodeData>.
        episodeData as Record<string, any>,
        documentId ?? '',
        workspaceId
      )
      interpretation = interp as Record<string, unknown> | null
    } catch (err) {
      console.warn('[IndexQuery] Interpretation generation failed:', err)
      interpretation = null
    }
  }

  return {
    results,
    totalCandidates: candidateRecords.length,
    profile: weightProfile,
    ...(Object.keys(episodeData).length > 0 ? { episodes: episodeData } : {}),
    ...(aiSummary ? { aiSummary } : {}),
    ...(includeSummary ? { interpretation } : {}),
  }
}
