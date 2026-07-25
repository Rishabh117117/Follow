/**
 * Hash Chain Module (Sprint IX-3)
 *
 * Shared hash computation and chain verification for evidence records.
 * Used by evidence-capture, sealed-snapshot, follow-notes, and admin routes.
 */

import { createHash } from 'crypto'
import { db } from '../../db/index'
import { eq, desc } from 'drizzle-orm'
import { evidenceRecords } from '../../db/schema/semantic-index'

/**
 * Compute SHA-256 hash of evidence record content.
 */
export function computeRecordHash(
  content: {
    contentBefore?: string | null
    contentAfter?: string | null
    chatExchange?: Record<string, unknown> | null
    sourceSnapshot?: Record<string, unknown> | null
    userId?: string
    timestamp?: string
  },
  prevHash: string | null
): string {
  const payload = JSON.stringify({
    contentBefore: content.contentBefore ?? null,
    contentAfter: content.contentAfter ?? null,
    chatExchange: content.chatExchange ?? null,
    sourceSnapshot: content.sourceSnapshot ?? null,
    userId: content.userId,
    timestamp: content.timestamp,
    prevHash,
  })
  return createHash('sha256').update(payload).digest('hex')
}

/**
 * Get the most recent evidence record hash for a document.
 * Used to continue the hash chain when inserting new evidence.
 */
export async function getLastEvidenceHash(documentId: string | null): Promise<string | null> {
  if (!documentId) return null
  const [last] = await db
    .select({ recordHash: evidenceRecords.recordHash })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.documentId, documentId))
    .orderBy(desc(evidenceRecords.createdAt))
    .limit(1)
  return last?.recordHash ?? null
}

/**
 * Verify the integrity of a hash chain for evidence records.
 */
export function verifyHashChain(
  records: Array<{
    recordHash: string
    hashChainPrev: string | null
    contentBefore?: string | null
    contentAfter?: string | null
    chatExchange?: Record<string, unknown> | null
    sourceSnapshot?: Record<string, unknown> | null
    userId?: string | null
    createdAt: Date | string
  }>
): { valid: boolean; brokenAt?: number } {
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!
    const prevHash = i === 0 ? null : records[i - 1]!.recordHash

    if (rec.hashChainPrev !== prevHash) {
      return { valid: false, brokenAt: i }
    }

    const expectedHash = computeRecordHash(
      {
        contentBefore: rec.contentBefore ?? undefined,
        contentAfter: rec.contentAfter ?? undefined,
        chatExchange: (rec.chatExchange as Record<string, unknown> | null) ?? undefined,
        sourceSnapshot: (rec.sourceSnapshot as Record<string, unknown> | null) ?? undefined,
        userId: rec.userId ?? undefined,
        timestamp:
          typeof rec.createdAt === 'string'
            ? rec.createdAt
            : rec.createdAt.toISOString(),
      },
      prevHash
    )

    if (rec.recordHash !== expectedHash) {
      return { valid: false, brokenAt: i }
    }
  }

  return { valid: true }
}

/**
 * Verify the hash chain for an entire document's evidence records.
 */
export async function verifyDocumentHashChain(documentId: string): Promise<{
  valid: boolean
  totalRecords: number
  brokenAt: string | null
}> {
  const records = await db
    .select()
    .from(evidenceRecords)
    .where(eq(evidenceRecords.documentId, documentId))
    .orderBy(evidenceRecords.createdAt)

  if (records.length === 0) return { valid: true, totalRecords: 0, brokenAt: null }

  const result = verifyHashChain(records)
  return {
    valid: result.valid,
    totalRecords: records.length,
    brokenAt: result.brokenAt !== undefined ? records[result.brokenAt]!.id : null,
  }
}
