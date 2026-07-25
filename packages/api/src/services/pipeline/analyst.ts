/**
 * Analyst (Stage 04 · Relate → edges) — 2026-04-29
 *
 * For each candidate pair (already passed the cosine filter), call the LLM
 * to:
 *   - decide whether the relationship is real (default: 'none')
 *   - if real, classify it as one of the 5 typed edges
 *
 * Reads pattern_edge_priors as tie-breakers. Returns null if the model
 * fails or rejects the pair (caller should NOT insert an edge in that case).
 *
 * This is the wedge for §02b query 03 ("what is contested?"). The legacy
 * heuristic at indexer.ts:691-766 tags every cosine-near pair with a thread-
 * type-derived linkType — that's what the v5.2 doc §08 v5.2 note calls out
 * as the silently-discarded LLM classification. This module replaces it.
 */

import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db/index'
import { patternEdgePriors } from '../../db/schema/user-patterns'
import { pipelineLLMCall } from './llm-call'
import { ANALYST_SYSTEM_PROMPT } from './prompts'
import { facetEdgeSignal, type FacetSimilarity } from './facet-signal'

// ─── Schemas ───────────────────────────────────────────────────────────────

const EDGE_TYPES_WITH_NONE = [
  'references',
  'supports',
  'contradicts',
  'elaborates',
  'supersedes',
  'none',
] as const

const AnalystResponseSchema = z.object({
  edgeType: z.enum(EDGE_TYPES_WITH_NONE),
  confidence: z.number().min(0).max(1),
  // CONTRADICT-1: was 160 — the reasoning model writes 1-2 sentence reasons that
  // sometimes exceed it, dropping otherwise-valid verdicts. 400 keeps reasons
  // concise but stops needless drops.
  reason: z.string().max(400),
  directionality: z.enum(['a_to_b', 'b_to_a', 'symmetric']).default('a_to_b'),
})

export type AnalystEdgeType = (typeof EDGE_TYPES_WITH_NONE)[number]

// ─── Public entry ──────────────────────────────────────────────────────────

export interface ClassifyEdgeInput {
  userId: string
  workspaceId: string
  cosineSimilarity: number
  /**
   * EDGE-FACET-1: per-facet cosine triple { content, causal, context }.
   * Optional — when omitted, classifyEdge behaves exactly as before (the
   * scalar `cosineSimilarity` path is untouched), preserving back-compat.
   */
  facetSimilarity?: FacetSimilarity
  a: {
    id: string
    text: string
    documentTitle?: string | null
    contributor?: string | null
    timestamp?: string | null
    threadType?: string | null
    topics?: string[]
  }
  b: {
    id: string
    text: string
    documentTitle?: string | null
    contributor?: string | null
    timestamp?: string | null
    threadType?: string | null
    topics?: string[]
  }
}

export interface ClassifyEdgeResult {
  edgeType: Exclude<AnalystEdgeType, 'none'>
  confidence: number
  reason: string
  directionality: 'a_to_b' | 'b_to_a' | 'symmetric'
}

export async function classifyEdge(input: ClassifyEdgeInput): Promise<ClassifyEdgeResult | null> {
  // Look up edge priors that match either node's topics. Cap at 8 priors
  // so the prompt stays small.
  const topics = Array.from(
    new Set([...(input.a.topics ?? []), ...(input.b.topics ?? [])].map((t) => t.toLowerCase()))
  ).slice(0, 8)
  const priors = topics.length > 0 ? await fetchEdgePriors(input.userId, topics) : []

  const facets = input.facetSimilarity
  const userMessage = JSON.stringify({
    cosine: Number(input.cosineSimilarity.toFixed(3)),
    // EDGE-FACET-1: hand ANALYST the per-facet geometry + a derived pattern
    // hint. JSON.stringify drops these keys when facets are absent, so the
    // back-compat message is byte-identical to the pre-facet version.
    facets: facets
      ? {
          content: Number(facets.content.toFixed(3)),
          causal: Number(facets.causal.toFixed(3)),
          context: Number(facets.context.toFixed(3)),
        }
      : undefined,
    facetPattern: facets ? facetEdgeSignal(facets).pattern : undefined,
    a: {
      id: input.a.id,
      text: input.a.text.slice(0, 320),
      doc: input.a.documentTitle ?? null,
      contributor: input.a.contributor ?? null,
      timestamp: input.a.timestamp ?? null,
      threadType: input.a.threadType ?? null,
      topics: input.a.topics ?? [],
    },
    b: {
      id: input.b.id,
      text: input.b.text.slice(0, 320),
      doc: input.b.documentTitle ?? null,
      contributor: input.b.contributor ?? null,
      timestamp: input.b.timestamp ?? null,
      threadType: input.b.threadType ?? null,
      topics: input.b.topics ?? [],
    },
    priors,
  })

  const response = await pipelineLLMCall({
    tier: 'ANALYST',
    systemPrompt: ANALYST_SYSTEM_PROMPT,
    userMessage,
    responseSchema: AnalystResponseSchema,
    userId: input.userId,
    source: 'analyst:classify_pair',
    temperature: 0.0,
    // CONTRADICT-1 (2026-06-19): the ANALYST tier (deepseek-v4-pro) is a
    // *reasoning* model — it spends completion tokens on a `reasoning` preamble
    // before the JSON `content`. At 300 the reasoning starved the JSON (empty /
    // "Unterminated string" parse failures → every edge dropped). 1500 leaves
    // room for reasoning + the small verdict JSON.
    maxTokens: 1500,
  })

  if (!response) return null
  if (response.edgeType === 'none') return null

  return {
    edgeType: response.edgeType,
    confidence: Math.min(response.confidence, 0.8),
    reason: response.reason,
    directionality: response.directionality ?? 'a_to_b',
  }
}

// ─── Edge priors lookup ────────────────────────────────────────────────────

interface PriorView {
  topicHint: string
  edgeType: string
  weight: number
}

async function fetchEdgePriors(userId: string, topics: string[]): Promise<PriorView[]> {
  try {
    const rows = await db
      .select({
        topicHint: patternEdgePriors.topicHint,
        edgeType: patternEdgePriors.edgeType,
        weight: patternEdgePriors.weight,
      })
      .from(patternEdgePriors)
      .where(
        and(eq(patternEdgePriors.userId, userId), inArray(patternEdgePriors.topicHint, topics))
      )
      .limit(16)
    return rows.map((r) => ({
      topicHint: r.topicHint,
      edgeType: r.edgeType,
      weight: Number(r.weight ?? 0),
    }))
  } catch {
    // Table may not exist yet (migration not run) — degrade silently.
    return []
  }
}
