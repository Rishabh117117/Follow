/**
 * Engagement Depth Updater (Sprint IX-1 + IX-3)
 *
 * Background job that recalculates engagement_depth for recently
 * active index records. Runs every 5 minutes.
 *
 * Engagement formula (IX-3 enhanced):
 *   min(1.0,
 *     (hasEvidence ? 0.3 : 0) +
 *     (min(semanticLinkCount * 0.02, 0.2)) +
 *     (isKeyChange ? 0.15 : 0) +
 *     (min(downstreamEditCount * 0.1, 0.2)) +      // IX-3: edits that built on this
 *   )
 */

import { db } from '../../db/index'
import { eq, gt, sql } from 'drizzle-orm'
import { indexRecords, semanticLinks } from '../../db/schema/semantic-index'

const UPDATE_WINDOW_MINUTES = 10

/**
 * Recalculate engagement_depth for recently active records.
 */
export async function updateEngagementDepths(workspaceId: string): Promise<void> {
  const cutoff = new Date(Date.now() - UPDATE_WINDOW_MINUTES * 60 * 1000)

  // Find records that were recently created or had new links/evidence
  const recentRecords = await db
    .select({
      id: indexRecords.id,
      hasEvidence: indexRecords.hasEvidence,
      isKeyChange: indexRecords.isKeyChange,
      engagementDepth: indexRecords.engagementDepth,
    })
    .from(indexRecords)
    .where(
      sql`${indexRecords.workspaceId} = ${workspaceId}
        AND ${indexRecords.indexedAt} > ${cutoff.toISOString()}`
    )

  if (recentRecords.length === 0) return

  // Batch-fetch link counts for all recent records
  const recordIds = recentRecords.map((r) => r.id)

  // Count links per record (both as source and target)
  const linkCounts = new Map<string, number>()
  // Count downstream edits per record (links where this record is source)
  const downstreamCounts = new Map<string, number>()

  if (recordIds.length > 0) {
    const sourceCounts = await db
      .select({
        recordId: semanticLinks.sourceRecordId,
        count: sql<number>`count(*)::int`,
      })
      .from(semanticLinks)
      .where(sql`${semanticLinks.sourceRecordId} IN (${sql.join(recordIds.map(id => sql`${id}`), sql`, `)})`)
      .groupBy(semanticLinks.sourceRecordId)

    const targetCounts = await db
      .select({
        recordId: semanticLinks.targetRecordId,
        count: sql<number>`count(*)::int`,
      })
      .from(semanticLinks)
      .where(sql`${semanticLinks.targetRecordId} IN (${sql.join(recordIds.map(id => sql`${id}`), sql`, `)})`)
      .groupBy(semanticLinks.targetRecordId)

    for (const { recordId, count } of sourceCounts) {
      linkCounts.set(recordId, (linkCounts.get(recordId) ?? 0) + count)
      // Source links = downstream edits that built on this record
      downstreamCounts.set(recordId, (downstreamCounts.get(recordId) ?? 0) + count)
    }
    for (const { recordId, count } of targetCounts) {
      linkCounts.set(recordId, (linkCounts.get(recordId) ?? 0) + count)
    }
  }

  // Update each record's engagement depth
  for (const record of recentRecords) {
    const linkCount = linkCounts.get(record.id) ?? 0
    const downstreamCount = downstreamCounts.get(record.id) ?? 0
    const newDepth = computeEngagementDepth(
      record.hasEvidence,
      linkCount,
      record.isKeyChange,
      downstreamCount
    )

    // Only update if changed
    if (Math.abs(newDepth - record.engagementDepth) > 0.001) {
      await db
        .update(indexRecords)
        .set({ engagementDepth: newDepth })
        .where(eq(indexRecords.id, record.id))

      // Sprint IX-10: capture new live state reflecting the engagement change.
      // Fire-and-forget; never block the engagement updater on state capture.
      try {
        const { captureIndexRecordState } = await import('./state-capture')
        captureIndexRecordState({
          indexRecordId: record.id,
          stateType: 'live',
          capturedBy: 'indexer',
          captureReason: `engagement depth ${record.engagementDepth.toFixed(3)} → ${newDepth.toFixed(3)}`,
        }).catch((err) => {
          console.warn('[EngagementUpdater] State capture failed (non-fatal):', err)
        })
      } catch {
        // import failure is non-fatal
      }
    }
  }
}

/**
 * Compute engagement depth from component signals.
 */
export function computeEngagementDepth(
  hasEvidence: boolean,
  linkCount: number,
  isKeyChange: boolean,
  downstreamEditCount: number = 0
): number {
  const evidenceScore = hasEvidence ? 0.3 : 0
  const linkScore = Math.min(linkCount * 0.02, 0.2)
  const keyChangeScore = isKeyChange ? 0.15 : 0
  const downstreamScore = Math.min(downstreamEditCount * 0.1, 0.2)

  return Math.min(1.0, evidenceScore + linkScore + keyChangeScore + downstreamScore)
}
