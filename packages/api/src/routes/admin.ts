/**
 * Admin API Routes (Sprint IX-3)
 *
 * POST /gdpr-redact     — Redact user personal data from evidence
 * POST /legal-hold      — Place a document under legal hold
 * DELETE /legal-hold    — Lift a legal hold
 * POST /retention-policy — Set workspace retention policy
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth'
import { requirePermission } from '../middleware/permissions'
import { db } from '../db/index'
import { eq, and, desc } from 'drizzle-orm'
import { indexRecords, evidenceRecords } from '../db/schema/semantic-index'
import { computeRecordHash, getLastEvidenceHash } from '../services/semantic-index/hash-chain'

const adminRouter = new Hono()
adminRouter.use('*', authMiddleware)

// ─── GDPR Redaction ──────────────────────────────────────────────────────────

const RedactSchema = z.object({
  targetUserId: z.string().uuid(),
  workspaceId: z.string().uuid(),
})

adminRouter.post('/gdpr-redact', requirePermission('admin'), zValidator('json', RedactSchema), async (c) => {
  const body = c.req.valid('json')
  const { targetUserId, workspaceId } = body

  // Check for legal holds on any documents this user contributed to
  const userDocs = await db
    .selectDistinct({ documentId: indexRecords.documentId })
    .from(indexRecords)
    .where(and(eq(indexRecords.userId, targetUserId), eq(indexRecords.workspaceId, workspaceId)))

  const heldDocs: string[] = []
  for (const doc of userDocs) {
    if (!doc.documentId) continue
    const [hold] = await db
      .select({ id: evidenceRecords.id })
      .from(evidenceRecords)
      .where(
        and(
          eq(evidenceRecords.documentId, doc.documentId),
          eq(evidenceRecords.evidenceType, 'legal_hold')
        )
      )
      .limit(1)

    // Check it hasn't been lifted
    if (hold) {
      const [lift] = await db
        .select({ id: evidenceRecords.id })
        .from(evidenceRecords)
        .where(
          and(
            eq(evidenceRecords.documentId, doc.documentId),
            eq(evidenceRecords.evidenceType, 'legal_hold_lifted')
          )
        )
        .orderBy(desc(evidenceRecords.createdAt))
        .limit(1)

      if (!lift) heldDocs.push(doc.documentId)
    }
  }

  if (heldDocs.length > 0) {
    return c.json(
      {
        data: null,
        error: {
          code: 'LEGAL_HOLD',
          message: `Cannot redact: ${heldDocs.length} document(s) under legal hold`,
          heldDocumentIds: heldDocs,
        },
      },
      409
    )
  }

  // Redact user-owned evidence
  let redactedCount = 0
  const userEvidence = await db
    .select()
    .from(evidenceRecords)
    .where(and(eq(evidenceRecords.userId, targetUserId), eq(evidenceRecords.ownershipTier, 'user')))

  for (const record of userEvidence) {
    await db
      .update(evidenceRecords)
      .set({
        sourceSnapshot: null,
        chatExchange: null,
        userId: null,
        redactedAt: new Date(),
        redactedFields: ['sourceSnapshot', 'chatExchange', 'userId'],
      })
      .where(eq(evidenceRecords.id, record.id))
    redactedCount++
  }

  // Redact user-specific fields from document-owned evidence
  const docEvidence = await db
    .select()
    .from(evidenceRecords)
    .where(
      and(eq(evidenceRecords.userId, targetUserId), eq(evidenceRecords.ownershipTier, 'document'))
    )

  for (const record of docEvidence) {
    await db
      .update(evidenceRecords)
      .set({
        sourceSnapshot: null, // remove browsing data
        redactedAt: new Date(),
        redactedFields: ['sourceSnapshot'],
      })
      .where(eq(evidenceRecords.id, record.id))
    redactedCount++
  }

  // Anonymize index records (keep for document provenance)
  await db
    .update(indexRecords)
    .set({ userName: '[deleted user]' })
    .where(and(eq(indexRecords.userId, targetUserId), eq(indexRecords.workspaceId, workspaceId)))

  return c.json({
    data: {
      redactedEvidenceRecords: redactedCount,
      anonymizedIndexRecords: userDocs.length,
      message: 'User personal data redacted. Document provenance facts preserved.',
    },
    error: null,
  })
})

// ─── Legal Hold ──────────────────────────────────────────────────────────────

const LegalHoldSchema = z.object({
  documentId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  reason: z.string().min(1),
})

adminRouter.post('/legal-hold', requirePermission('admin'), zValidator('json', LegalHoldSchema), async (c) => {
  const userId = c.get('userId') as string
  const body = c.req.valid('json')

  const prevHash = await getLastEvidenceHash(body.documentId)
  const now = new Date()

  const holdData: typeof evidenceRecords.$inferInsert = {
    workspaceId: body.workspaceId,
    documentId: body.documentId,
    userId,
    evidenceType: 'legal_hold',
    sourceSnapshot: {
      reason: body.reason,
      placedBy: userId,
      placedAt: now.toISOString(),
    },
    hashChainPrev: prevHash,
    recordHash: '',
    ownershipTier: 'org',
    retentionPolicy: 'legal_hold',
  }

  holdData.recordHash = computeRecordHash(
    {
      sourceSnapshot: holdData.sourceSnapshot as Record<string, unknown>,
      userId,
      timestamp: now.toISOString(),
    },
    prevHash
  )

  await db.insert(evidenceRecords).values(holdData)

  return c.json({
    data: { documentId: body.documentId, status: 'legal_hold_active', reason: body.reason },
    error: null,
  })
})

adminRouter.delete('/legal-hold', requirePermission('admin'), zValidator('json', z.object({
  documentId: z.string().uuid(),
  reason: z.string().min(1),
})), async (c) => {
  const userId = c.get('userId') as string
  const body = c.req.valid('json')

  // Verify active hold exists
  const [hold] = await db
    .select()
    .from(evidenceRecords)
    .where(
      and(
        eq(evidenceRecords.documentId, body.documentId),
        eq(evidenceRecords.evidenceType, 'legal_hold')
      )
    )
    .orderBy(desc(evidenceRecords.createdAt))
    .limit(1)

  if (!hold) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'No active legal hold' } },
      404
    )
  }

  const prevHash = await getLastEvidenceHash(body.documentId)
  const now = new Date()

  const liftData: typeof evidenceRecords.$inferInsert = {
    workspaceId: hold.workspaceId,
    documentId: body.documentId,
    userId,
    evidenceType: 'legal_hold_lifted',
    sourceSnapshot: {
      reason: body.reason,
      liftedBy: userId,
      liftedAt: now.toISOString(),
      originalHoldId: hold.id,
    },
    hashChainPrev: prevHash,
    recordHash: '',
    ownershipTier: 'org',
  }

  liftData.recordHash = computeRecordHash(
    {
      sourceSnapshot: liftData.sourceSnapshot as Record<string, unknown>,
      userId,
      timestamp: now.toISOString(),
    },
    prevHash
  )

  await db.insert(evidenceRecords).values(liftData)

  return c.json({
    data: { documentId: body.documentId, status: 'legal_hold_lifted', reason: body.reason },
    error: null,
  })
})

// ─── Retention Policy ────────────────────────────────────────────────────────

const RetentionSchema = z.object({
  workspaceId: z.string().uuid(),
  policy: z.enum(['default', 'sox_7yr', 'hipaa_6yr', 'custom']),
  retentionYears: z.number().positive().optional(),
})

adminRouter.post('/retention-policy', requirePermission('admin'), zValidator('json', RetentionSchema), async (c) => {
  const userId = c.get('userId') as string
  const body = c.req.valid('json')

  // Store retention policy as an evidence record (org-owned, workspace-scoped)
  const now = new Date()
  const policyData: typeof evidenceRecords.$inferInsert = {
    workspaceId: body.workspaceId,
    userId,
    evidenceType: 'retention_policy',
    contentAfter: JSON.stringify({ policy: body.policy, retentionYears: body.retentionYears }),
    sourceSnapshot: {
      policy: body.policy,
      retentionYears: body.retentionYears ?? null,
      setBy: userId,
      setAt: now.toISOString(),
    },
    recordHash: '',
    ownershipTier: 'org',
    retentionPolicy: body.policy,
  }

  policyData.recordHash = computeRecordHash(
    {
      contentAfter: policyData.contentAfter,
      sourceSnapshot: policyData.sourceSnapshot as Record<string, unknown>,
      userId,
      timestamp: now.toISOString(),
    },
    null
  )

  await db.insert(evidenceRecords).values(policyData)

  return c.json({ data: { policy: body.policy, workspaceId: body.workspaceId }, error: null })
})

export { adminRouter }
