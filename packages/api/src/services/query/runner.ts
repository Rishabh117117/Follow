/**
 * Query Runner (Sprint V41-QUERY-1)
 *
 * Executes a StructuredQuery directly against `index_records` (the
 * canonical fact store), applying Boundary[] as SQL conditions where
 * possible and post-filtering through the boundary-hook for everything
 * else. This is the deterministic, exact, fast counterpart to the
 * reference agent's fuzzy semantic path.
 *
 * Invariants:
 *   - User-decided: boundaries applied exactly as given. No silent
 *     relaxation. If nothing matches, return empty.
 *   - Governance-wins: caller must run `resolveEffectiveBoundaries`
 *     BEFORE passing boundaries here. Blocked boundaries don't reach
 *     retrieval.
 *   - Fail-closed post-filter: items missing the attribute a boundary
 *     needs are dropped.
 */

import { and, asc, count, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { db } from '../../db/index'
import { indexRecords } from '../../db/schema/semantic-index'
import { currentFactConditions } from '../semantic-index/current-fact-filter'
import { users } from '../../db/schema/users'
import type { ScopeConflict } from '../scope/types'
import type { RetrievedItem } from '../reference-agent/retriever'
import { postFilterItems } from '../reference-agent/boundary-hook'
import type { QueryResult, QueryResultFact, StructuredQuery } from './types'

export interface RunQueryOptions {
  /** Conflicts surfaced by the governance layer for inclusion in the result. */
  conflicts?: ScopeConflict[]
}

export async function runStructuredQuery(
  q: StructuredQuery,
  opts: RunQueryOptions = {}
): Promise<QueryResult> {
  const startedAt = Date.now()

  // Build SQL conditions from boundaries where the column is known.
  const conditions = [eq(indexRecords.workspaceId, q.workspaceId)]
  // VERSION-B1 (+ pre-existing leak-fix): the structured query path also serves
  // current facts to answers — exclude superseded (older doc versions), tombstoned,
  // and hidden facts via the shared version-safe filter (never source_version).
  conditions.push(...currentFactConditions())
  for (const b of q.boundaries) {
    if (
      b.dimension === 'time' &&
      b.op === 'within' &&
      b.window?.type === 'relative' &&
      b.window.days
    ) {
      const cutoff = new Date(Date.now() - b.window.days * 24 * 60 * 60 * 1000)
      conditions.push(gte(indexRecords.indexedAt, cutoff))
    }
    if (b.dimension === 'time' && b.op === 'within' && b.window?.type === 'absolute') {
      if (b.window.from) conditions.push(gte(indexRecords.indexedAt, new Date(b.window.from)))
      if (b.window.to) conditions.push(lte(indexRecords.indexedAt, new Date(b.window.to)))
    }
    if (b.dimension === 'contributor' && b.op === 'include') {
      const ids = [b.value, ...(b.values ?? [])].filter((v): v is string => typeof v === 'string')
      if (ids.length > 0) conditions.push(inArray(indexRecords.userId, ids))
    }
  }

  const limit = Math.max(1, Math.min(q.select.limit ?? 100, 1000))
  const offset = Math.max(0, q.select.offset ?? 0)

  // Order by
  const orderCol =
    q.select.orderBy?.field === 'indexedAt' || q.select.orderBy?.field === 'createdAt'
      ? indexRecords.indexedAt
      : indexRecords.indexedAt
  const orderFn = q.select.orderBy?.direction === 'asc' ? asc : desc

  // Count total (pre-pagination, pre-post-filter — best-effort).
  const [totalRow] = await db
    .select({ c: count() })
    .from(indexRecords)
    .where(and(...conditions))
  const totalCount = totalRow?.c ?? 0

  // Fetch rows (over-fetch by 3x to give post-filter room).
  const fetchLimit = Math.min(limit * 3 + offset, 1000)
  const rows = await db
    .select()
    .from(indexRecords)
    .where(and(...conditions))
    .orderBy(orderFn(orderCol))
    .limit(fetchLimit)

  // Map rows → RetrievedItem for reuse of boundary-hook post-filter.
  const items: RetrievedItem[] = rows.map((r) => ({
    source: 'index_records' as const,
    content: r.embeddingText ?? '',
    citation: {
      sourceFileId: r.sourceFileId,
      sourceVersion: r.sourceVersion,
      sourceContentHash: r.sourceContentHash,
      timestamp: r.indexedAt?.toISOString?.() ?? undefined,
      label: 'index_record',
    },
    relevanceScore: r.engagementDepth ?? undefined,
    metadata: {
      id: r.id,
      contributorId: r.userId,
      confidence: r.engagementDepth ?? undefined,
      indexId: r.workspaceId,
      sourceTool: 'index_records',
      topic: undefined,
      edgeType: undefined,
      documentTitle: r.documentTitle,
      documentId: r.documentId,
      userName: r.userName,
    },
  }))

  const filtered = postFilterItems(items, q.boundaries, { failClosed: true })
  const keptSlice = filtered.items.slice(offset, offset + limit)
  const truncated = totalCount > offset + keptSlice.length

  // Resolve contributor names for kept rows.
  const contributorIds = [
    ...new Set(
      keptSlice
        .map((i) => (i.metadata as { contributorId?: string } | undefined)?.contributorId)
        .filter((v): v is string => typeof v === 'string')
    ),
  ]
  const userNames = new Map<string, string>()
  if (contributorIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, contributorIds))
    for (const u of userRows) userNames.set(u.id, u.name)
  }

  const facts: QueryResultFact[] = keptSlice.map((i) => {
    const meta = (i.metadata ?? {}) as {
      id?: string
      contributorId?: string
      confidence?: number
      sourceTool?: string
      userName?: string
    }
    const id = String(meta.id ?? '')
    const contributorId = String(meta.contributorId ?? '')
    return {
      id,
      content: i.content,
      contributor: {
        id: contributorId,
        name: userNames.get(contributorId) ?? meta.userName ?? 'Unknown',
      },
      confidence: typeof meta.confidence === 'number' ? meta.confidence : 0,
      createdAt: i.citation.timestamp ? new Date(i.citation.timestamp) : new Date(0),
      sourceTool: meta.sourceTool ?? 'index_records',
    }
  })

  // Aggregations (group_count + count + distinct).
  let aggregations: Record<string, unknown> | undefined
  if (q.aggregations?.length) {
    aggregations = {}
    for (const agg of q.aggregations) {
      if (agg.kind === 'count') {
        aggregations.count = facts.length
      } else if (agg.kind === 'group_count' && agg.field === 'contributor') {
        const group: Record<string, number> = {}
        for (const f of facts) group[f.contributor.id] = (group[f.contributor.id] ?? 0) + 1
        aggregations.group_count_contributor = group
      } else if (agg.kind === 'distinct' && agg.field) {
        const values = new Set<string>()
        for (const f of facts) {
          const v = (f as unknown as Record<string, unknown>)[agg.field]
          if (v !== undefined && v !== null) values.add(String(v))
        }
        aggregations[`distinct_${agg.field}`] = [...values]
      }
    }
  }

  return {
    query: q,
    facts,
    totalCount,
    aggregations,
    conflicts: opts.conflicts ?? [],
    truncated,
    runtimeMs: Date.now() - startedAt,
  }
}
