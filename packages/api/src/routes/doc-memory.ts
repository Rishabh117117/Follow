/**
 * Document Memory API Routes (Sprint IX-2)
 *
 * GET  /:fileId          — Latest DocumentMemory for a file (uses semantic index)
 * POST /:fileId/interpret — Trigger fresh interpretation via semantic index
 * GET  /:fileId/trail/:paragraphRef — Decision trail for a paragraph
 * PATCH /patterns/:patternId — Update or dismiss a pattern
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth'
import { assertWorkspaceAccess } from '../services/workspace-access'
import { db } from '../db/index'
import {
  documentInterpretations,
  documentPatterns,
  documentDecisionTrails,
  files,
} from '../db/schema/index'
import { and, eq, desc } from 'drizzle-orm'
import { executeIndexQuery } from '../services/semantic-index/query-executor'
import type {
  DocumentMemory,
  DocumentInterpretation,
  DocumentPattern,
  DocumentDecisionTrail as DDT,
  DecisionTrailStep,
} from '@workspace/shared/types'

const docMemoryRouter = new Hono()
docMemoryRouter.use('*', authMiddleware)

// ─── GET /:fileId — Latest DocumentMemory ────────────────────────────────────

docMemoryRouter.get('/:fileId', async (c) => {
  const fileId = c.req.param('fileId')
  const userId = c.get('userId') as string
  const workspaceId = (c.req.query('workspaceId') as string) ?? ''

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  // Try semantic index interpretation first
  let interpretation: DocumentInterpretation | null = null
  if (workspaceId) {
    try {
      const indexResult = await executeIndexQuery({
        workspaceId,
        userId,
        documentId: fileId,
        weightProfile: 'history',
        includeSummary: true,
        includeEpisodes: true,
        limit: 100,
      })

      if (indexResult.interpretation) {
        const interp = indexResult.interpretation as Record<string, unknown>
        interpretation = {
          id: `idx-${fileId}`,
          workspaceId,
          fileId,
          strandId: null,
          narrativePhase:
            (interp.narrativePhase as DocumentInterpretation['narrativePhase']) ?? 'exploration',
          narrativeConfidence: (interp.narrativeConfidence as number) ?? 0.5,
          narrativeSummary: (interp.narrativeSummary as string) ?? '',
          workingIntent: (interp.workingIntent as string) ?? '',
          intentEvidence: (interp.intentEvidence as string) ?? '',
          cognitiveState:
            (interp.cognitiveState as DocumentInterpretation['cognitiveState']) ?? 'exploring',
          activeTensions: (interp.activeTensions as DocumentInterpretation['activeTensions']) ?? [],
          sourceInfluence:
            (interp.sourceInfluence as DocumentInterpretation['sourceInfluence']) ?? [],
          unresolvedQuestions:
            (interp.unresolvedQuestions as DocumentInterpretation['unresolvedQuestions']) ?? [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      }
    } catch (err) {
      console.warn('[DocMemory] Index query failed, falling back to DB:', (err as Error).message)
    }
  }

  // Fallback: fetch from legacy documentInterpretations table
  if (!interpretation) {
    const [interpRow] = await db
      .select()
      .from(documentInterpretations)
      .where(
        and(
          eq(documentInterpretations.fileId, fileId),
          eq(documentInterpretations.workspaceId, workspaceId)
        )
      )
      .orderBy(desc(documentInterpretations.updatedAt))
      .limit(1)

    if (interpRow) {
      interpretation = {
        id: interpRow.id,
        workspaceId: interpRow.workspaceId,
        fileId: interpRow.fileId,
        strandId: interpRow.strandId,
        narrativePhase: interpRow.narrativePhase as DocumentInterpretation['narrativePhase'],
        narrativeConfidence: interpRow.narrativeConfidence,
        narrativeSummary: interpRow.narrativeSummary,
        workingIntent: interpRow.workingIntent,
        intentEvidence: interpRow.intentEvidence,
        cognitiveState: interpRow.cognitiveState as DocumentInterpretation['cognitiveState'],
        activeTensions: (interpRow.activeTensions ??
          []) as DocumentInterpretation['activeTensions'],
        sourceInfluence: (interpRow.sourceInfluence ??
          []) as DocumentInterpretation['sourceInfluence'],
        unresolvedQuestions: (interpRow.unresolvedQuestions ??
          []) as DocumentInterpretation['unresolvedQuestions'],
        createdAt: new Date(interpRow.createdAt).toISOString(),
        updatedAt: new Date(interpRow.updatedAt).toISOString(),
      }
    }
  }

  // Fetch top 10 patterns (non-dismissed)
  const patternRows = await db
    .select()
    .from(documentPatterns)
    .where(and(eq(documentPatterns.fileId, fileId), eq(documentPatterns.workspaceId, workspaceId)))
    .orderBy(desc(documentPatterns.confidence))
    .limit(10)

  // Fetch all decision trails
  const trailRows = await db
    .select()
    .from(documentDecisionTrails)
    .where(
      and(
        eq(documentDecisionTrails.fileId, fileId),
        eq(documentDecisionTrails.workspaceId, workspaceId)
      )
    )

  const patterns: DocumentPattern[] = patternRows
    .filter((p) => !(p.dismissed as boolean))
    .map((p) => ({
      id: p.id,
      fileId: p.fileId,
      pattern: p.pattern,
      confidence: p.confidence,
      reinforcedCount: p.reinforcedCount,
      lastReinforcedAt: new Date(p.lastReinforcedAt).toISOString(),
    }))

  const decisionTrails: DDT[] = trailRows.map((t) => ({
    id: t.id,
    fileId: t.fileId,
    paragraphRef: t.paragraphRef,
    trailSteps: (t.trailSteps ?? []) as DecisionTrailStep[],
    stabilityScore: t.stabilityScore,
    humanAuthoredPct: t.humanAuthoredPct,
    anchorSource: t.anchorSource,
  }))

  const memory: DocumentMemory = { interpretation, patterns, decisionTrails }

  return c.json({ data: memory, error: null })
})

// ─── POST /:fileId/interpret — Trigger interpretation ────────────────────────

const InterpretSchema = z.object({
  workspaceId: z.string().uuid(),
  strandId: z.string().uuid().optional(),
})

docMemoryRouter.post('/:fileId/interpret', zValidator('json', InterpretSchema), async (c) => {
  const fileId = c.req.param('fileId')
  const userId = c.get('userId') as string
  const body = c.req.valid('json')

  const denied = await assertWorkspaceAccess(c, body.workspaceId)
  if (denied) return denied

  // Use semantic index to generate interpretation
  const indexResult = await executeIndexQuery({
    workspaceId: body.workspaceId,
    userId,
    documentId: fileId,
    weightProfile: 'history',
    includeSummary: true,
    includeEpisodes: true,
    limit: 100,
  })

  return c.json({ data: indexResult.interpretation ?? null, error: null })
})

// ─── GET /:fileId/trail/:paragraphRef — Decision trail ───────────────────────

docMemoryRouter.get('/:fileId/trail/:paragraphRef', async (c) => {
  const fileId = c.req.param('fileId')
  const paragraphRef = c.req.param('paragraphRef')

  const [fileRow] = await db
    .select({ workspaceId: files.workspaceId })
    .from(files)
    .where(eq(files.id, fileId))
    .limit(1)
  if (!fileRow) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)
  }
  const denied = await assertWorkspaceAccess(c, fileRow.workspaceId)
  if (denied) return denied

  const trailRows = await db
    .select()
    .from(documentDecisionTrails)
    .where(eq(documentDecisionTrails.fileId, fileId))

  const trails: DDT[] = trailRows
    .filter((t) => !paragraphRef || t.paragraphRef === paragraphRef)
    .map((t) => ({
      id: t.id,
      fileId: t.fileId,
      paragraphRef: t.paragraphRef,
      trailSteps: (t.trailSteps ?? []) as DecisionTrailStep[],
      stabilityScore: t.stabilityScore,
      humanAuthoredPct: t.humanAuthoredPct,
      anchorSource: t.anchorSource,
    }))

  return c.json({ data: trails, error: null })
})

// ─── PATCH /patterns/:patternId — Update pattern ────────────────────────────

const UpdatePatternSchema = z.object({
  dismissed: z.boolean().optional(),
  pattern: z.string().optional(),
})

docMemoryRouter.patch(
  '/patterns/:patternId',
  zValidator('json', UpdatePatternSchema),
  async (c) => {
    const patternId = c.req.param('patternId')
    const body = c.req.valid('json')

    const [patternRow] = await db
      .select({ workspaceId: documentPatterns.workspaceId })
      .from(documentPatterns)
      .where(eq(documentPatterns.id, patternId))
      .limit(1)
    if (!patternRow) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Pattern not found' } }, 404)
    }
    const denied = await assertWorkspaceAccess(c, patternRow.workspaceId)
    if (denied) return denied

    const updates: Record<string, unknown> = {}
    if (body.dismissed !== undefined) updates['dismissed'] = body.dismissed
    if (body.pattern !== undefined) updates['pattern'] = body.pattern

    if (Object.keys(updates).length === 0) {
      return c.json(
        { data: null, error: { code: 'NO_UPDATES', message: 'No fields to update' } },
        400
      )
    }

    const [updated] = await db
      .update(documentPatterns)
      .set(updates as Partial<typeof documentPatterns.$inferInsert>)
      .where(eq(documentPatterns.id, patternId))
      .returning()

    if (!updated) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Pattern not found' } }, 404)
    }

    return c.json({ data: updated, error: null })
  }
)

export { docMemoryRouter }
