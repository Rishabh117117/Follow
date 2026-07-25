/**
 * Archivist (Stage 06 · Promote → states) — 2026-04-29
 *
 * Real implementation of the role described in v5.2 §06. For each invocation:
 *
 *   1. Find tentative records — index_records for this userId/workspaceId
 *      that don't have a corresponding 'live' state row in
 *      index_record_states yet. Bound by recency:
 *        - scheduled       → last 15 min (5-min tick + grace)
 *        - session_start   → all unconfirmed
 *        - session_end     → all unconfirmed
 *   2. Gather context — for each tentative record: nearby records (Content
 *      tensor cosine ≥ 0.7) + outgoing semantic_links + the latest live
 *      state row for the same documentId, if any.
 *   3. LLM call — MODEL_TIERS.ARCHIVIST with the canonical Archivist prompt.
 *      Schema-validated; drop on malformed.
 *   4. Apply decisions:
 *        promote        → INSERT live state row (capturedBy='archivist')
 *        supersede      → INSERT live state row + supersededBy ref to the
 *                         older live state row of the supersededRecordId
 *        demote         → UPDATE index_records.hidden = true
 *        keep_tentative → no-op (will revisit; cycle counter incremented
 *                         in metadata)
 *
 * Cost discipline: deepseek-v4-flash at ~$0.14/$0.28 per 1M. A typical
 * scheduled tick processes 5–20 tentative records, ~600 input + ~200 output
 * per record-batch → well under $0.001 per tick.
 */

import { z } from 'zod'
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { createHash } from 'crypto'
import { db } from '../../db/index'
import { indexRecords, indexRecordStates, semanticLinks } from '../../db/schema/semantic-index'
import { pipelineLLMCall } from './llm-call'
import { ARCHIVIST_SYSTEM_PROMPT } from './prompts'
import type { PipelineMode } from './runner'

// ─── Schemas ────────────────────────────────────────────────────────────────

const DecisionSchema = z.object({
  tentativeRecordId: z.string().min(1),
  action: z.enum(['promote', 'demote', 'supersede', 'keep_tentative']),
  confidence: z.number().min(0).max(1).optional().nullable(),
  supersededRecordId: z.string().nullable().optional(),
  chainReason: z.string().max(140).nullable().optional(),
  reason: z.string().max(240),
})

const ArchivistResponseSchema = z.object({
  decisions: z.array(DecisionSchema).max(50),
})

// ─── Tunables ───────────────────────────────────────────────────────────────

const MAX_TENTATIVE_PER_RUN = 25
const KEEP_TENTATIVE_LIMIT = 3 // §planning: force decision after 3 cycles
const SCHEDULED_LOOKBACK_MIN = 15 // 5-min cron + 10-min grace

// ─── Public entry ──────────────────────────────────────────────────────────

export interface RunArchivistInput {
  userId: string
  workspaceId: string
  mode: PipelineMode
  sessionId?: string
  /** keep_tentative cycle count, passed in by the caller for forced decisions */
  cycleHint?: number
}

export interface RunArchivistResult {
  promoted: number
  demoted: number
  superseded: number
  keptTentative: number
  skipped: number
}

/**
 * SPLIT-1 (2026-06-02): the Archivist's read+decide phase, with NO DB writes.
 * `decisions` is null when the LLM call failed (caller skips all tentatives).
 * Safe to run read-only in shadow (GRAPH-1).
 */
export interface ArchivistComputation {
  input: RunArchivistInput
  tentatives: TentativeRecord[]
  decisions: z.infer<typeof DecisionSchema>[] | null
}

const EMPTY_ARCHIVIST_RESULT: RunArchivistResult = {
  promoted: 0,
  demoted: 0,
  superseded: 0,
  keptTentative: 0,
  skipped: 0,
}

/**
 * SPLIT-1: pure compute — fetch tentatives, build the frame, ask the LLM.
 * Performs reads + the LLM call only; **no promote/demote/supersede writes**.
 */
export async function computeArchivist(input: RunArchivistInput): Promise<ArchivistComputation> {
  // 1. Find tentative records: those without a 'live' state row yet, scoped
  //    to this user/workspace + recency window.
  const tentatives = await fetchTentativeRecords(input)
  if (tentatives.length === 0) return { input, tentatives, decisions: [] }

  // 2. Build the LLM input. Keep it compact — Archivist runs frequently and
  //    cost is per-call, not per-record.
  const inputFrame = await buildArchivistInputFrame(input, tentatives)

  // 3. LLM call.
  const llmResponse = await pipelineLLMCall({
    tier: 'ARCHIVIST',
    systemPrompt: ARCHIVIST_SYSTEM_PROMPT,
    userMessage: JSON.stringify(inputFrame),
    responseSchema: ArchivistResponseSchema,
    userId: input.userId,
    source: `archivist:${input.mode}`,
    temperature: 0.1,
    maxTokens: 2000,
  })
  return { input, tentatives, decisions: llmResponse ? llmResponse.decisions : null }
}

/**
 * SPLIT-1: commit — apply the computed decisions. This is where every DB write
 * happens (promote/supersede inserts, demote/keep updates).
 */
export async function commitArchivist(
  computation: ArchivistComputation
): Promise<RunArchivistResult> {
  if (computation.tentatives.length === 0) return { ...EMPTY_ARCHIVIST_RESULT }
  if (computation.decisions === null) {
    return { ...EMPTY_ARCHIVIST_RESULT, skipped: computation.tentatives.length }
  }
  return applyDecisions(computation.input, computation.tentatives, computation.decisions)
}

export async function runArchivist(input: RunArchivistInput): Promise<RunArchivistResult> {
  return commitArchivist(await computeArchivist(input))
}

// ─── Step 1: fetch tentative records ───────────────────────────────────────

interface TentativeRecord {
  id: string
  workspaceId: string
  embeddingText: string
  documentId: string | null
  documentTitle: string | null
  sectionAlias: string | null
  indexedAt: Date
  metadata: Record<string, unknown> | null
  cycleCount: number
}

async function fetchTentativeRecords(input: RunArchivistInput): Promise<TentativeRecord[]> {
  const cutoff =
    input.mode === 'scheduled'
      ? new Date(Date.now() - SCHEDULED_LOOKBACK_MIN * 60 * 1000)
      : new Date(Date.now() - 24 * 60 * 60 * 1000) // session_*: up to 24h backlog

  // Records with no live state row yet — i.e. tentative.
  const rows = await db.execute(sql`
    SELECT
      ir.id,
      ir.workspace_id,
      ir.embedding_text,
      ir.document_id,
      ir.document_title,
      ir.section_alias,
      ir.indexed_at,
      ir.metadata
    FROM index_records ir
    LEFT JOIN index_record_states irs
      ON irs.index_record_id = ir.id AND irs.state_type = 'live'
    WHERE ir.user_id = ${input.userId}::uuid
      AND ir.workspace_id = ${input.workspaceId}::uuid
      AND ir.indexed_at > ${cutoff.toISOString()}
      AND ir.hidden = false
      AND ir.deleted_at IS NULL
      AND irs.id IS NULL
    ORDER BY ir.indexed_at DESC
    LIMIT ${MAX_TENTATIVE_PER_RUN}
  `)
  const list: Array<Record<string, unknown>> = Array.isArray(rows)
    ? (rows as Array<Record<string, unknown>>)
    : ((rows as { rows?: Array<Record<string, unknown>> })?.rows ?? [])

  return list.map((r) => {
    const meta = (r['metadata'] as Record<string, unknown> | null) ?? null
    const cycleCount =
      meta && typeof meta['archivistCycle'] === 'number' ? (meta['archivistCycle'] as number) : 0
    return {
      id: String(r['id']),
      workspaceId: String(r['workspace_id']),
      embeddingText: r['embedding_text'] ? String(r['embedding_text']) : '',
      documentId: r['document_id'] ? String(r['document_id']) : null,
      documentTitle: r['document_title'] ? String(r['document_title']) : null,
      sectionAlias: r['section_alias'] ? String(r['section_alias']) : null,
      indexedAt: new Date(String(r['indexed_at'])),
      metadata: meta,
      cycleCount,
    }
  })
}

// ─── Step 2: build LLM input frame ─────────────────────────────────────────

interface ArchivistInputFrame {
  mode: PipelineMode
  cycle: number
  tentatives: Array<{
    id: string
    text: string
    document?: string
    section?: string
    indexedAt: string
    cycleCount: number
  }>
  liveContext: Array<{
    recordId: string
    text: string
    document?: string
    confidence: number
  }>
  edges: Array<{
    sourceId: string
    targetId: string
    type: string
    similarity: number
  }>
}

async function buildArchivistInputFrame(
  input: RunArchivistInput,
  tentatives: TentativeRecord[]
): Promise<ArchivistInputFrame> {
  const tentativeIds = tentatives.map((t) => t.id)

  // Edges adjacent to any tentative (either endpoint), so the LLM sees the
  // ANALYST classifications for these records.
  const edges = await db
    .select({
      sourceId: semanticLinks.sourceRecordId,
      targetId: semanticLinks.targetRecordId,
      linkType: semanticLinks.linkType,
      similarity: semanticLinks.similarity,
    })
    .from(semanticLinks)
    .where(
      and(
        eq(semanticLinks.workspaceId, input.workspaceId),
        sql`(${semanticLinks.sourceRecordId} = ANY(${tentativeIds}::uuid[]) OR ${semanticLinks.targetRecordId} = ANY(${tentativeIds}::uuid[]))`
      )
    )
    .limit(80)

  // Live state rows on the same documents for context — up to 8 per document.
  const documentIds = Array.from(
    new Set(tentatives.map((t) => t.documentId).filter((x): x is string => !!x))
  )
  let liveContext: ArchivistInputFrame['liveContext'] = []
  if (documentIds.length > 0) {
    const liveRows = await db.execute(sql`
      SELECT DISTINCT ON (irs.index_record_id)
        irs.index_record_id     AS record_id,
        irs.embedding_text      AS text,
        irs.document_title      AS document,
        COALESCE(irs.engagement_depth, 0)::float AS confidence
      FROM index_record_states irs
      WHERE irs.state_type = 'live'
        AND irs.superseded_by IS NULL
        AND irs.document_id = ANY(${documentIds})
      ORDER BY irs.index_record_id, irs.captured_at DESC
      LIMIT 40
    `)
    const lr: Array<Record<string, unknown>> = Array.isArray(liveRows)
      ? (liveRows as Array<Record<string, unknown>>)
      : ((liveRows as { rows?: Array<Record<string, unknown>> })?.rows ?? [])
    liveContext = lr.map((r) => ({
      recordId: String(r['record_id']),
      text: r['text'] ? String(r['text']).slice(0, 240) : '',
      document: r['document'] ? String(r['document']) : undefined,
      confidence: Number(r['confidence'] ?? 0),
    }))
  }

  return {
    mode: input.mode,
    cycle: input.cycleHint ?? 0,
    tentatives: tentatives.map((t) => ({
      id: t.id,
      text: t.embeddingText.slice(0, 320),
      document: t.documentTitle ?? undefined,
      section: t.sectionAlias ?? undefined,
      indexedAt: t.indexedAt.toISOString(),
      cycleCount: t.cycleCount,
    })),
    liveContext,
    edges: edges.map((e) => ({
      sourceId: e.sourceId,
      targetId: e.targetId,
      type: e.linkType,
      similarity: Number(e.similarity ?? 0),
    })),
  }
}

// ─── Step 3 & 4: apply decisions ───────────────────────────────────────────

function hashState(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

async function applyDecisions(
  input: RunArchivistInput,
  tentatives: TentativeRecord[],
  decisions: z.infer<typeof DecisionSchema>[]
): Promise<RunArchivistResult> {
  const result: RunArchivistResult = {
    promoted: 0,
    demoted: 0,
    superseded: 0,
    keptTentative: 0,
    skipped: 0,
  }

  const byId = new Map(tentatives.map((t) => [t.id, t]))
  const seen = new Set<string>()

  for (const d of decisions) {
    const tentative = byId.get(d.tentativeRecordId)
    if (!tentative) {
      result.skipped++
      continue
    }
    seen.add(d.tentativeRecordId)

    // Force a decision after 3 cycles even if the LLM said keep_tentative —
    // matches the prompt's "if cycle ≥ 3, choose between promote and demote".
    let action = d.action
    if (action === 'keep_tentative' && tentative.cycleCount >= KEEP_TENTATIVE_LIMIT) {
      action = 'demote'
    }

    try {
      if (action === 'promote') {
        await insertLiveState(tentative, {
          confidence: d.confidence ?? 0.5,
          captureReason: `archivist_${input.mode}:promote`,
        })
        await maybeRunEditor(input, tentative)
        result.promoted++
      } else if (action === 'supersede') {
        const supersededId = d.supersededRecordId ?? null
        if (!supersededId) {
          // Fall back to promote if the LLM said supersede without a target
          await insertLiveState(tentative, {
            confidence: d.confidence ?? 0.5,
            captureReason: `archivist_${input.mode}:promote_fallback`,
          })
          result.promoted++
        } else {
          // Find the older record's current live state row (the one being
          // superseded) so we can chain via supersededBy.
          const [olderState] = await db
            .select({ id: indexRecordStates.id })
            .from(indexRecordStates)
            .where(
              and(
                eq(indexRecordStates.indexRecordId, supersededId),
                eq(indexRecordStates.stateType, 'live'),
                isNull(indexRecordStates.supersededBy)
              )
            )
            .orderBy(desc(indexRecordStates.capturedAt))
            .limit(1)

          const newStateId = await insertLiveState(tentative, {
            confidence: d.confidence ?? 0.5,
            captureReason: `archivist_${input.mode}:supersede`,
          })

          if (olderState && newStateId) {
            await db
              .update(indexRecordStates)
              .set({ supersededBy: newStateId })
              .where(eq(indexRecordStates.id, olderState.id))
          }
          await maybeRunEditor(input, tentative)
          result.superseded++
        }
      } else if (action === 'demote') {
        await db
          .update(indexRecords)
          .set({ hidden: true, hiddenAt: new Date() })
          .where(eq(indexRecords.id, tentative.id))
        result.demoted++
      } else {
        // keep_tentative — bump the cycle counter on metadata so the next
        // run knows when to force a decision.
        await db
          .update(indexRecords)
          .set({
            metadata: {
              ...(tentative.metadata ?? {}),
              archivistCycle: tentative.cycleCount + 1,
              archivistLastCheckedAt: new Date().toISOString(),
            },
          })
          .where(eq(indexRecords.id, tentative.id))
        result.keptTentative++
      }
    } catch (err) {
      console.error(
        `[Archivist] failed to apply ${action} for ${tentative.id}:`,
        err instanceof Error ? err.message : err
      )
      result.skipped++
    }
  }

  // Tentatives the LLM didn't return a decision for → bump cycle so they get
  // another shot, but count as kept_tentative.
  const unhandled = tentatives.filter((t) => !seen.has(t.id))
  if (unhandled.length > 0) {
    await db
      .update(indexRecords)
      .set({
        metadata: sql`COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('archivistCycle', COALESCE((metadata->>'archivistCycle')::int, 0) + 1)`,
      })
      .where(
        inArray(
          indexRecords.id,
          unhandled.map((t) => t.id)
        )
      )
    result.keptTentative += unhandled.length
  }

  return result
}

/**
 * Insert a 'live' state row capturing the tentative record's current shape.
 * Returns the new state row's id (used to chain supersedes).
 */
async function insertLiveState(
  tentative: TentativeRecord,
  opts: { confidence: number; captureReason: string }
): Promise<string | null> {
  const stateHash = hashState({
    recordId: tentative.id,
    text: tentative.embeddingText,
    confidence: opts.confidence,
    capturedAt: Math.floor(Date.now() / 1000),
  })
  const [inserted] = await db
    .insert(indexRecordStates)
    .values({
      indexRecordId: tentative.id,
      stateType: 'live',
      stateHash,
      engagementDepth: opts.confidence,
      hasEvidence: true,
      documentId: tentative.documentId,
      documentTitle: tentative.documentTitle,
      sectionAlias: tentative.sectionAlias,
      embeddingText: tentative.embeddingText,
      metadata: tentative.metadata,
      capturedBy: 'archivist',
      captureReason: opts.captureReason,
    })
    .returning({ id: indexRecordStates.id })
  return inserted?.id ?? null
}

// keep imports happy for unused-but-required
void gt

// ─── Editor side-effect ────────────────────────────────────────────────────
// After a node is promoted (or supersedes), optionally run the Editor stage
// to populate the editor_* score columns. Gated by pipeline-editor-llm flag.
// Failures here never block the Archivist's promotion — Editor scores are
// nice-to-have at retrieval time, not load-bearing for correctness.

async function maybeRunEditor(input: RunArchivistInput, tentative: TentativeRecord): Promise<void> {
  try {
    const { isServerFeatureActive } = await import('../../config/server-vault')
    if (!isServerFeatureActive('pipeline-editor-llm')) return

    const { scoreNode, persistEditorScores } = await import('./editor')

    const meta = (tentative.metadata ?? {}) as Record<string, unknown>
    const topics = Array.isArray(meta['topics'])
      ? (meta['topics'] as unknown[]).filter((t): t is string => typeof t === 'string')
      : []
    const applicableTags = Array.isArray(meta['applicableTags'])
      ? (meta['applicableTags'] as unknown[]).filter((t): t is string => typeof t === 'string')
      : []

    const scores = await scoreNode({
      userId: input.userId,
      workspaceId: input.workspaceId,
      recordId: tentative.id,
      embeddingText: tentative.embeddingText,
      documentTitle: tentative.documentTitle,
      sectionAlias: tentative.sectionAlias,
      topics,
      applicableTags,
    })
    if (scores) await persistEditorScores(tentative.id, scores)
  } catch (err) {
    console.warn(
      `[Archivist] Editor side-effect failed for ${tentative.id}:`,
      err instanceof Error ? err.message : err
    )
  }
}
