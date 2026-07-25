/**
 * Reference Agent — Entry Point (Sprint RA-2)
 *
 * Four-stage pipeline:
 *   Stage 0: rule-based pre-classification (preClassify, <1ms)
 *   Stage 1: LLM classification (classifyQuery, ~300-500ms via Gemini Flash)
 *   Stage 2: retrieval plan generation (planRetrieval, pure, <1ms)
 *   Stage 3: parallel retrieval (executeRetrievalPlan)
 *   Stage 4: context assembly (assembleContext, pure)
 *
 * Fail-open at every stage: any error → bypass agent → fast path.
 * Returns an `AssembledContext` package that the chat completion layer
 * appends to the system prompt. `versionCitations` are exposed
 * separately so they can be saved into chat message metadata for
 * future provenance UI.
 */

import { classifyQuery, preClassify } from './classifier'
import type { ClassificationResult, QueryIntent } from './classifier'
import { planRetrieval } from './planner'
import type { RetrievalPlan, RetrievalStep } from './planner'
import { executeRetrievalPlan, findContradictsEdgesAmong } from './retriever'
import type { RetrievalResult, RetrievedItem } from './retriever'
import { assembleContext } from './assembler'
import type { AssembledContext, VersionCitation } from './assembler'
import type { Boundary } from '../scope/types'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentInput {
  query: string
  workspaceId: string
  userId: string
  documentId?: string
  externalDocId?: string
  documentTitle?: string
  hasCollaborators?: boolean
  /**
   * Sprint V41-QUERY-1: optional scope boundaries applied per-source at
   * retrieval AND as a defense-in-depth post-filter in the assembler.
   * Fail-closed: items missing the attribute a boundary needs are dropped.
   */
  boundaries?: Boundary[]
}

export interface AgentResult {
  bypassed: boolean
  classification: ClassificationResult
  plan: RetrievalPlan | null
  context: AssembledContext | null
  versionCitations: VersionCitation[]
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

export async function invokeReferenceAgent(input: AgentInput): Promise<AgentResult> {
  // Stage 0: rule-based pre-classification (no LLM call, <1ms)
  const preResult = preClassify(input.query)
  if (preResult) {
    return {
      bypassed: true,
      classification: preResult,
      plan: null,
      context: null,
      versionCitations: [],
    }
  }

  // Stage 1: LLM classification (~300-500ms via Gemini Flash)
  const classification = await classifyQuery({
    query: input.query,
    currentDocumentId: input.documentId,
    currentDocumentTitle: input.documentTitle,
    workspaceId: input.workspaceId,
    hasCollaborators: input.hasCollaborators,
  })

  // Simple queries bypass the agent
  if (classification.bypassAgent) {
    return {
      bypassed: true,
      classification,
      plan: null,
      context: null,
      versionCitations: [],
    }
  }

  // Stage 2: generate retrieval plan (pure, <1ms)
  const plan = planRetrieval(classification, {
    workspaceId: input.workspaceId,
    documentId: input.documentId,
    externalDocId: input.externalDocId,
    userId: input.userId,
  })

  // Stage 3: execute retrieval plan in parallel.
  // V41-QUERY-1: boundaries flow through to per-source filters + a
  // retrieval-level post-filter pass.
  const retrieval = await executeRetrievalPlan(plan, { boundaries: input.boundaries })

  // SCOPE-A-1: surface cross-author contradictions among the retrieved facts.
  // Collect record ids, look up `contradicts` edges bounded to that set, and
  // hand them to the assembler (which marks contested + emits a contested block).
  const recordIds = retrieval.items
    .map((i) => i.recordId)
    .filter((v): v is string => typeof v === 'string')
  const contradictsEdges = await findContradictsEdgesAmong(recordIds)

  // Stage 4: assemble context package.
  // V41-QUERY-1: defense-in-depth — assembler applies boundaries AGAIN
  // with fail-closed semantics, catching anything that slipped through.
  const context = assembleContext(classification, retrieval, {
    boundaries: input.boundaries,
    contradictsEdges,
  })

  console.info('[ReferenceAgent] Complete:', JSON.stringify(context.summary))

  return {
    bypassed: false,
    classification,
    plan,
    context,
    versionCitations: context.versionCitations,
  }
}

// ─── Re-exports ──────────────────────────────────────────────────────────────

export { classifyQuery, preClassify } from './classifier'
export { planRetrieval } from './planner'
export { executeRetrievalPlan } from './retriever'
export { assembleContext } from './assembler'
export type {
  ClassificationResult,
  QueryIntent,
  RetrievalPlan,
  RetrievalStep,
  RetrievedItem,
  RetrievalResult,
  AssembledContext,
  VersionCitation,
}
