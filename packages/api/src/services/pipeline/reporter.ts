/**
 * Reporter (Stage 03 · Extract → nodes) — 2026-04-29
 *
 * Canonical entry point for turning ONE raw event (chat turn, doc edit,
 * capture, GWS snapshot, MCP tool call output) into a structured tentative
 * node. Confidence capped at 0.6; provenance is reproduced verbatim, never
 * inferred; tags must come from the active scope.
 *
 * Usage from new ingest paths:
 *
 *   import { reportEvent } from '../pipeline/reporter'
 *   const node = await reportEvent({
 *     userId, workspaceId,
 *     rawText: turnContent,
 *     provenance: { source_tool: 'claude', source_type: 'chat',
 *                   contributor: userName, timestamp: turnTime.toISOString() },
 *     scopeTags: ['precedent', 'pricing'],
 *   })
 *   if (node && !node.skip) { // insert into index_records ... }
 *
 * Legacy paths (bulk file indexing via indexing-agent.ts → enrichChunks)
 * continue to operate as before. Migrating them is a separate refactor —
 * the canonical Reporter is the path forward for new event types and for
 * gradual replacement of the legacy bulk enrichment.
 */

import { z } from 'zod'
import { pipelineLLMCall } from './llm-call'
import { REPORTER_SYSTEM_PROMPT } from './prompts'

// ─── Schemas ───────────────────────────────────────────────────────────────

const MAGNITUDES = ['small', 'medium', 'large'] as const

const SkipResponseSchema = z.object({
  skip: z.literal(true),
})

const NodeResponseSchema = z.object({
  skip: z.literal(false).optional().default(false),
  embedding_text: z.string().min(1).max(400),
  summary: z.string().min(1).max(280),
  topics: z.array(z.string()).max(4).default([]),
  entities: z
    .object({
      people: z.array(z.string()).default([]),
      decisions: z.array(z.string()).default([]),
      dates: z.array(z.string()).default([]),
      actionItems: z.array(z.string()).default([]),
    })
    .default({ people: [], decisions: [], dates: [], actionItems: [] }),
  claim: z.string().max(140).nullable().optional(),
  magnitude: z.enum(MAGNITUDES).default('small'),
  confidence: z.number().min(0).max(1),
  applicableTags: z.array(z.string()).default([]),
  tentative: z.literal(true).optional().default(true),
})

const ReporterResponseSchema = z.union([SkipResponseSchema, NodeResponseSchema])

export type ReporterNode = z.infer<typeof NodeResponseSchema>
export type ReporterResponse = z.infer<typeof ReporterResponseSchema>

// ─── Public entry ──────────────────────────────────────────────────────────

export interface ReportEventInput {
  userId: string
  workspaceId: string
  /** Raw event text — chat turn body, edit diff, capture text, etc. */
  rawText: string
  /** Verbatim provenance fields. The Reporter does not invent these. */
  provenance: {
    source_tool: string // 'claude' | 'chatgpt' | 'cursor' | 'gws' | 'manual' | ...
    source_type: string // 'chat' | 'doc_edit' | 'capture' | 'gws_snapshot' | ...
    contributor: string
    timestamp: string // ISO
  }
  /** Closed list of tags the user has on the active scope. */
  scopeTags?: string[]
  /** Optional context the LLM may use to disambiguate (e.g. document title). */
  context?: {
    documentTitle?: string
    sectionAlias?: string
    threadType?: string
  }
}

export async function reportEvent(input: ReportEventInput): Promise<ReporterResponse | null> {
  const scopeTags = input.scopeTags ?? []

  // The system prompt has a {scopeTags} placeholder — substitute at call time
  // so the LLM sees the closed set as JSON.
  const systemPrompt = REPORTER_SYSTEM_PROMPT.replace(
    '{scopeTags}',
    JSON.stringify(scopeTags)
  )

  const userMessage = JSON.stringify({
    rawText: input.rawText.slice(0, 4000),
    provenance: input.provenance,
    context: input.context ?? {},
  })

  const response = await pipelineLLMCall({
    tier: 'REPORTER',
    systemPrompt,
    userMessage,
    responseSchema: ReporterResponseSchema,
    userId: input.userId,
    source: `reporter:${input.provenance.source_type}`,
    temperature: 0.1,
    maxTokens: 800,
  })

  if (!response) return null

  // Hard-clamp confidence to ≤0.6 even if the model exceeded it. Filter
  // applicableTags to the closed set the user supplied. Both happen on a
  // narrowed copy to keep the union-typed return clean.
  if ('embedding_text' in response) {
    const r = response as ReporterNode
    const tags = r.applicableTags ?? []
    const sanitized: ReporterNode = {
      skip: false,
      embedding_text: r.embedding_text,
      summary: r.summary,
      topics: r.topics ?? [],
      entities: r.entities ?? { people: [], decisions: [], dates: [], actionItems: [] },
      claim: r.claim ?? null,
      magnitude: r.magnitude ?? 'small',
      confidence: Math.min(r.confidence, 0.6),
      applicableTags: tags.filter((t) => scopeTags.includes(t)),
      tentative: true,
    }
    return sanitized
  }

  return response
}
