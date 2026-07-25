/**
 * Reference Agent — Retrieval Planner (Sprint RA-1)
 *
 * Pure function — no DB calls, no side effects, no LLM.
 * Maps a `ClassificationResult` into a structured `RetrievalPlan` that
 * RA-2 will execute against the data sources.
 *
 * The planner vocabulary (`source` field) is the union of every place
 * Follow stores knowledge: memory layers, the semantic index, the live/
 * static state history from IX-10, file versions, GWS snapshots from
 * IX-9, episodes, evidence, decision trails, chat history, foreign refs
 * (shared slices), and raw thread events.
 */

import type { ClassificationResult, QueryIntent } from './classifier'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A single data source to query, with parameters.
 */
export interface RetrievalStep {
  source:
    | 'memory_layers' // AI state 4-layer
    | 'index_records' // semantic index with embeddings
    | 'index_states' // index_record_states (live/static history, IX-10)
    | 'file_versions' // fileVersions table
    | 'gws_snapshots' // gws_snapshots table (IX-9)
    | 'episodes' // episode clusters from episode-refiner
    | 'evidence' // evidence_records
    | 'decision_trails' // documentDecisionTrails
    | 'chat_history' // chatMessages by conversation
    | 'foreign_refs' // shared slice content from other indexes
    | 'thread_events' // raw thread_events for fine-grained history

  priority: 'required' | 'optional' // required = must succeed; optional = best-effort

  params: {
    workspaceId?: string
    documentId?: string
    externalDocId?: string
    userId?: string // GOVERNANCE-AUDIT-FIX-1: threaded through for memory_layers
    query?: string // semantic search query
    topic?: string // topic filter for episodes
    entity?: string // person/doc filter
    version?: number // specific version number
    asOfTimestamp?: Date // point-in-time filter
    timeRange?: { start: Date; end: Date }
    limit?: number
  }

  reason: string // human-readable explanation for debugging/provenance
}

/**
 * The complete retrieval plan.
 */
export interface RetrievalPlan {
  intent: QueryIntent
  steps: RetrievalStep[]
  estimatedLatencyMs: number // rough estimate for a loading UI
  citationStrategy: 'version' | 'timestamp' | 'source_chain' | 'none'
}

// ─── Planner ─────────────────────────────────────────────────────────────────

/**
 * Generate a retrieval plan based on query classification.
 *
 * Pure function — no DB calls, no side effects.
 * Maps intent → data sources with appropriate parameters.
 */
export function planRetrieval(
  classification: ClassificationResult,
  context: {
    workspaceId: string
    documentId?: string
    externalDocId?: string
    userId?: string
  }
): RetrievalPlan {
  const { intent, temporalHint, versionHint, topicHint, entityHint, reasoning } = classification
  const { workspaceId, documentId, externalDocId, userId } = context

  const asOfTimestamp = temporalHint ? resolveTemporalHint(temporalHint) : undefined

  switch (intent) {
    case 'temporal':
      return {
        intent,
        steps: [
          {
            source: 'episodes',
            priority: 'required',
            params: {
              workspaceId,
              topic: topicHint,
              entity: entityHint,
              asOfTimestamp,
            },
            reason: `Find episodes near "${temporalHint}" to locate the exact event`,
          },
          {
            source: 'index_states',
            priority: 'required',
            params: { workspaceId, documentId, asOfTimestamp },
            reason: 'Get index state at the time of the referenced event',
          },
          {
            source: externalDocId ? 'gws_snapshots' : 'file_versions',
            priority: 'required',
            params: {
              workspaceId,
              documentId,
              externalDocId,
              version: versionHint,
              asOfTimestamp,
            },
            reason: 'Get document content at the referenced version/time',
          },
          {
            source: 'thread_events',
            priority: 'optional',
            params: {
              workspaceId,
              documentId,
              entity: entityHint,
              asOfTimestamp,
              limit: 10,
            },
            reason: 'Get fine-grained activity around the referenced time',
          },
        ],
        estimatedLatencyMs: 1500,
        citationStrategy: 'version',
      }

    case 'cross_version':
      return {
        intent,
        steps: [
          {
            source: externalDocId ? 'gws_snapshots' : 'file_versions',
            priority: 'required',
            params: {
              workspaceId,
              documentId,
              externalDocId,
              version: versionHint,
            },
            reason: 'Get the earlier version of the document for comparison',
          },
          {
            source: 'index_records',
            priority: 'required',
            params: {
              workspaceId,
              documentId: documentId ?? externalDocId,
              query: topicHint,
            },
            reason:
              'Get index records grouped by source_version to see what changed in understanding',
          },
          {
            source: 'decision_trails',
            priority: 'optional',
            params: { workspaceId, documentId },
            reason:
              'Check if there is a recorded decision trail explaining why the change was made',
          },
          {
            source: 'evidence',
            priority: 'optional',
            params: {
              workspaceId,
              documentId: documentId ?? externalDocId,
            },
            reason: 'Find evidence records that informed the change',
          },
        ],
        estimatedLatencyMs: 2000,
        citationStrategy: 'version',
      }

    case 'contradiction':
      return {
        intent,
        steps: [
          {
            source: 'index_records',
            priority: 'required',
            params: {
              workspaceId,
              query: topicHint ?? reasoning,
              limit: 20,
            },
            reason: 'Find all index records related to the contradicted topic',
          },
          {
            source: 'foreign_refs',
            priority: 'required',
            params: { workspaceId, topic: topicHint },
            reason: 'Check shared slices from collaborators for conflicting facts',
          },
          {
            source: 'evidence',
            priority: 'required',
            params: { workspaceId, query: topicHint },
            reason: 'Get evidence records to see which sources support each side',
          },
          {
            source: 'index_states',
            priority: 'optional',
            params: { workspaceId, documentId },
            reason: 'Get state history to see when the contradiction emerged',
          },
        ],
        estimatedLatencyMs: 2000,
        citationStrategy: 'source_chain',
      }

    case 'provenance':
      return {
        intent,
        steps: [
          {
            source: 'evidence',
            priority: 'required',
            params: {
              workspaceId,
              documentId: documentId ?? externalDocId,
            },
            reason: 'Follow the evidence chain from the paragraph back to index records',
          },
          {
            source: 'index_records',
            priority: 'required',
            params: {
              workspaceId,
              documentId: documentId ?? externalDocId,
            },
            reason:
              'Get the index records referenced by evidence, with source_version + source_content_hash',
          },
          {
            source: externalDocId ? 'gws_snapshots' : 'file_versions',
            priority: 'required',
            params: { workspaceId, documentId, externalDocId },
            reason:
              'Retrieve the actual source content at the referenced version for verification',
          },
          {
            source: 'thread_events',
            priority: 'optional',
            params: { workspaceId, documentId, limit: 5 },
            reason: 'Get the activity events surrounding when this content was indexed',
          },
        ],
        estimatedLatencyMs: 1500,
        citationStrategy: 'source_chain',
      }

    case 'multi_layer':
      return {
        intent,
        steps: [
          {
            source: 'memory_layers',
            priority: 'required',
            params: { workspaceId, userId, documentId, query: topicHint ?? reasoning },
            reason: 'Search all memory layers for topic-related knowledge',
          },
          {
            source: 'index_records',
            priority: 'required',
            params: {
              workspaceId,
              query: topicHint ?? reasoning,
              limit: 30,
            },
            reason: 'Semantic search across the full index for the topic',
          },
          {
            source: 'episodes',
            priority: 'required',
            params: { workspaceId, topic: topicHint },
            reason: 'Get episode clusters related to the topic',
          },
          {
            source: 'foreign_refs',
            priority: 'optional',
            params: { workspaceId, topic: topicHint },
            reason: 'Check shared slices from collaborators for additional context',
          },
          {
            source: 'chat_history',
            priority: 'optional',
            params: { workspaceId, query: topicHint, limit: 10 },
            reason: 'Search chat history for discussions about the topic',
          },
        ],
        estimatedLatencyMs: 2500,
        citationStrategy: 'source_chain',
      }

    case 'longitudinal':
      return {
        intent,
        steps: [
          {
            source: 'index_states',
            priority: 'required',
            params: {
              workspaceId,
              documentId,
              timeRange: resolveTimeRange(temporalHint),
            },
            reason: 'Get state history over time to see how understanding evolved',
          },
          {
            source: 'memory_layers',
            priority: 'required',
            params: { workspaceId, userId, documentId, query: topicHint ?? reasoning },
            reason:
              'Get condensation history from session layer (shows compressed understanding over time)',
          },
          {
            source: 'episodes',
            priority: 'required',
            params: { workspaceId, topic: topicHint },
            reason: 'Get episode timeline to see activity patterns',
          },
          {
            source: externalDocId ? 'gws_snapshots' : 'file_versions',
            priority: 'optional',
            params: { workspaceId, documentId, externalDocId },
            reason:
              'Get version history to correlate understanding changes with content changes',
          },
        ],
        estimatedLatencyMs: 2000,
        citationStrategy: 'timestamp',
      }

    case 'simple':
    default:
      // Should never reach here — simple queries bypass the agent
      return {
        intent: 'simple',
        steps: [],
        estimatedLatencyMs: 0,
        citationStrategy: 'none',
      }
  }
}

// ─── Temporal Helpers ────────────────────────────────────────────────────────

/**
 * Resolve a natural language temporal hint to an approximate Date.
 * Best-effort — used for initial filtering, not exact matching.
 */
function resolveTemporalHint(hint: string): Date | undefined {
  if (!hint) return undefined
  const h = hint.toLowerCase()
  const now = new Date()

  // Relative references
  if (h.includes('yesterday')) {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000)
  }
  if (h.includes('last week')) {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  }
  if (h.includes('last month')) {
    return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
  }

  // Month names (full or 3-letter abbrev)
  const months = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ]
  for (let i = 0; i < months.length; i++) {
    const full = months[i]!
    const abbrev = full.substring(0, 3)
    if (h.includes(full) || h.includes(abbrev)) {
      // Assume current year, middle of month
      return new Date(now.getFullYear(), i, 15)
    }
  }

  // Try Date.parse as last resort
  const parsed = Date.parse(hint)
  if (!isNaN(parsed)) {
    return new Date(parsed)
  }

  return undefined
}

/**
 * Resolve temporal hint to a time range for longitudinal queries.
 * Defaults to last 30 days if no hint given.
 */
function resolveTimeRange(hint?: string): { start: Date; end: Date } | undefined {
  const now = new Date()

  if (!hint) {
    return {
      start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      end: now,
    }
  }

  const resolved = resolveTemporalHint(hint)
  if (resolved) {
    return { start: resolved, end: now }
  }

  return undefined
}
