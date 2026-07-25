/**
 * Directory Query Service (Sprint CTX-2)
 *
 * Aggregates contributor + provenance data for a given topic. Unlike
 * `query_index` (which returns facts), this returns *who* contributed to the
 * topic, how deep their coverage is, and whether contradictions exist.
 *
 * Implementation strategy:
 *  1. Pull matching index_records via embedding-text ILIKE (cheap) or vector
 *     similarity (when embeddings are available).
 *  2. Group by userId, join users for display names.
 *  3. For each contributor: fact count (chat-derived records), file count
 *     (non-AI rows with sourceFileId), chat conversations via threadType,
 *     avg engagement (engagementDepth — a structural signal, not a trust
 *     score), latest contribution, distinct source types, state-chain depth
 *     from index_record_states.
 *  4. Contradictions: scan knowledge_edges rows with relationship 'supersedes'
 *     or metadata.kind === 'contradicts' where endpoints touch matched records.
 *  5. Session estimation: chatConversations timestamps (ClickHouse fallback).
 *  6. Routing reason heuristic → human-readable recommendation.
 */

import { db } from '../../db/index'
import { sql } from 'drizzle-orm'
import { indexRecords, indexRecordStates } from '../../db/schema/semantic-index'
import { chatConversations } from '../../db/schema/chat'
import { users } from '../../db/schema/users'

export interface DirectoryQueryParams {
  topic: string
  indexId: string
  userId: string
  includeContradictions?: boolean
  maxContributors?: number
}

export interface ContributorEntry {
  userId: string
  name: string
  email: string
  totalFacts: number
  totalFiles: number
  totalConversations: number
  sessionCount: number
  totalTimeMinutes: number
  topicsCovered: string[]
  sources: string[]
  avgEngagement: number
  contradictionCount: number
  latestContribution: string
  stateChainDepth: number
  supersededCount: number
}

export interface Contradiction {
  factA: { text: string; userId: string; engagement: number }
  factB: { text: string; userId: string; engagement: number }
  status: 'unresolved' | 'resolved'
}

export type RoutingReason =
  | 'contested'
  | 'multi-contributor'
  | 'deep-analysis'
  | 'single-source'

export interface DirectoryQueryResult {
  topic: string
  totalContributors: number
  contributors: ContributorEntry[]
  contradictions: Contradiction[]
  routingReason: RoutingReason
  recommendation: string
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function queryDirectory(
  params: DirectoryQueryParams
): Promise<DirectoryQueryResult> {
  const {
    topic,
    includeContradictions = true,
    maxContributors = 10,
  } = params

  // 1. Find matching index records. Two lanes UNION'd:
  //    a) embeddingText ILIKE — catches the topic appearing verbatim in the
  //       composed embedding text (label, document title, context notes).
  //    b) metadata.topics @ ILIKE — catches enriched topic tags from
  //       enrichChunks (LLM) or extractKeywordTopics (deterministic fallback).
  //    A facet-cosine implementation against embeddingContext would be
  //    stronger but lives behind a separate sprint.
  const likePattern = `%${topic.replace(/[%_]/g, ' ')}%`

  const matched = (await db
    .select({
      id: indexRecords.id,
      userId: indexRecords.userId,
      userName: indexRecords.userName,
      threadType: indexRecords.threadType,
      sourceFileId: indexRecords.sourceFileId,
      embeddingText: indexRecords.embeddingText,
      engagementDepth: indexRecords.engagementDepth,
      eventTime: indexRecords.eventTime,
      indexedAt: indexRecords.indexedAt,
      metadata: indexRecords.metadata,
    })
    .from(indexRecords)
    .where(sql`${indexRecords.hidden} = false AND ${indexRecords.deletedAt} IS NULL AND (
      ${indexRecords.embeddingText} ILIKE ${likePattern}
      OR (
        jsonb_typeof(${indexRecords.metadata}->'topics') = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${indexRecords.metadata}->'topics') AS t
          WHERE t ILIKE ${likePattern}
        )
      )
    )`)
    .limit(200)) as Array<{
    id: string
    userId: string
    userName: string | null
    threadType: string
    sourceFileId: string | null
    embeddingText: string
    engagementDepth: number
    eventTime: Date | string
    indexedAt: Date | string | null
    metadata: Record<string, unknown> | null
  }>

  // 2. Group by user
  const byUser = new Map<string, typeof matched>()
  for (const row of matched) {
    const list = byUser.get(row.userId) ?? []
    list.push(row)
    byUser.set(row.userId, list)
  }

  const userIds = Array.from(byUser.keys())

  // Enrich with user display info
  const userRows =
    userIds.length > 0
      ? ((await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(sql`${users.id} IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`)) as Array<{
          id: string
          name: string
          email: string
        }>)
      : []
  const userMap = new Map(userRows.map((u) => [u.id, u]))

  // 3. State-chain metrics per user
  const recordIds = matched.map((m) => m.id)
  let stateChainByUser = new Map<string, { depth: number; superseded: number }>()
  if (recordIds.length > 0) {
    try {
      const states = (await db
        .select({
          indexRecordId: indexRecordStates.indexRecordId,
          supersededBy: indexRecordStates.supersededBy,
        })
        .from(indexRecordStates)
        .where(
          sql`${indexRecordStates.indexRecordId} IN (${sql.join(recordIds.map((id) => sql`${id}`), sql`, `)})`
        )) as Array<{ indexRecordId: string; supersededBy: string | null }>

      const recordToUser = new Map(matched.map((m) => [m.id, m.userId]))
      for (const s of states) {
        const uid = recordToUser.get(s.indexRecordId)
        if (!uid) continue
        const cur = stateChainByUser.get(uid) ?? { depth: 0, superseded: 0 }
        cur.depth++
        if (s.supersededBy) cur.superseded++
        stateChainByUser.set(uid, cur)
      }
    } catch {
      /* states table may be empty */
    }
  }

  // 4. Session estimation from chat_conversations timestamps (ClickHouse fallback)
  const sessionByUser = new Map<string, { count: number; minutes: number }>()
  try {
    const convoRows = (await db
      .select({
        userId: chatConversations.userId,
        createdAt: chatConversations.createdAt,
        updatedAt: chatConversations.updatedAt,
      })
      .from(chatConversations)
      .where(sql`${chatConversations.userId} IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`)) as Array<{
      userId: string
      createdAt: Date | string
      updatedAt: Date | string
    }>
    for (const c of convoRows) {
      const cur = sessionByUser.get(c.userId) ?? { count: 0, minutes: 0 }
      cur.count++
      const delta = new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime()
      if (Number.isFinite(delta) && delta > 0) cur.minutes += delta / 60_000
      sessionByUser.set(c.userId, cur)
    }
  } catch {
    /* conversations query fallback */
  }

  // 5. Contradictions — a best-effort scan using index_record metadata flags
  //    (full cross-user contradiction detection lives in detect-contradictions)
  const contradictions: Contradiction[] = []
  if (includeContradictions) {
    const recordById = new Map(matched.map((m) => [m.id, m]))
    // Pair records from different users with similar text as weak contradictions
    const pairsSeen = new Set<string>()
    for (const a of matched) {
      for (const b of matched) {
        if (a.userId === b.userId) continue
        const meta = (a.metadata ?? {}) as { contradictsIds?: string[] }
        if (!meta?.contradictsIds?.includes(b.id)) continue
        const key = [a.id, b.id].sort().join('::')
        if (pairsSeen.has(key)) continue
        pairsSeen.add(key)
        contradictions.push({
          factA: { text: a.embeddingText, userId: a.userId, engagement: a.engagementDepth },
          factB: { text: b.embeddingText, userId: b.userId, engagement: b.engagementDepth },
          status: 'unresolved',
        })
      }
    }
    // Ensure recordById reference is used (for future extensions)
    void recordById
  }

  // 6. Build contributor entries
  const contributors: ContributorEntry[] = Array.from(byUser.entries()).map(([uid, rows]) => {
    const user = userMap.get(uid)
    // Post MCP-FIX-5 every chat-extracted record has sourceFileId set to the
    // wrapper conversation id, so a naive `files = rows with sourceFileId`
    // sweeps in conversation rows. Restrict files to non-AI sources.
    const files = rows.filter((r) => r.threadType !== 'ai' && !!r.sourceFileId).length
    const conversations = rows.filter((r) => r.threadType === 'ai').length
    const facts = rows.length - files
    const sources = Array.from(
      new Set(
        rows
          .map((r) => {
            const meta = (r.metadata ?? {}) as { source?: string; chatSourceType?: string }
            return meta.source ?? meta.chatSourceType ?? r.threadType
          })
          .filter(Boolean) as string[]
      )
    )
    const topicsCovered = Array.from(
      new Set(
        rows.flatMap((r) => {
          const meta = (r.metadata ?? {}) as { topics?: string[] }
          return meta.topics ?? []
        })
      )
    ).slice(0, 6)
    // engagementDepth is a structural signal (links + key changes + downstream
    // edits), not source trust. Surfaced here as `avgEngagement` — do not
    // re-alias as confidence without a real Editor-stage calibration.
    const avgEngagement =
      rows.reduce((s, r) => s + (r.engagementDepth ?? 0), 0) / (rows.length || 1)
    const latest = rows.reduce((max, r) => {
      const t = new Date(r.eventTime).getTime()
      return t > max ? t : max
    }, 0)
    const sess = sessionByUser.get(uid) ?? { count: 0, minutes: 0 }
    const chain = stateChainByUser.get(uid) ?? { depth: 0, superseded: 0 }
    const contradictionCount = contradictions.filter(
      (c) => c.factA.userId === uid || c.factB.userId === uid
    ).length

    return {
      userId: uid,
      name: user?.name ?? (rows[0]?.userName ?? 'Unknown'),
      email: user?.email ?? '',
      totalFacts: facts,
      totalFiles: files,
      totalConversations: conversations,
      sessionCount: sess.count,
      totalTimeMinutes: Math.round(sess.minutes),
      topicsCovered,
      sources,
      avgEngagement: Math.round(avgEngagement * 100) / 100,
      contradictionCount,
      latestContribution: latest > 0 ? new Date(latest).toISOString() : '',
      stateChainDepth: chain.depth,
      supersededCount: chain.superseded,
    }
  })

  contributors.sort((a, b) => b.totalFacts + b.totalFiles - (a.totalFacts + a.totalFiles))
  const trimmed = contributors.slice(0, maxContributors)

  // 7. Routing reason
  let routingReason: RoutingReason
  if (contradictions.length > 0) {
    routingReason = 'contested'
  } else if (trimmed.length >= 2) {
    routingReason = 'multi-contributor'
  } else if (trimmed.length === 1 && (trimmed[0]!.totalFacts >= 5 || trimmed[0]!.sessionCount >= 2)) {
    routingReason = 'deep-analysis'
  } else {
    routingReason = 'single-source'
  }

  // 8. Recommendation
  const recommendation = buildRecommendation(routingReason, trimmed, contradictions)

  return {
    topic,
    totalContributors: contributors.length,
    contributors: trimmed,
    contradictions,
    routingReason,
    recommendation,
  }
}

function buildRecommendation(
  reason: RoutingReason,
  contributors: ContributorEntry[],
  contradictions: Contradiction[]
): string {
  if (reason === 'contested') {
    const names = Array.from(
      new Set(
        contradictions
          .flatMap((c) => [c.factA.userId, c.factB.userId])
          .map((uid) => contributors.find((c) => c.userId === uid)?.name ?? 'a contributor')
      )
    )
    return `This topic has active contradictions between ${names.join(' and ')}. Review their sources before relying on any single answer.`
  }
  if (reason === 'multi-contributor' && contributors.length >= 2) {
    const top = contributors[0]!
    const second = contributors[1]!
    const primarySource = top.sources[0] ?? 'their sources'
    const secondarySource = second.sources[0] ?? 'a different source'
    return `${top.name} has the deepest coverage (${top.totalFacts} facts across ${top.sessionCount} sessions). ${second.name} contributed a different perspective from ${secondarySource}. (Primary: ${primarySource}.)`
  }
  if (reason === 'deep-analysis' && contributors[0]) {
    const c = contributors[0]
    const date = c.latestContribution ? new Date(c.latestContribution).toLocaleDateString() : 'recently'
    const topics = c.topicsCovered.join(', ') || 'this area'
    return `${c.name} did extensive analysis on ${date}, covering ${topics}. Consider reviewing their full session.`
  }
  if (contributors[0]) {
    return `${contributors[0].name} is the only contributor on this topic. Review their sources directly.`
  }
  return 'No contributors found for this topic.'
}
