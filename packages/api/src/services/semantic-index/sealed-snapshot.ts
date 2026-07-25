/**
 * Sealed Snapshot Service (Sprint IX-3)
 *
 * Creates an immutable snapshot of a document + provenance state
 * when a document is shared externally. Hash-chained for integrity.
 */

import { createHash } from 'crypto'
import { db } from '../../db/index'
import { eq, desc } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { indexRecords, evidenceRecords } from '../../db/schema/semantic-index'
import { computeRecordHash, getLastEvidenceHash } from './hash-chain'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SealedSnapshotInput {
  documentId: string
  workspaceId: string
  userId: string
  trigger: 'shared_externally' | 'exported' | 'submitted' | 'approved' | 'legal_hold'
  sharedWith?: string
  documentContent: string
  documentTitle: string
}

// ─── Main Function ──────────────────────────────────────────────────────────

/**
 * Create an immutable sealed snapshot of a document's current state.
 * Returns the snapshot's record hash.
 */
export async function createSealedSnapshot(input: SealedSnapshotInput): Promise<string> {
  const {
    documentId,
    workspaceId,
    userId,
    trigger,
    sharedWith,
    documentContent,
    documentTitle,
  } = input

  // Count provenance records for this document
  const indexCount = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(indexRecords)
    .where(eq(indexRecords.documentId, documentId))

  const evidenceCount = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.documentId, documentId))

  // Compute provenance state hash from all evidence hashes
  const allEvidence = await db
    .select({ recordHash: evidenceRecords.recordHash })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.documentId, documentId))
    .orderBy(evidenceRecords.createdAt)

  const provenanceChain = allEvidence.map((e) => e.recordHash).join('')
  const provenanceStateHash = createHash('sha256')
    .update(provenanceChain || 'empty')
    .digest('hex')

  // Compute snapshot hash
  const timestamp = new Date().toISOString()
  const snapshotHash = createHash('sha256')
    .update(documentContent + provenanceStateHash + timestamp + userId)
    .digest('hex')

  // Get last evidence hash for chain
  const prevHash = await getLastEvidenceHash(documentId)

  const snapshotData: typeof evidenceRecords.$inferInsert = {
    workspaceId,
    documentId,
    userId,
    evidenceType: 'sealed_snapshot',
    contentAfter: documentContent.slice(0, 50_000),
    sourceSnapshot: {
      trigger,
      sharedWith: sharedWith ?? null,
      documentTitle,
      indexRecordCount: indexCount[0]?.c ?? 0,
      evidenceRecordCount: evidenceCount[0]?.c ?? 0,
      provenanceStateHash,
      snapshotHash,
    },
    hashChainPrev: prevHash,
    recordHash: '',
    ownershipTier: 'org',
  }

  snapshotData.recordHash = computeRecordHash(
    {
      contentAfter: snapshotData.contentAfter,
      sourceSnapshot: snapshotData.sourceSnapshot as Record<string, unknown>,
      userId,
      timestamp,
    },
    prevHash
  )

  await db.insert(evidenceRecords).values(snapshotData)

  return snapshotData.recordHash
}
