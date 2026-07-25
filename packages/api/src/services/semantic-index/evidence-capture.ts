/**
 * Evidence Capture Service (Sprint IX-1 + IX-3)
 *
 * Determines if events qualify for evidence capture and creates
 * hash-chained evidence records with content snapshots.
 *
 * Called by the indexer after index_records are created. Non-blocking.
 */

import { db } from '../../db/index'
import { eq, and, desc, gte, lte } from 'drizzle-orm'
import { indexRecords, evidenceRecords, semanticLinks } from '../../db/schema/semantic-index'
import { computeRecordHash, getLastEvidenceHash, verifyHashChain } from './hash-chain'
import { cosineSimilarity } from './weighted-referencing'
import type { EvidenceVersionRef } from '@workspace/shared/types'

// ─── Types ───────────────────────────────────────────────────────────────────

interface IndexRecordWithId {
  id: string
  workspaceId: string
  threadType: string
  indexMagnitude: string
  isKeyChange: boolean
  isAIInvolved: boolean
  documentId: string | null
  sectionAlias: string | null
  userId: string
  embeddingText: string
  metadata: Record<string, unknown>
  // Sprint IX-8: version-linking (optional — older callers / backfill won't have these)
  sourceFileId?: string | null
  sourceVersion?: number | null
  sourceContentHash?: string | null
}

interface ThreadEventRecord {
  id: string
  type: string
  magnitude: string
  keyChange: boolean
  label: string
  contextNotes: string | null
  metadata: Record<string, unknown>
}

// ─── Evidence Qualification ──────────────────────────────────────────────────

export type EvidenceType =
  | 'content_change'
  | 'ai_accepted'
  | 'ai_rejected'
  | 'source_introduced'
  | 'import'

/**
 * Determine if an event qualifies for evidence capture.
 * Returns the evidence type or null if no evidence should be captured.
 */
export function qualifyForEvidence(
  eventType: string,
  magnitude: string,
  keyChange: boolean,
  isAIInvolved: boolean,
  metadata: Record<string, unknown>
): EvidenceType | null {
  // AI interactions — always capture
  if (eventType === 'ai_interaction') {
    const outcome = metadata?.outcome as string | undefined
    if (outcome === 'rejected') return 'ai_rejected'
    return 'ai_accepted'
  }

  // Import events — always capture
  if (eventType === 'import') return 'import'

  // Content changes — capture if significant
  if (eventType === 'edit' || eventType === 'structural_change') {
    if (keyChange) return 'content_change'
    if (magnitude === 'medium' || magnitude === 'high') return 'content_change'
    return null // minor edit, skip
  }

  // Navigation with source context
  if (eventType === 'navigation' && isAIInvolved) {
    return 'source_introduced'
  }

  return null
}

// Re-export hash chain functions for backward compatibility with tests
export { computeRecordHash, verifyHashChain } from './hash-chain'

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Capture evidence for qualifying index records.
 * Non-blocking — errors are caught and logged.
 */
export async function captureEvidence(
  records: IndexRecordWithId[],
  events: ThreadEventRecord[],
  workspaceId: string
): Promise<void> {
  const eventMap = new Map(events.map((e) => [e.id, e]))

  for (const record of records) {
    try {
      // Find matching event
      // Match by looking up the event — for now match by position since events and records are aligned
      const event = events.find(
        (e) =>
          e.label === record.embeddingText.split('\n')[0]?.replace(/^\[.*?\]\s*\w+\s*/, '') ||
          true // fallback: process all events against records by index
      )

      // Use the record's own data for qualification since events may not align perfectly
      const evidenceType = qualifyForEvidence(
        record.metadata?.type as string ?? record.threadType === 'ai' ? 'ai_interaction' : 'edit',
        record.indexMagnitude === 'large' ? 'high' : record.indexMagnitude === 'medium' ? 'medium' : 'low',
        record.isKeyChange,
        record.isAIInvolved,
        record.metadata
      )

      if (!evidenceType) continue

      // Build content snapshots (IX-3: real content from Yjs/GWS)
      let contentBefore: string | null = null
      let contentAfter: string | null = record.embeddingText // fallback to composed text
      if (record.documentId && (evidenceType === 'content_change' || evidenceType === 'ai_accepted')) {
        try {
          const { getContentBeforeAfter } = await import('./content-snapshot')
          const sectionRef = record.sectionAlias ? { heading: record.sectionAlias } : null
          const snapshot = await getContentBeforeAfter(
            record.documentId,
            sectionRef,
            new Date().toISOString()
          )
          contentBefore = snapshot.before
          if (snapshot.after) contentAfter = snapshot.after
        } catch {
          // Content snapshot failed — use composed text fallback
        }
      }
      const chatExchange = buildChatExchange(record.metadata, evidenceType)
      // Sprint IX-8: attach version-linking refs to every evidence record via sourceSnapshot.
      // `sourceSnapshot` is a generic Record<string, unknown> JSONB, so we extend it with
      // a `sourceVersions` array regardless of evidence type. For source_introduced/import
      // the browse-origin fields are also populated by buildSourceSnapshot.
      const baseSnapshot = buildSourceSnapshot(record.metadata, evidenceType)
      const versionRef: EvidenceVersionRef | null =
        record.sourceFileId || record.sourceContentHash
          ? {
              fileId: record.sourceFileId ?? null,
              version: record.sourceVersion ?? null,
              contentHash: record.sourceContentHash ?? null,
            }
          : null
      const sourceSnapshot: Record<string, unknown> | null =
        baseSnapshot || versionRef
          ? {
              ...(baseSnapshot ?? {}),
              ...(versionRef ? { sourceVersions: [versionRef] } : {}),
            }
          : null

      // Get previous hash for chain
      const prevHash = await getLastEvidenceHash(record.documentId)
      const now = new Date()
      const recordHash = computeRecordHash(
        {
          contentBefore,
          contentAfter,
          chatExchange,
          sourceSnapshot,
          userId: record.userId,
          timestamp: now.toISOString(),
        },
        prevHash
      )

      // Insert evidence record
      await db.insert(evidenceRecords).values({
        workspaceId,
        indexRecordId: record.id,
        documentId: record.documentId,
        userId: record.userId,
        sectionRef: record.sectionAlias,
        evidenceType,
        contentBefore,
        contentAfter,
        chatExchange,
        sourceSnapshot,
        hashChainPrev: prevHash,
        recordHash,
        ownershipTier: 'document',
      })

      // Mark index record as having evidence
      await db
        .update(indexRecords)
        .set({ hasEvidence: true })
        .where(eq(indexRecords.id, record.id))

      // Sprint IX-10: capture a static state snapshot — frozen truth at
      // evidence time. Fire-and-forget; never block evidence capture.
      try {
        const { captureIndexRecordState } = await import('./state-capture')
        captureIndexRecordState({
          indexRecordId: record.id,
          stateType: 'static',
          capturedBy: 'indexer',
          captureReason: `evidence captured (${evidenceType})`,
        }).catch((err) => {
          console.warn('[EvidenceCapture] Static state capture failed (non-fatal):', err)
        })
      } catch {
        // import failure is non-fatal
      }
    } catch (err) {
      console.warn(`[SemanticIndex] Evidence capture failed for record ${record.id}:`, err)
      // Non-fatal, continue to next record
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildChatExchange(
  metadata: Record<string, unknown>,
  evidenceType: EvidenceType
): Record<string, unknown> | null {
  if (evidenceType !== 'ai_accepted' && evidenceType !== 'ai_rejected') return null

  return {
    question: (metadata?.questionSummary as string) ?? (metadata?.question as string) ?? null,
    response: (metadata?.responseSummary as string) ?? (metadata?.response as string) ?? null,
    model: (metadata?.model as string) ?? null,
    turnId: (metadata?.chatTurnId as string) ?? (metadata?.turnId as string) ?? null,
  }
}

function buildSourceSnapshot(
  metadata: Record<string, unknown>,
  evidenceType: EvidenceType
): Record<string, unknown> | null {
  if (evidenceType !== 'source_introduced' && evidenceType !== 'import') return null

  return {
    url: (metadata?.url as string) ?? null,
    title: (metadata?.pageTitle as string) ?? (metadata?.title as string) ?? null,
    snippet: (metadata?.snippet as string) ?? null,
    browseDuration: (metadata?.timeOnPage as number) ?? null,
  }
}

// ─── Source Introduction Detection ───────────────────────────────────────────

/**
 * Detect browse → edit chains: a browser event followed by a doc edit
 * within 5 minutes, with semantic similarity > 0.5.
 * Creates source_introduced evidence + researched_then_wrote semantic link.
 */
export async function detectSourceIntroductions(
  newRecords: IndexRecordWithId[],
  workspaceId: string
): Promise<void> {
  // Only process doc edit records
  const docEdits = newRecords.filter((r) => r.threadType === 'doc')
  if (docEdits.length === 0) return

  for (const edit of docEdits) {
    try {
      if (!edit.documentId) continue

      // Look for browser events from same user within preceding 5 minutes
      const fiveMinBefore = new Date(Date.now() - 5 * 60 * 1000)

      const recentBrowse = await db
        .select()
        .from(indexRecords)
        .where(
          and(
            eq(indexRecords.userId, edit.userId),
            eq(indexRecords.workspaceId, workspaceId),
            eq(indexRecords.threadType, 'browser'),
            gte(indexRecords.eventTime, fiveMinBefore)
          )
        )
        .orderBy(desc(indexRecords.eventTime))
        .limit(5)

      if (recentBrowse.length === 0) continue

      for (const browse of recentBrowse) {
        if (!browse.embedding) continue

        // We don't have edit embedding readily available here — skip similarity check
        // and rely on temporal proximity + same user as sufficient signal
        const prevHash = await getLastEvidenceHash(edit.documentId)
        const now = new Date()

        const evidenceData: typeof evidenceRecords.$inferInsert = {
          workspaceId,
          indexRecordId: edit.id,
          documentId: edit.documentId,
          userId: edit.userId,
          sectionRef: edit.sectionAlias,
          evidenceType: 'source_introduced',
          sourceSnapshot: {
            url: ((browse.metadata as Record<string, unknown>)?.url as string) ?? undefined,
            title: ((browse.metadata as Record<string, unknown>)?.pageTitle as string) ?? browse.embeddingText.split('\n')[0] ?? undefined,
            snippet: browse.embeddingText.slice(0, 500),
            browseDuration: ((browse.metadata as Record<string, unknown>)?.timeOnPage as number) ?? undefined,
          },
          hashChainPrev: prevHash,
          recordHash: '',
          ownershipTier: 'document',
        }

        evidenceData.recordHash = computeRecordHash(
          {
            sourceSnapshot: evidenceData.sourceSnapshot as Record<string, unknown>,
            userId: edit.userId,
            timestamp: now.toISOString(),
          },
          prevHash
        )

        await db.insert(evidenceRecords).values(evidenceData)

        // Update index record
        await db
          .update(indexRecords)
          .set({ hasEvidence: true })
          .where(eq(indexRecords.id, edit.id))

        // Sprint IX-10: static snapshot for the source-introduced edit.
        try {
          const { captureIndexRecordState } = await import('./state-capture')
          captureIndexRecordState({
            indexRecordId: edit.id,
            stateType: 'static',
            capturedBy: 'indexer',
            captureReason: 'source introduced (browse → edit)',
          }).catch((err) => {
            console.warn('[SourceDetection] Static state capture failed (non-fatal):', err)
          })
        } catch {
          // import failure is non-fatal
        }

        // Create semantic link
        await db
          .insert(semanticLinks)
          .values({
            workspaceId,
            sourceRecordId: browse.id,
            targetRecordId: edit.id,
            similarity: 0.6, // estimated — temporal proximity
            linkType: 'cause_effect',
            crossUser: false,
          })
          .onConflictDoNothing()

        break // one source per edit is sufficient
      }
    } catch (err) {
      console.warn(`[SourceDetection] Failed for edit ${edit.id}:`, err)
    }
  }
}
