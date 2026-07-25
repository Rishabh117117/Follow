/**
 * PipelineState contract (GRAPH-1 · 2026-06-02)
 *
 * The shared-state shape the LangGraph router threads through every pipeline
 * node. Each node reads and appends to this single object, so facts/topics
 * accumulate instead of being recomputed and lost — the structural fix for the
 * historical `totalFacts:0 / topicsCovered:[]` bug.
 *
 * Pure Zod + verdict helpers; no LangGraph dependency (that lives in the api
 * package's graph harness).
 */

import { z } from 'zod'

export const PipelineFactSchema = z.object({
  id: z.string(),
  text: z.string(),
  topics: z.array(z.string()).default([]),
  confidence: z.number().default(0),
  contributor: z.string().optional(),
})
export type PipelineFact = z.infer<typeof PipelineFactSchema>

export const PipelineGraphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.string(),
  weight: z.number().default(0),
})
export type PipelineGraphEdge = z.infer<typeof PipelineGraphEdgeSchema>

export const PipelineScoreSchema = z.object({
  recordId: z.string(),
  importance: z.number().optional(),
  salience: z.number().optional(),
  confidence: z.number().optional(),
})
export type PipelineScore = z.infer<typeof PipelineScoreSchema>

export const PipelineEpisodeSchema = z.object({ id: z.string(), title: z.string().optional() })
export type PipelineEpisode = z.infer<typeof PipelineEpisodeSchema>

export const RetrievalTraceEntrySchema = z.object({
  lane: z.string(),
  hits: z.number().default(0),
})
export type RetrievalTraceEntry = z.infer<typeof RetrievalTraceEntrySchema>

export const NodeLogEntrySchema = z.object({
  node: z.string(),
  persist: z.boolean(),
  note: z.string().optional(),
  counts: z.record(z.string(), z.number()).optional(),
})
export type NodeLogEntry = z.infer<typeof NodeLogEntrySchema>

export const PipelineMetaSchema = z.object({
  persist: z.boolean().default(false),
  userId: z.string().optional(),
  workspaceId: z.string().optional(),
  mode: z.string().optional(),
})
export type PipelineMeta = z.infer<typeof PipelineMetaSchema>

export const PipelineStateSchema = z.object({
  facts: z.array(PipelineFactSchema).default([]),
  edges: z.array(PipelineGraphEdgeSchema).default([]),
  scores: z.array(PipelineScoreSchema).default([]),
  episodes: z.array(PipelineEpisodeSchema).default([]),
  profileDelta: z.record(z.string(), z.unknown()).default({}),
  retrievalTrace: z.array(RetrievalTraceEntrySchema).default([]),
  contributors: z.array(z.string()).default([]),
  nodeLog: z.array(NodeLogEntrySchema).default([]),
  meta: PipelineMetaSchema.default({ persist: false }),
})
export type PipelineState = z.infer<typeof PipelineStateSchema>

/** Topics covered = the union of all fact topics. */
export function topicsCovered(facts: Pick<PipelineFact, 'topics'>[]): string[] {
  return Array.from(new Set(facts.flatMap((f) => f.topics)))
}

export interface ShadowVerdict {
  pass: boolean
  totalFacts: number
  topicsCovered: string[]
}

/**
 * GRAPH-1 shadow verdict: the router-over-shared-state harness is healthy iff
 * facts accumulated AND at least one topic was covered — i.e. the historical
 * `totalFacts:0 / topicsCovered:[]` bug is structurally gone.
 */
export function computeShadowVerdict(state: Pick<PipelineState, 'facts'>): ShadowVerdict {
  const topics = topicsCovered(state.facts)
  return {
    pass: state.facts.length > 0 && topics.length > 0,
    totalFacts: state.facts.length,
    topicsCovered: topics,
  }
}
