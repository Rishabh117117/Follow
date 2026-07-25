/**
 * Editor (Stage 05 · Attribute → weights) — 2026-04-29
 *
 * Scores one node on confidence, importance, salience, freshness. Calibrated
 * 0–1 numbers at low temperature, never invents tags (only propagates).
 *
 * Wired into Archivist's promote action, gated by feature flag
 * `pipeline-editor-llm`. When OFF, promoted nodes get no editor scores
 * (columns stay null — retrieval falls back to similarity ranking only).
 */

import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index'
import { indexRecords } from '../../db/schema/semantic-index'
import { pipelineLLMCall } from './llm-call'
import { EDITOR_SYSTEM_PROMPT } from './prompts'

// ─── Schema ────────────────────────────────────────────────────────────────

const FRESHNESS = ['live', 'aging'] as const

const EditorResponseSchema = z.object({
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  salience: z.number().min(0).max(1),
  freshness: z.enum(FRESHNESS),
  propagatedTags: z.array(z.string()).default([]),
  rationale: z
    .object({
      confidence: z.string().max(120).optional(),
      importance: z.string().max(120).optional(),
      salience: z.string().max(120).optional(),
    })
    .optional()
    .default({}),
})

export type EditorScores = z.infer<typeof EditorResponseSchema>

// ─── Public entry ──────────────────────────────────────────────────────────

export interface ScoreNodeInput {
  userId: string
  workspaceId: string
  recordId: string
  embeddingText: string
  documentTitle?: string | null
  sectionAlias?: string | null
  topics?: string[]
  /** Tags from the source — Editor may drop, never add. */
  applicableTags?: string[]
  /** Recent similar-record summaries (for salience calibration). */
  neighborText?: string[]
  /** Outgoing edges (typed) so the Editor sees what supports / contradicts. */
  edges?: Array<{ type: string; targetSummary: string }>
}

export async function scoreNode(input: ScoreNodeInput): Promise<EditorScores | null> {
  const userMessage = JSON.stringify({
    node: {
      id: input.recordId,
      text: input.embeddingText.slice(0, 400),
      document: input.documentTitle ?? null,
      section: input.sectionAlias ?? null,
      topics: input.topics ?? [],
      applicableTags: input.applicableTags ?? [],
    },
    neighbors: (input.neighborText ?? []).slice(0, 6).map((t) => t.slice(0, 200)),
    edges: (input.edges ?? []).slice(0, 8).map((e) => ({
      type: e.type,
      target: e.targetSummary.slice(0, 160),
    })),
  })

  const response = await pipelineLLMCall({
    tier: 'EDITOR',
    systemPrompt: EDITOR_SYSTEM_PROMPT,
    userMessage,
    responseSchema: EditorResponseSchema,
    userId: input.userId,
    source: 'editor:promote_score',
    temperature: 0.0,
    maxTokens: 400,
  })
  if (!response) return null

  const allowedTags = new Set(input.applicableTags ?? [])
  const tags = response.propagatedTags ?? []
  return {
    confidence: Math.min(response.confidence, 0.8),
    importance: Math.max(0, Math.min(response.importance, 1)),
    salience: Math.max(0, Math.min(response.salience, 1)),
    freshness: response.freshness,
    propagatedTags: tags.filter((t) => allowedTags.has(t)),
    rationale: response.rationale ?? {},
  }
}

/**
 * Persist Editor scores to the index_records row. Idempotent — re-running
 * just overwrites with fresh numbers.
 */
export async function persistEditorScores(
  recordId: string,
  scores: EditorScores
): Promise<void> {
  await db
    .update(indexRecords)
    .set({
      editorConfidence: scores.confidence,
      editorImportance: scores.importance,
      editorSalience: scores.salience,
      editorFreshness: scores.freshness,
      editorRunAt: new Date(),
    })
    .where(eq(indexRecords.id, recordId))
}
