/**
 * Profiler (Stage 07 · Pattern → patterns) — 2026-04-29
 *
 * Real implementation. For each invocation:
 *
 *   1. Gather a 14-day slice of CONFIRMED records (those with a 'live' state
 *      row in index_record_states) for this userId/workspaceId. Dedupe by
 *      indexRecordId, take the freshest live state per record.
 *   2. Group / cap — bucket by hour-of-day, by topic, by document so the
 *      LLM sees a structured signal rather than 200 raw rows. Cap at the
 *      most recent 80 records to keep the prompt bounded (qwen3.5-122b-a10b
 *      has 32K context but cost is per-token; 80 records ≈ 6K input).
 *   3. LLM call — MODEL_TIERS.PROFILER with the canonical Profiler prompt.
 *      Schema-validated; drop on malformed.
 *   4. Persist — append-only writes to user_patterns and pattern_edge_priors,
 *      stamped with a fresh runId. The Analyst reads the latest priors per
 *      (userId, topicHint) at edge-classification time.
 *
 * Cost discipline: qwen3.5-122b-a10b ≈ $0.26/$2.08 per 1M. 80-record input
 * ≈ 6K tokens → ~$0.0016 input + ~$0.005 output cap. Daily uniform pass
 * across 1000 users ≈ $7/day.
 */

import { z } from 'zod'
import { randomUUID } from 'crypto'
import { sql } from 'drizzle-orm'
import { db } from '../../db/index'
import { userPatterns, patternEdgePriors } from '../../db/schema/user-patterns'
import { pipelineLLMCall } from './llm-call'
import { PROFILER_SYSTEM_PROMPT } from './prompts'
import type { PipelineMode } from './runner'

// ─── Schemas ───────────────────────────────────────────────────────────────

const PATTERN_KINDS = ['temporal', 'topical', 'collaborative', 'stuck', 'ai_acceptance'] as const
const EDGE_TYPES = ['references', 'supports', 'contradicts', 'elaborates', 'supersedes'] as const

const PatternSchema = z.object({
  kind: z.enum(PATTERN_KINDS),
  description: z.string().min(1).max(200),
  confidence: z.number().min(0).max(1),
  supportingRecordIds: z.array(z.string()).min(1),
})

const EdgePriorSchema = z.object({
  topicHint: z.string().min(1).max(120),
  edgeType: z.enum(EDGE_TYPES),
  weight: z.number().min(0).max(1),
  rationale: z.string().max(120).nullable().optional(),
})

const ProfilerResponseSchema = z.object({
  patterns: z.array(PatternSchema).max(20),
  workStyleNarrative: z.string().min(1).max(220),
  edgePriors: z.array(EdgePriorSchema).max(15),
})

// ─── Tunables ──────────────────────────────────────────────────────────────

const MAX_INPUT_RECORDS = 80
const MIN_RECORDS_FOR_RUN = 5
const EDGE_PRIOR_WEIGHT_FLOOR = 0.3 // §planning: drop weak priors

// ─── Public entry ──────────────────────────────────────────────────────────

export interface RunProfilerInput {
  userId: string
  workspaceId: string
  mode: PipelineMode
  sessionId?: string
}

export interface RunProfilerResult {
  runId: string | null
  patternsWritten: number
  edgePriorsWritten: number
  workStyleNarrative: string | null
  skipped: boolean
}

/**
 * SPLIT-1 (2026-06-02): the Profiler's read+decide phase, with NO DB writes.
 * `ran` is false when there were too few records; `llmResponse` is null on LLM
 * failure. Both map to a skip in commit. Safe to run read-only in shadow.
 */
export interface ProfilerComputation {
  input: RunProfilerInput
  records: ConfirmedRecord[]
  llmResponse: z.infer<typeof ProfilerResponseSchema> | null
  ran: boolean
}

const EMPTY_PROFILER_RESULT: RunProfilerResult = {
  runId: null,
  patternsWritten: 0,
  edgePriorsWritten: 0,
  workStyleNarrative: null,
  skipped: false,
}

/**
 * SPLIT-1: pure compute — gather the slice, build the frame, ask the LLM.
 * Reads + the LLM call only; **no pattern/edge-prior writes**.
 */
export async function computeProfiler(input: RunProfilerInput): Promise<ProfilerComputation> {
  // 1. Gather 14d slice of confirmed records.
  const records = await fetchConfirmedSlice(input)
  if (records.length < MIN_RECORDS_FOR_RUN) {
    return { input, records, llmResponse: null, ran: false }
  }

  // 2. Build the LLM input frame.
  const frame = buildProfilerInputFrame(input, records)

  // 3. LLM call.
  const llmResponse = await pipelineLLMCall({
    tier: 'PROFILER',
    systemPrompt: PROFILER_SYSTEM_PROMPT,
    userMessage: JSON.stringify(frame),
    responseSchema: ProfilerResponseSchema,
    userId: input.userId,
    source: `profiler:${input.mode}`,
    temperature: 0.2,
    maxTokens: 2500,
  })
  return { input, records, llmResponse, ran: true }
}

/** SPLIT-1: commit — persist the computed profile (the DB writes). */
export async function commitProfiler(computation: ProfilerComputation): Promise<RunProfilerResult> {
  if (!computation.ran || computation.llmResponse === null) {
    return { ...EMPTY_PROFILER_RESULT, skipped: true }
  }
  return persistProfilerOutput(computation.input, computation.llmResponse, computation.records)
}

export async function runProfiler(input: RunProfilerInput): Promise<RunProfilerResult> {
  return commitProfiler(await computeProfiler(input))
}

// ─── Step 1: fetch confirmed records ───────────────────────────────────────

interface ConfirmedRecord {
  recordId: string
  text: string
  documentId: string | null
  documentTitle: string | null
  sectionAlias: string | null
  topics: string[]
  capturedAt: Date
  confidence: number
}

async function fetchConfirmedSlice(input: RunProfilerInput): Promise<ConfirmedRecord[]> {
  // Latest live state per record over the last 14 days. We read state rows
  // because (a) they carry the Archivist's confidence as engagementDepth and
  // (b) only confirmed records have them.
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (irs.index_record_id)
      irs.index_record_id        AS record_id,
      irs.embedding_text         AS text,
      irs.document_id            AS document_id,
      irs.document_title         AS document_title,
      irs.section_alias          AS section_alias,
      ir.metadata                AS metadata,
      irs.captured_at            AS captured_at,
      COALESCE(irs.engagement_depth, 0)::float AS confidence
    FROM index_record_states irs
    JOIN index_records ir ON ir.id = irs.index_record_id
    WHERE ir.user_id = ${input.userId}::uuid
      AND ir.workspace_id = ${input.workspaceId}::uuid
      AND irs.state_type = 'live'
      AND irs.superseded_by IS NULL
      AND irs.captured_at > now() - interval '14 days'
      AND ir.hidden = false
      AND ir.deleted_at IS NULL
      AND irs.deleted_at IS NULL
    ORDER BY irs.index_record_id, irs.captured_at DESC
    LIMIT ${MAX_INPUT_RECORDS}
  `)
  const list: Array<Record<string, unknown>> = Array.isArray(rows)
    ? (rows as Array<Record<string, unknown>>)
    : ((rows as { rows?: Array<Record<string, unknown>> })?.rows ?? [])

  return list.map((r) => {
    const meta = (r['metadata'] as Record<string, unknown> | null) ?? null
    const topics =
      meta && Array.isArray(meta['topics'])
        ? (meta['topics'] as unknown[]).filter((t): t is string => typeof t === 'string')
        : []
    return {
      recordId: String(r['record_id']),
      text: r['text'] ? String(r['text']).slice(0, 240) : '',
      documentId: r['document_id'] ? String(r['document_id']) : null,
      documentTitle: r['document_title'] ? String(r['document_title']) : null,
      sectionAlias: r['section_alias'] ? String(r['section_alias']) : null,
      topics,
      capturedAt: new Date(String(r['captured_at'])),
      confidence: Number(r['confidence'] ?? 0),
    }
  })
}

// ─── Step 2: build LLM input frame ─────────────────────────────────────────

interface ProfilerInputFrame {
  mode: PipelineMode
  recordCount: number
  windowDays: number
  records: Array<{
    id: string
    text: string
    document?: string
    section?: string
    topics: string[]
    hour: number
    dayOfWeek: number
    capturedAt: string
    confidence: number
  }>
}

function buildProfilerInputFrame(
  input: RunProfilerInput,
  records: ConfirmedRecord[]
): ProfilerInputFrame {
  return {
    mode: input.mode,
    recordCount: records.length,
    windowDays: 14,
    records: records.map((r) => ({
      id: r.recordId,
      text: r.text,
      document: r.documentTitle ?? undefined,
      section: r.sectionAlias ?? undefined,
      topics: r.topics.slice(0, 4),
      hour: r.capturedAt.getHours(),
      dayOfWeek: r.capturedAt.getDay(),
      capturedAt: r.capturedAt.toISOString(),
      confidence: r.confidence,
    })),
  }
}

// ─── Step 4: persist ───────────────────────────────────────────────────────

async function persistProfilerOutput(
  input: RunProfilerInput,
  llm: z.infer<typeof ProfilerResponseSchema>,
  records: ConfirmedRecord[]
): Promise<RunProfilerResult> {
  const runId = randomUUID()
  const validRecordIds = new Set(records.map((r) => r.recordId))

  // Filter out patterns whose supportingRecordIds don't match the input set —
  // the LLM is prompted to cite real ids; this is the schema enforcement.
  const validPatterns = llm.patterns
    .map((p) => ({
      ...p,
      supportingRecordIds: p.supportingRecordIds.filter((id) => validRecordIds.has(id)),
    }))
    .filter((p) => p.supportingRecordIds.length > 0)

  const validPriors = llm.edgePriors.filter((p) => p.weight >= EDGE_PRIOR_WEIGHT_FLOOR)

  let patternsWritten = 0
  if (validPatterns.length > 0) {
    await db.insert(userPatterns).values(
      validPatterns.map((p) => ({
        userId: input.userId,
        workspaceId: input.workspaceId,
        runId,
        mode: input.mode,
        kind: p.kind,
        description: p.description,
        confidence: Math.min(p.confidence, 0.8),
        supportingRecordIds: p.supportingRecordIds,
        workStyleNarrative: llm.workStyleNarrative,
      }))
    )
    patternsWritten = validPatterns.length
  }

  let edgePriorsWritten = 0
  if (validPriors.length > 0) {
    await db.insert(patternEdgePriors).values(
      validPriors.map((p) => ({
        userId: input.userId,
        workspaceId: input.workspaceId,
        runId,
        topicHint: p.topicHint.toLowerCase(),
        edgeType: p.edgeType,
        weight: Math.min(p.weight, 0.8),
        rationale: p.rationale ?? null,
      }))
    )
    edgePriorsWritten = validPriors.length
  }

  return {
    runId,
    patternsWritten,
    edgePriorsWritten,
    workStyleNarrative: llm.workStyleNarrative,
    skipped: false,
  }
}
