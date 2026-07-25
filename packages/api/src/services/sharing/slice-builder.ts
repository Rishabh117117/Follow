/**
 * Slice Builder Service (Sprint SH-2)
 *
 * The core of the sharing layer. Given a request from User A for context
 * from User B's index, this service:
 *
 *   1. Validates B's session token (passcode lock from SH-1).
 *   2. Queries B's index by scope (document / topic / temporal).
 *   3. Runs every retrieved item through B's active privacy filters
 *      (preset rules + custom rules from SH-1).
 *   4. Assembles the surviving items into a version-cited slice.
 *   5. Inserts the slice into `shared_slices` with a privacy snapshot.
 *
 * Sharing principle: content is filtered at slice-build time using the
 * SHARER's preset. The receiver cannot bypass it; revocation is a
 * soft-delete with audit trail.
 *
 * Uses the project's standard `db.select().from()` raw drizzle pattern.
 */

import { and, desc, eq, gte, ilike, lte } from 'drizzle-orm'
import { db } from '../../db/index'
import { indexRecords } from '../../db/schema/semantic-index'
import { indexAccess, sharedSlices } from '../../db/schema/sharing'
import { applyPrivacyFilters } from './privacy-filter'
import { validateSession } from './passcode'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ScopeType = 'document' | 'topic' | 'temporal'

export interface BuildSliceInput {
  requestId?: string
  fromUserId: string
  toUserId: string
  workspaceId: string
  sessionToken: string
  scopeType: ScopeType
  scopeRefId?: string
  query: string
  limit?: number
}

export interface BuildSliceResult {
  success: boolean
  sliceId?: string
  reason?: string
  summary?: {
    itemsRetrieved: number
    redactionCount: number
    excludedCount: number
    presetUsed: string
  }
}

interface RawIndexItem {
  text: string
  sourceType: string
  topic?: string
  timestamp?: Date
  metadata?: Record<string, unknown>
  citation: {
    sourceFileId?: string | null
    sourceVersion?: number | null
    sourceContentHash?: string | null
    timestamp?: string
    label: string
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a shared slice from the responder's index.
 */
export async function buildSharedSlice(input: BuildSliceInput): Promise<BuildSliceResult> {
  // 1. Validate the responder's session — index must be unlocked
  const sessionValid = await validateSession({
    userId: input.fromUserId,
    sessionToken: input.sessionToken,
  })
  if (!sessionValid) {
    return { success: false, reason: 'Index is locked or session invalid' }
  }

  // 2. Query the responder's index based on scope
  const rawItems = await queryResponderIndex({
    fromUserId: input.fromUserId,
    workspaceId: input.workspaceId,
    scopeType: input.scopeType,
    scopeRefId: input.scopeRefId,
    query: input.query,
    limit: input.limit ?? 20,
  })

  if (rawItems.length === 0) {
    return { success: false, reason: 'No matching content in responder index' }
  }

  // 3. Apply privacy filters to every item
  const filteredItems: Array<{
    content: string
    citation: RawIndexItem['citation']
    redactionCount: number
  }> = []
  let totalRedactions = 0
  let excludedCount = 0

  for (const item of rawItems) {
    const filtered = await applyPrivacyFilters({
      userId: input.fromUserId,
      workspaceId: input.workspaceId,
      content: {
        text: item.text,
        sourceType: item.sourceType,
        topic: item.topic,
        timestamp: item.timestamp,
        metadata: item.metadata,
      },
      documentId: input.scopeRefId,
    })

    if (filtered.text === '' && filtered.excludedByRule) {
      excludedCount++
      continue
    }

    totalRedactions += filtered.redactionCount
    filteredItems.push({
      content: filtered.text,
      citation: item.citation,
      redactionCount: filtered.redactionCount,
    })
  }

  if (filteredItems.length === 0) {
    return { success: false, reason: 'All content filtered out by privacy rules' }
  }

  // 4. Get active preset (snapshot at share time)
  const accessRows = await db
    .select({ activePreset: indexAccess.activePreset })
    .from(indexAccess)
    .where(eq(indexAccess.userId, input.fromUserId))
    .limit(1)
  const presetUsed = accessRows[0]?.activePreset ?? 'balanced'

  // 5. Assemble + insert
  const sliceContent = filteredItems
    .map((item) => `[${item.citation?.label ?? 'source'}]\n${item.content}`)
    .join('\n\n')

  // Sprint IX-10: tag the slice with the responder's index state at share
  // time. We reached this point with a valid session and the index actively
  // returning rows, so the index is by definition in a 'live' state.
  // (Future: when IX-10 user-level live/static toggle lands, surface
  // 'static' here when the responder has frozen their index.)
  const indexState: 'live' | 'static' | 'unknown' = 'live'

  const sliceMetadata = {
    sources: filteredItems.map((item) => item.citation).filter(Boolean),
    redactionCount: totalRedactions,
    excludedCount,
    itemCount: filteredItems.length,
    indexState,
    queryScope: {
      type: input.scopeType,
      refId: input.scopeRefId,
      query: input.query,
    },
  }

  const inserted = await db
    .insert(sharedSlices)
    .values({
      requestId: input.requestId ?? null,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      workspaceId: input.workspaceId,
      sliceContent,
      sliceMetadata,
      scopeType: input.scopeType,
      scopeRefId: input.scopeRefId ?? null,
      presetUsed,
      rulesApplied: filteredItems.length + excludedCount,
      redactionCount: totalRedactions,
    })
    .returning({ id: sharedSlices.id })

  return {
    success: true,
    sliceId: inserted[0]!.id,
    summary: {
      itemsRetrieved: filteredItems.length,
      redactionCount: totalRedactions,
      excludedCount,
      presetUsed,
    },
  }
}

// ─── Index Query (per scope type) ────────────────────────────────────────────

async function queryResponderIndex(params: {
  fromUserId: string
  workspaceId: string
  scopeType: ScopeType
  scopeRefId?: string
  query: string
  limit: number
}): Promise<RawIndexItem[]> {
  const results: RawIndexItem[] = []

  // indexRecords.userId is notNull (verified in semantic-index schema), so
  // we can scope queries to the responder's own records.
  const baseConditions = [
    eq(indexRecords.workspaceId, params.workspaceId),
    eq(indexRecords.userId, params.fromUserId),
  ]

  // ─ document scope ─────────────────────────────────────────────────────────
  if (params.scopeType === 'document') {
    if (!params.scopeRefId) return []

    const records = await db
      .select()
      .from(indexRecords)
      .where(and(...baseConditions, eq(indexRecords.sourceFileId, params.scopeRefId)))
      .orderBy(desc(indexRecords.indexedAt))
      .limit(params.limit)

    for (const r of records) {
      results.push({
        text: r.embeddingText ?? '',
        sourceType: r.threadType ?? 'document',
        topic: r.sectionAlias ?? undefined,
        timestamp: r.indexedAt ?? undefined,
        metadata: { documentTitle: r.documentTitle },
        citation: {
          sourceFileId: r.sourceFileId,
          sourceVersion: r.sourceVersion,
          sourceContentHash: r.sourceContentHash,
          timestamp: r.indexedAt?.toISOString?.(),
          label:
            r.sourceVersion != null
              ? `Index record (source v${r.sourceVersion}, ${r.indexedAt?.toISOString?.()?.substring(0, 10) ?? 'unknown'})`
              : `Index record (${r.indexedAt?.toISOString?.()?.substring(0, 10) ?? 'unknown'})`,
        },
      })
    }

    // Also pull GWS snapshots for the same external doc, if any.
    try {
      const { gwsSnapshots } = await import('../../db/schema/semantic-index')
      const snapshots = await db
        .select()
        .from(gwsSnapshots)
        .where(eq(gwsSnapshots.externalDocId, params.scopeRefId))
        .orderBy(desc(gwsSnapshots.version))
        .limit(3)

      for (const s of snapshots) {
        results.push({
          text: s.content.substring(0, 5000), // cap snapshot content
          sourceType: 'document',
          timestamp: s.createdAt ?? undefined,
          citation: {
            sourceFileId: params.scopeRefId,
            sourceVersion: s.version,
            sourceContentHash: s.contentHash,
            timestamp: s.createdAt?.toISOString?.(),
            label: `Google Doc v${s.version} (${s.createdAt?.toISOString?.()?.substring(0, 10) ?? '?'})`,
          },
        })
      }
    } catch {
      // gws_snapshots table might not exist in some environments — ignore
    }
  }

  // ─ topic scope ────────────────────────────────────────────────────────────
  if (params.scopeType === 'topic') {
    const conditions = [...baseConditions]
    if (params.query) {
      conditions.push(ilike(indexRecords.embeddingText, `%${params.query}%`))
    }

    const records = await db
      .select()
      .from(indexRecords)
      .where(and(...conditions))
      .orderBy(desc(indexRecords.indexedAt))
      .limit(params.limit)

    for (const r of records) {
      results.push({
        text: r.embeddingText ?? '',
        sourceType: r.threadType ?? 'index',
        topic: params.query,
        timestamp: r.indexedAt ?? undefined,
        citation: {
          sourceFileId: r.sourceFileId,
          sourceVersion: r.sourceVersion,
          sourceContentHash: r.sourceContentHash,
          timestamp: r.indexedAt?.toISOString?.(),
          label: `Index record on "${params.query}"`,
        },
      })
    }
  }

  // ─ temporal scope ─────────────────────────────────────────────────────────
  if (params.scopeType === 'temporal') {
    let start: Date | null = null
    let end: Date | null = null
    if (params.scopeRefId?.includes('..')) {
      const parts = params.scopeRefId.split('..')
      start = new Date(parts[0]!)
      end = new Date(parts[1]!)
    }

    const conditions = [...baseConditions]
    if (start && !Number.isNaN(start.getTime())) {
      conditions.push(gte(indexRecords.indexedAt, start))
    }
    if (end && !Number.isNaN(end.getTime())) {
      conditions.push(lte(indexRecords.indexedAt, end))
    }

    const records = await db
      .select()
      .from(indexRecords)
      .where(and(...conditions))
      .orderBy(desc(indexRecords.indexedAt))
      .limit(params.limit)

    for (const r of records) {
      results.push({
        text: r.embeddingText ?? '',
        sourceType: r.threadType ?? 'index',
        timestamp: r.indexedAt ?? undefined,
        citation: {
          sourceFileId: r.sourceFileId,
          sourceVersion: r.sourceVersion,
          timestamp: r.indexedAt?.toISOString?.(),
          label: `Index record from ${r.indexedAt?.toISOString?.()?.substring(0, 10) ?? '?'}`,
        },
      })
    }
  }

  return results
}

// ─── Slice Lifecycle ─────────────────────────────────────────────────────────

/**
 * Revoke a shared slice (soft delete). Audit trail preserved.
 * Returns false if the caller does not own the slice.
 */
export async function revokeSlice(params: {
  sliceId: string
  fromUserId: string
  reason?: string
}): Promise<{ success: boolean }> {
  const rows = await db
    .select()
    .from(sharedSlices)
    .where(eq(sharedSlices.id, params.sliceId))
    .limit(1)

  if (!rows[0] || rows[0].fromUserId !== params.fromUserId) {
    return { success: false }
  }

  await db
    .update(sharedSlices)
    .set({
      revokedAt: new Date(),
      revokedReason: params.reason ?? null,
    })
    .where(eq(sharedSlices.id, params.sliceId))

  return { success: true }
}

/**
 * Get slices shared WITH a user (inbox).
 * Excludes revoked unless `includeRevoked` is true.
 */
export async function getReceivedSlices(params: {
  toUserId: string
  workspaceId: string
  includeRevoked?: boolean
}) {
  const slices = await db
    .select()
    .from(sharedSlices)
    .where(
      and(
        eq(sharedSlices.toUserId, params.toUserId),
        eq(sharedSlices.workspaceId, params.workspaceId)
      )
    )
    .orderBy(desc(sharedSlices.createdAt))

  if (!params.includeRevoked) {
    return slices.filter((s) => !s.revokedAt)
  }
  return slices
}

/**
 * Get slices shared BY a user (outbox).
 */
export async function getSentSlices(params: { fromUserId: string; workspaceId: string }) {
  return db
    .select()
    .from(sharedSlices)
    .where(
      and(
        eq(sharedSlices.fromUserId, params.fromUserId),
        eq(sharedSlices.workspaceId, params.workspaceId)
      )
    )
    .orderBy(desc(sharedSlices.createdAt))
}
