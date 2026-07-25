/**
 * LangGraph shared-state annotation (GRAPH-1 · 2026-06-02)
 *
 * Maps the shared `PipelineState` contract onto LangGraph channels. Append
 * channels accumulate across nodes (the structural fix for the lost-facts bug);
 * `meta` / `profileDelta` merge; `events` is the reporter's input seed.
 */

import { Annotation } from '@langchain/langgraph'
import type {
  PipelineFact,
  PipelineGraphEdge,
  PipelineScore,
  PipelineEpisode,
  RetrievalTraceEntry,
  NodeLogEntry,
  PipelineMeta,
} from '@workspace/shared'
import type { ReportEventInput } from '../reporter'

const concat = <T>(a: T[], b: T[]): T[] => a.concat(b)

export const PipelineGraphState = Annotation.Root({
  facts: Annotation<PipelineFact[]>({ reducer: concat, default: () => [] }),
  edges: Annotation<PipelineGraphEdge[]>({ reducer: concat, default: () => [] }),
  scores: Annotation<PipelineScore[]>({ reducer: concat, default: () => [] }),
  episodes: Annotation<PipelineEpisode[]>({ reducer: concat, default: () => [] }),
  profileDelta: Annotation<Record<string, unknown>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  retrievalTrace: Annotation<RetrievalTraceEntry[]>({ reducer: concat, default: () => [] }),
  contributors: Annotation<string[]>({
    reducer: (a, b) => Array.from(new Set([...a, ...b])),
    default: () => [],
  }),
  nodeLog: Annotation<NodeLogEntry[]>({ reducer: concat, default: () => [] }),
  meta: Annotation<PipelineMeta>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({ persist: false }),
  }),
  events: Annotation<ReportEventInput[]>({ reducer: (_a, b) => b, default: () => [] }),
})

export type PipelineGraphStateType = typeof PipelineGraphState.State
