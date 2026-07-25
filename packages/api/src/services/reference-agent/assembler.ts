/**
 * Reference Agent — Context Assembler (Sprint RA-2)
 *
 * Pure function. Takes a RetrievalResult (from retriever.ts) and turns
 * it into an `AssembledContext` package: a structured text block ready
 * to append to the system prompt, plus a `versionCitations` array for
 * response metadata.
 *
 * No DB, no LLM, no side effects.
 */

import type { ClassificationResult } from './classifier'
import type { RetrievalResult, RetrievedItem } from './retriever'
import type { Boundary } from '../scope/types'
import { postFilterItems, type PostFilterStats } from './boundary-hook'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VersionCitation {
  sourceFileId?: string | null
  sourceVersion?: number | null
  sourceContentHash?: string | null
  timestamp?: string
  label: string
  /** SCOPE-A-1: author display name of the fact this citation refers to. */
  author?: string | null
}

/**
 * SCOPE-A-1: a `contradicts` edge between two retrieved records, as read from
 * `semantic_links` (top-level `reason` is null for ANALYST edges — the reason
 * lives in `metadata.analyst.reason`; the caller resolves it before passing).
 */
export interface ContestedEdge {
  sourceRecordId: string
  targetRecordId: string
  reason: string | null
  confidence: number | null
  crossUser: boolean
}

/**
 * SCOPE-A-1: a resolved contested pair surfaced in the assembled context —
 * both facts, both authors, and the disagreement reason. We surface; we never
 * pick a winner.
 */
export interface ContestedPair {
  reason: string | null
  confidence: number | null
  crossUser: boolean
  a: { recordId: string; author: string | null; summary: string }
  b: { recordId: string; author: string | null; summary: string }
}

export interface AssembledContext {
  /** The context block to append to the system prompt */
  contextBlock: string
  /** Version citations for response metadata (future: provenance panel) */
  versionCitations: VersionCitation[]
  /**
   * SCOPE-A-1: contested pairs (cross-author contradictions among the retrieved
   * facts). Empty unless `AssembleOptions.contradictsEdges` was supplied and
   * both endpoints are in the retrieved set. `crossUser` distinguishes
   * teammate disagreements from same-author ones.
   */
  contested?: ContestedPair[]
  /** Summary for logging/debugging */
  summary: {
    intent: string
    sourcesQueried: number
    itemsRetrieved: number
    latencyMs: number
    errors: number
  }
  /**
   * Sprint V41-QUERY-1: items dropped by the defense-in-depth post-filter.
   * A non-zero count here means something slipped past the retriever's
   * per-source pre-filter — useful for observability / debugging.
   */
  postFilterStats?: PostFilterStats
}

// ─── Main ────────────────────────────────────────────────────────────────────

const MAX_CONTENT_CHARS = 500

export interface AssembleOptions {
  /**
   * Sprint V41-QUERY-1: scope boundaries to apply as a final defense-in-depth
   * pass. Fail-closed: items whose attributes can't be verified against a
   * boundary are dropped. Governance wins.
   */
  boundaries?: Boundary[]
  /**
   * SCOPE-A-1: `contradicts` edges among the retrieved records. The assembler
   * resolves each edge whose BOTH endpoints are in the retrieved set into a
   * contested pair, marks the facts contested inline, and emits a contested
   * block. Surfacing only — no auto-resolution.
   */
  contradictsEdges?: ContestedEdge[]
}

export function assembleContext(
  classification: ClassificationResult,
  retrieval: RetrievalResult,
  opts: AssembleOptions = {}
): AssembledContext {
  const { errors, totalLatencyMs } = retrieval
  let items = retrieval.items
  let postFilterStats: PostFilterStats | undefined
  // Defense-in-depth: apply boundaries one more time. If the retriever
  // already filtered, this is usually a no-op; if not, this is the only
  // layer left before the text block is emitted to a model.
  if (opts.boundaries && opts.boundaries.length > 0) {
    const filtered = postFilterItems(items, opts.boundaries, { failClosed: true })
    items = filtered.items
    postFilterStats = filtered.stats
    if (filtered.stats.droppedFailed + filtered.stats.droppedUnknown > 0) {
      console.info(
        `[ReferenceAgent] Assembler post-filter dropped ${filtered.stats.droppedFailed} failed + ${filtered.stats.droppedUnknown} unknown`
      )
    }
  }

  if (items.length === 0) {
    return {
      contextBlock: '',
      versionCitations: [],
      summary: {
        intent: classification.intent,
        sourcesQueried: 0,
        itemsRetrieved: 0,
        latencyMs: totalLatencyMs,
        errors: errors.length,
      },
      postFilterStats,
    }
  }

  // Deduplicate by content prefix — same text from two sources only cited once
  const seen = new Set<string>()
  const uniqueItems = items.filter((item) => {
    const key = item.content.substring(0, 100)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const grouped = groupBySource(uniqueItems)

  // SCOPE-A-1: resolve contested pairs — `contradicts` edges whose BOTH
  // endpoints are present in the retrieved set. Bounded to the retrieved set,
  // so this is just an in-memory match against the supplied edges.
  const byRecordId = new Map<string, RetrievedItem>()
  for (const it of uniqueItems) {
    if (it.recordId) byRecordId.set(it.recordId, it)
  }
  const contested: ContestedPair[] = []
  const contestedIds = new Set<string>()
  for (const edge of opts.contradictsEdges ?? []) {
    const a = byRecordId.get(edge.sourceRecordId)
    const b = byRecordId.get(edge.targetRecordId)
    if (!a || !b) continue // only surface pairs where both facts are retrieved
    contestedIds.add(edge.sourceRecordId)
    contestedIds.add(edge.targetRecordId)
    contested.push({
      reason: edge.reason,
      confidence: edge.confidence,
      crossUser: edge.crossUser,
      a: {
        recordId: edge.sourceRecordId,
        author: a.citation.author ?? null,
        summary: truncateContent(a.content, 160),
      },
      b: {
        recordId: edge.targetRecordId,
        author: b.citation.author ?? null,
        summary: truncateContent(b.content, 160),
      },
    })
  }

  // Build the context block
  const sections: string[] = []
  sections.push(`[REFERENCE AGENT CONTEXT — intent: ${classification.intent}]`)
  sections.push(
    `The following information was retrieved from ${uniqueItems.length} sources to help answer this ${classification.intent} query.`
  )
  if (classification.temporalHint) {
    sections.push(`Time reference: "${classification.temporalHint}"`)
  }
  if (classification.topicHint) {
    sections.push(`Topic: "${classification.topicHint}"`)
  }
  if (classification.entityHint) {
    sections.push(`Entity: "${classification.entityHint}"`)
  }
  sections.push('')

  for (const [source, sourceItems] of Object.entries(grouped)) {
    sections.push(`--- ${formatSourceName(source)} ---`)
    for (const item of sourceItems) {
      // SCOPE-A-1: attribute each fact to its author inline (not in the section
      // header — one section can hold facts from multiple authors).
      const authorSuffix = item.citation.author ? ` — by ${item.citation.author}` : ''
      // SCOPE-A-1: mark facts that are contested by a contradicts edge.
      const contestedTag = item.recordId && contestedIds.has(item.recordId) ? ' ⚠ CONTESTED' : ''
      sections.push(`[${item.citation.label}${authorSuffix}${contestedTag}]`)
      sections.push(truncateContent(item.content, MAX_CONTENT_CHARS))
      sections.push('')
    }
  }

  // SCOPE-A-1: contested block — teammates disagree. Surface both sides and
  // attribute each; the model must present the disagreement, never resolve it.
  if (contested.length > 0) {
    sections.push('[CONTESTED — teammates disagree]')
    sections.push(
      'The following facts directly contradict each other. Present BOTH sides, attribute each to its author, and do NOT silently pick one.'
    )
    for (const c of contested) {
      const scope = c.crossUser ? 'cross-author' : 'same-author'
      const conf = c.confidence != null ? `, ${Math.round(c.confidence * 100)}% confidence` : ''
      sections.push(`- CONTESTED (${scope}${conf}):`)
      sections.push(`    • ${c.a.author ?? 'Unknown'}: "${c.a.summary}"`)
      sections.push(`    • ${c.b.author ?? 'Unknown'}: "${c.b.summary}"`)
      if (c.reason) sections.push(`    Reason: ${c.reason}`)
    }
    sections.push('')
  }

  // Citation instructions — tell the LLM how to use the context
  sections.push('[CITATION INSTRUCTIONS]')
  sections.push('When using the above context in your response:')
  sections.push(
    '- Reference specific versions when available (e.g., "In version 14 of the document...")'
  )
  sections.push('- If showing how something changed, cite both the old and new versions')
  sections.push('- If information conflicts between sources, note both sources and their versions')
  sections.push('- Do not fabricate version numbers — only cite versions that appear above')

  // Collect version citations (only those with some kind of version ref)
  const versionCitations: VersionCitation[] = uniqueItems
    .map((item) => ({
      sourceFileId: item.citation.sourceFileId ?? null,
      sourceVersion: item.citation.sourceVersion ?? null,
      sourceContentHash: item.citation.sourceContentHash ?? null,
      timestamp: item.citation.timestamp,
      label: item.citation.label,
      // SCOPE-A-1: carry author through to response metadata for provenance UI.
      author: item.citation.author ?? null,
    }))
    .filter((c) => c.sourceFileId || c.sourceVersion != null || c.timestamp)

  return {
    contextBlock: sections.join('\n'),
    versionCitations,
    contested,
    summary: {
      intent: classification.intent,
      sourcesQueried: Object.keys(grouped).length,
      itemsRetrieved: uniqueItems.length,
      latencyMs: totalLatencyMs,
      errors: errors.length,
    },
    postFilterStats,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupBySource(items: RetrievedItem[]): Record<string, RetrievedItem[]> {
  const groups: Record<string, RetrievedItem[]> = {}
  for (const item of items) {
    const key = item.source
    if (!groups[key]) groups[key] = []
    groups[key]!.push(item)
  }
  return groups
}

const SOURCE_NAMES: Record<string, string> = {
  index_records: 'Semantic Index',
  index_states: 'Index State History',
  file_versions: 'Document Versions',
  gws_snapshots: 'Google Doc Snapshots',
  episodes: 'Activity Episodes',
  evidence: 'Evidence Records',
  memory_layers: 'AI Memory',
  decision_trails: 'Decision History',
  chat_history: 'Chat Conversations',
  thread_events: 'Activity Timeline',
  foreign_refs: 'Shared Context (from collaborators)',
}

function formatSourceName(source: string): string {
  return SOURCE_NAMES[source] ?? source
}

function truncateContent(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content
  return content.substring(0, maxLen) + '… [truncated]'
}
