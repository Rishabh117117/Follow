/**
 * MCP Tool: query_index (Sprint MCP-1)
 *
 * Queries the user's personal or project index via the reference agent pipeline.
 * Falls back to direct semantic search if the agent fails.
 */

import type { MCPToolDefinition, MCPToolResult, MCPSession, MCPDependencies } from '../types'
import {
  resolveEffectiveBoundaries,
  applyPostFilters,
  summarizeConflictsForResponse,
  type Boundary,
} from '../../services/scope'
import { mcpSessionToken } from './scope-configure'
import {
  buildStructuredQuery,
  runStructuredQuery,
  serializeQueryToJson,
  type SelectSpec,
  type Aggregation,
} from '../../services/query'

export const queryIndexTool: MCPToolDefinition = {
  name: 'query_index',
  description:
    'Query the Follow knowledge index. Two modes: (1) Semantic — provide `query` natural-language string for a fuzzy retrieval via the reference agent, or (2) Structured — provide `structured` object with explicit Boundary[] + select spec for deterministic, exact, filtered retrieval (the "Query" ability). Both modes accept call-time boundaries override; both run governance pre-check.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language question (semantic mode). Omit when using `structured`.',
      },
      scope: {
        type: 'string',
        enum: ['personal', 'project', 'auto'],
        description:
          "Which index to query (semantic mode). 'auto' uses the active session scope. Default: 'auto'",
      },
      max_results: {
        type: 'number',
        description: 'Maximum results (semantic mode). Default: 5',
      },
      boundaries: {
        type: 'array',
        description:
          'Optional Boundary[] override for semantic mode. If omitted, uses the active session scope. If both are absent, runs unscoped.',
        items: { type: 'object' },
      },
      structured: {
        type: 'object',
        description:
          'Structured query mode (the "Query" ability). Deterministic, inspectable, composable. Returns a QueryResult with echo query, matched facts, totalCount, conflicts, truncated flag.',
        properties: {
          boundaries: { type: 'array', items: { type: 'object' } },
          select: {
            type: 'object',
            properties: {
              fields: { type: 'array', items: { type: 'string' } },
              limit: { type: 'number' },
              offset: { type: 'number' },
              orderBy: { type: 'object' },
              groupBy: { type: 'string' },
            },
          },
          aggregations: { type: 'array', items: { type: 'object' } },
          name: { type: 'string' },
        },
      },
    },
  },
  handler: queryIndexHandler,
}

async function queryIndexHandler(
  params: Record<string, unknown>,
  session: MCPSession,
  _deps: MCPDependencies
): Promise<MCPToolResult> {
  const query = params.query as string | undefined
  const scope = (params.scope as string) ?? 'auto'
  const maxResults = (params.max_results as number) ?? 5
  const explicitBoundaries = params.boundaries as Boundary[] | undefined
  const structured = params.structured as
    | {
        boundaries: Boundary[]
        select: SelectSpec
        aggregations?: Aggregation[]
        name?: string
      }
    | undefined

  // V41-QUERY-1: dispatch to structured path when caller provides it.
  if (structured) {
    return handleStructuredQuery(structured, session)
  }

  if (!query || query.trim().length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: "Error: provide either 'query' (semantic mode) or 'structured' (Query mode).",
        },
      ],
      isError: true,
    }
  }

  // Resolve effective scope
  const effectiveScope =
    scope === 'auto' ? session.activeProjectScope : (scope as 'personal' | 'project')

  const workspaceId =
    effectiveScope === 'project' && session.activeProjectId
      ? session.activeProjectId
      : session.workspaceId

  // Sprint SCOPE-LIVECTX-1: resolve boundaries (call-time override OR active session scope).
  // Governance wins — conflicts are surfaced, not silently applied.
  const boundaryResult = await resolveEffectiveBoundaries({
    userId: session.userId,
    workspaceId,
    sessionToken: mcpSessionToken(session),
    explicitBoundaries,
  }).catch((err) => {
    console.warn('[MCP query_index] boundary resolution failed, continuing unscoped:', err)
    return { boundaries: [] as Boundary[], conflicts: [], unscoped: true }
  })

  const conflictTrailer = summarizeConflictsForResponse(boundaryResult.conflicts)

  let classificationIntent: string | null = null

  // Try the reference agent first (classify → plan → retrieve → assemble)
  try {
    const { invokeReferenceAgent } = await import('../../services/reference-agent/index')

    const agentResult = await invokeReferenceAgent({
      query,
      workspaceId,
      userId: session.userId,
      // V41-QUERY-1: flow boundaries into per-source filters + assembler post-filter.
      boundaries: boundaryResult.boundaries,
    })

    if (agentResult.classification?.intent) {
      classificationIntent = agentResult.classification.intent
    }

    if (!agentResult.bypassed && agentResult.context) {
      const ctx = agentResult.context
      const citations = agentResult.versionCitations ?? []
      const contextBlock = (ctx.contextBlock ?? '').trim()

      // Only return the agent result if it produced real content. Otherwise fall
      // through to the direct searches below — the agent can succeed with an
      // empty context when all retrieval steps hit tables that aren't populated
      // yet (e.g. indexRecords empty because ingestion writes documentChunks).
      if (contextBlock.length > 0) {
        let text = contextBlock

        if (citations.length > 0) {
          text += '\n\n---\nSources:\n'
          for (const cite of citations.slice(0, maxResults)) {
            const label = cite.label ?? 'Unknown source'
            const version = cite.sourceVersion ? ` (v${cite.sourceVersion})` : ''
            text += `- ${label}${version}\n`
          }
        }

        if (classificationIntent) {
          text += `\n[Query classified as: ${classificationIntent}]`
        }

        text += conflictTrailer

        // Note: the reference-agent path does not currently apply boundary
        // post-filters (it assembles context server-side). Boundaries still
        // gate the governance check above; structured post-filter integration
        // is a follow-up for Sprint 3 (Query).
        return { content: [{ type: 'text', text: text.trim() }] }
      }
    }
  } catch (err) {
    console.warn('[MCP] Reference agent failed, falling back to direct search:', err)
  }

  // MCP-FIX-2: opportunistically backfill embeddings for thread-event chunks
  // that were stored without them (e.g. saved when OPENAI_API_KEY was missing).
  // Fire-and-forget so query latency isn't affected; the next query will see
  // the new embeddings.
  void (async () => {
    try {
      const { backfillThreadEventEmbeddings } = await import(
        '../../services/indexing/thread-event-indexer'
      )
      await backfillThreadEventEmbeddings(workspaceId, 50)
    } catch {
      /* non-fatal */
    }
  })()

  // Fallback 1: direct semantic search over indexRecords
  let indexResults: Array<{ title: string; section: string; score: number; text: string }> = []
  try {
    const { executeIndexQuery } = await import('../../services/semantic-index/query-executor')

    const result = await executeIndexQuery({
      query,
      workspaceId,
      userId: session.userId,
      limit: maxResults,
      includeSummary: false,
    })

    indexResults = result.results.slice(0, maxResults).map((item) => ({
      title: item.documentTitle ?? 'Untitled',
      section: item.sectionAlias ? ` > ${item.sectionAlias}` : '',
      score: item.score,
      text: item.embeddingText,
    }))
  } catch (err) {
    console.warn('[MCP] indexRecords query failed:', err)
  }

  // Fallback 2: direct semantic search over documentChunks — this is where
  // save_conversation (thread_event source) and file ingestion currently
  // write their embeddings, so it must be searched to surface MCP content.
  const chunkResults = await queryDocumentChunks({
    query,
    workspaceId,
    limit: maxResults,
  }).catch((err) => {
    console.warn('[MCP] documentChunks query failed:', err)
    return [] as Array<{ title: string; section: string; score: number; text: string }>
  })

  const combinedRaw = [...indexResults, ...chunkResults]
    .sort((a, b) => b.score - a.score)

  // Apply boundary post-filters (confidence/time/topic/etc.) before truncation.
  const combined = applyPostFilters(combinedRaw, boundaryResult.boundaries).slice(
    0,
    maxResults
  )

  if (combined.length === 0) {
    const classifierTag = classificationIntent ? `\n\n[Query classified as: ${classificationIntent}]` : ''
    return {
      content: [
        {
          type: 'text',
          text: `No results found for "${query}"${boundaryResult.boundaries.length ? ' within the active scope' : ''}. Your index may not have relevant content yet, or the scope may be too narrow.${classifierTag}${conflictTrailer}`,
        },
      ],
    }
  }

  let text = `Found ${combined.length} result(s) for "${query}":\n\n`

  for (const item of combined) {
    const score = Math.round(item.score * 100)
    text += `**${item.title}${item.section}** (${score}% match)\n`
    const snippet = item.text.slice(0, 300)
    text += `${snippet}${item.text.length > 300 ? '...' : ''}\n\n`
  }

  if (classificationIntent) {
    text += `\n[Query classified as: ${classificationIntent}]`
  }

  text += conflictTrailer

  return { content: [{ type: 'text', text: text.trim() }] }
}

/**
 * Semantic search over the documentChunks table. This is the store that
 * `indexThreadEvents` (save_conversation) and the indexing agent (file uploads)
 * currently write to. We query it directly so MCP-ingested content is
 * discoverable even when the reference agent / indexRecords path is empty.
 */
async function queryDocumentChunks(params: {
  query: string
  workspaceId: string
  limit: number
}): Promise<Array<{ title: string; section: string; score: number; text: string }>> {
  const { db } = await import('../../db/index')
  const { documentChunks } = await import('../../db/schema/knowledge')
  const { chatConversations } = await import('../../db/schema/chat')
  const { rawFiles } = await import('../../db/schema/raw-files')
  const { and, eq, ilike, sql, desc, inArray } = await import('drizzle-orm')
  const { generateEmbedding, hasEmbeddingSupport } = await import('../../services/embedding')

  // Try embedding-based similarity first. Fall back to LIKE search if we
  // can't embed (missing OpenAI key, rate-limited, etc.).
  let queryEmbedding: number[] | null = null
  if (hasEmbeddingSupport()) {
    try {
      queryEmbedding = await generateEmbedding(params.query)
    } catch (err) {
      console.warn('[MCP] Query embedding failed, falling back to text search:', err)
    }
  }

  type ChunkRow = {
    id: string
    sourceType: string
    sourceId: string
    content: string
    importance: number | null
    metadata: Record<string, unknown> | null
    similarity: number | null
  }

  let rows: ChunkRow[] = []

  if (queryEmbedding) {
    // pgvector cosine distance: 1 - (embedding <=> query). Higher = more similar.
    const embeddingLiteral = `[${queryEmbedding.join(',')}]`
    rows = await db
      .select({
        id: documentChunks.id,
        sourceType: documentChunks.sourceType,
        sourceId: documentChunks.sourceId,
        content: documentChunks.content,
        importance: documentChunks.importance,
        metadata: documentChunks.metadata,
        similarity: sql<number>`1 - (${documentChunks.embedding} <=> ${embeddingLiteral}::vector)`,
      })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.workspaceId, params.workspaceId),
          sql`${documentChunks.embedding} IS NOT NULL`
        )
      )
      .orderBy(sql`${documentChunks.embedding} <=> ${embeddingLiteral}::vector`)
      .limit(params.limit * 3)
  } else {
    // Text LIKE fallback — not semantic but at least returns *something*.
    rows = await db
      .select({
        id: documentChunks.id,
        sourceType: documentChunks.sourceType,
        sourceId: documentChunks.sourceId,
        content: documentChunks.content,
        importance: documentChunks.importance,
        metadata: documentChunks.metadata,
        similarity: sql<number>`NULL::float`,
      })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.workspaceId, params.workspaceId),
          ilike(documentChunks.content, `%${params.query}%`)
        )
      )
      .orderBy(desc(documentChunks.importance))
      .limit(params.limit * 3)
  }

  if (rows.length === 0) return []

  // Resolve titles: thread_event → chatConversations.title (via metadata.threadId);
  // file → rawFiles.fileName.
  const threadIds = new Set<string>()
  const fileIds = new Set<string>()
  for (const row of rows) {
    if (row.sourceType === 'thread_event') {
      const meta = (row.metadata ?? {}) as { threadId?: string }
      if (meta.threadId) threadIds.add(meta.threadId)
    } else if (row.sourceType === 'file') {
      fileIds.add(row.sourceId)
    }
  }

  const titleByThread = new Map<string, string>()
  if (threadIds.size > 0) {
    const convs = await db
      .select({ id: chatConversations.id, title: chatConversations.title })
      .from(chatConversations)
      .where(inArray(chatConversations.id, [...threadIds]))
    for (const c of convs) titleByThread.set(c.id, c.title)
  }

  const titleByFile = new Map<string, string>()
  if (fileIds.size > 0) {
    const files = await db
      .select({ id: rawFiles.id, fileName: rawFiles.fileName })
      .from(rawFiles)
      .where(inArray(rawFiles.id, [...fileIds]))
    for (const f of files) titleByFile.set(f.id, f.fileName)
  }

  return rows.slice(0, params.limit).map((row) => {
    let title = 'Untitled'
    let section = ''
    if (row.sourceType === 'thread_event') {
      const meta = (row.metadata ?? {}) as { threadId?: string; eventType?: string }
      if (meta.threadId && titleByThread.has(meta.threadId)) {
        title = titleByThread.get(meta.threadId)!
      } else {
        title = 'Conversation'
      }
      if (meta.eventType) section = ` > ${meta.eventType}`
    } else if (row.sourceType === 'file') {
      title = titleByFile.get(row.sourceId) ?? 'File'
    } else if (row.sourceType) {
      title = row.sourceType
    }

    // If similarity is null (text fallback) use a small positive score so it
    // still ranks above zero, preferring higher importance.
    const score = row.similarity ?? Math.max(0.3, row.importance ?? 0.3)
    return { title, section, score, text: row.content }
  })
}

// ─── V41-QUERY-1: structured query mode ─────────────────────────────────────

async function handleStructuredQuery(
  input: {
    boundaries: Boundary[]
    select: SelectSpec
    aggregations?: Aggregation[]
    name?: string
  },
  session: MCPSession
): Promise<MCPToolResult> {
  try {
    // Governance pre-check (blocked boundaries surfaced as conflicts,
    // not silently applied). Same resolver as semantic path.
    const boundaryResult = await resolveEffectiveBoundaries({
      userId: session.userId,
      workspaceId: session.workspaceId,
      sessionToken: mcpSessionToken(session),
      explicitBoundaries: input.boundaries,
    }).catch((err) => {
      console.warn('[MCP query_index:structured] boundary resolution failed, continuing:', err)
      return { boundaries: input.boundaries, conflicts: [], unscoped: false }
    })

    const q = buildStructuredQuery({
      userId: session.userId,
      workspaceId: session.workspaceId,
      boundaries: boundaryResult.boundaries,
      select: input.select,
      aggregations: input.aggregations,
      name: input.name,
    })

    const result = await runStructuredQuery(q, { conflicts: boundaryResult.conflicts })

    const lines: string[] = []
    lines.push('[QUERY RESULT]')
    lines.push(
      `Matched ${result.totalCount} fact(s), returning ${result.facts.length}${
        result.truncated ? ' (truncated)' : ''
      }. Runtime ${result.runtimeMs}ms.`
    )
    lines.push('')
    lines.push('[QUERY JSON]')
    lines.push(serializeQueryToJson(q))
    lines.push('')
    lines.push('[RESULTS]')
    if (result.facts.length === 0) {
      lines.push('(no facts matched — scope is correctly reported as empty, not silently widened)')
    } else {
      for (const f of result.facts) {
        const parts: string[] = []
        for (const field of q.select.fields) {
          const v = renderField(f as unknown as Record<string, unknown>, field)
          if (v !== undefined) parts.push(`${field}: ${v}`)
        }
        lines.push(`- ${parts.join(' | ')}`)
      }
    }
    if (result.aggregations) {
      lines.push('')
      lines.push('[AGGREGATIONS]')
      lines.push(JSON.stringify(result.aggregations, null, 2))
    }
    lines.push('')
    lines.push('[TOTAL]')
    lines.push(`${result.totalCount} matched, showing ${result.facts.length}.`)
    if (result.conflicts.length > 0) {
      lines.push('')
      lines.push('[CONFLICTS]')
      lines.push(JSON.stringify(result.conflicts, null, 2))
      lines.push('Governance wins: blocked boundaries were NOT applied. Complete the resolution next_step and retry.')
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[MCP query_index:structured] failed:', err)
    return {
      content: [{ type: 'text', text: `Structured query failed: ${msg}. No silent fallback.` }],
      isError: true,
    }
  }
}

function renderField(fact: { [k: string]: unknown }, field: string): string | undefined {
  const v = (fact as Record<string, unknown>)[field]
  if (v === undefined || v === null) return undefined
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
