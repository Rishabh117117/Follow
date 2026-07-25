/**
 * MCP Tool: directory_query (Sprint CTX-2 — 10th tool)
 *
 * Returns WHO knows about a topic — contributors, depth of analysis, sources,
 * contradictions, and a routing recommendation. Use when the question is
 * about people rather than facts, or when the topic is contested.
 */

import type { MCPToolDefinition, MCPToolResult, MCPSession, MCPDependencies } from '../types'
import { queryDirectory } from '../../services/directory/directory-query'
import {
  resolveEffectiveBoundaries,
  summarizeConflictsForResponse,
  type Boundary,
} from '../../services/scope'
import { mcpSessionToken } from './scope-configure'

export const directoryQueryTool: MCPToolDefinition = {
  name: 'directory_query',
  description: `Look up WHO knows about a topic — which team members have contributed knowledge, their depth of analysis, sources used, session history, and any contradictions between contributors. Use this instead of query_index when:
- The question is about people ("who worked on X?", "who knows about Y?")
- The topic has known contradictions or contested positions
- The user needs to find the right person or source, not just an answer
- The analysis is complex enough that routing to the original source is more valuable than a summary
Returns contributor profiles with coverage depth, reliability metrics, and routing recommendations.`,
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'What topic or area to look up contributors and sources for',
      },
      scope: {
        type: 'string',
        description: 'Index/project scope. If omitted, uses session scope.',
      },
      include_contradictions: {
        type: 'boolean',
        description: 'Whether to return contradictions (default: true)',
      },
      max_contributors: {
        type: 'number',
        description: 'Maximum contributors to return (default: 10)',
      },
      boundaries: {
        type: 'array',
        description:
          'Optional Boundary[] override. If omitted, uses the active session scope. Governance always wins on conflicts.',
        items: { type: 'object' },
      },
    },
    required: ['topic'],
  },
  handler: directoryQueryHandler,
}

async function directoryQueryHandler(
  params: Record<string, unknown>,
  session: MCPSession,
  _deps: MCPDependencies
): Promise<MCPToolResult> {
  const topic = params.topic as string
  const scope =
    (params.scope as string | undefined) ??
    (session.activeProjectScope === 'project' && session.activeProjectId
      ? session.activeProjectId
      : 'personal')
  const includeContradictions = (params.include_contradictions as boolean | undefined) ?? true
  const maxContributors = (params.max_contributors as number | undefined) ?? 10
  const explicitBoundaries = params.boundaries as Boundary[] | undefined

  if (!topic || topic.trim().length === 0) {
    return {
      content: [{ type: 'text', text: 'Error: topic parameter is required.' }],
      isError: true,
    }
  }

  // Sprint SCOPE-LIVECTX-1: resolve boundaries + governance check before retrieval.
  const boundaryResult = await resolveEffectiveBoundaries({
    userId: session.userId,
    workspaceId: session.workspaceId,
    sessionToken: mcpSessionToken(session),
    explicitBoundaries,
  }).catch((err) => {
    console.warn('[MCP directory_query] boundary resolution failed, continuing unscoped:', err)
    return { boundaries: [] as Boundary[], conflicts: [], unscoped: true }
  })

  const conflictTrailer = summarizeConflictsForResponse(boundaryResult.conflicts)

  try {
    const result = await queryDirectory({
      topic,
      indexId: scope,
      userId: session.userId,
      includeContradictions,
      maxContributors,
    })

    // Best-effort contributor-boundary post-filter on the returned directory entries.
    const contributorBoundaries = boundaryResult.boundaries.filter(
      (b) => b.dimension === 'contributor'
    )
    if (contributorBoundaries.length > 0 && Array.isArray((result as { contributors?: unknown[] }).contributors)) {
      const r = result as { contributors: Array<{ userId?: string; id?: string }> }
      r.contributors = r.contributors.filter((c) => {
        const id = c.userId ?? c.id
        return contributorBoundaries.every((b) => {
          const vals = [b.value, ...(b.values ?? [])].filter((v) => v !== undefined).map(String)
          if (b.op === 'include') return id ? vals.includes(id) : vals.length === 0
          if (b.op === 'exclude') return !id || !vals.includes(id)
          return true
        })
      })
    }

    const body = JSON.stringify(result, null, 2) + conflictTrailer
    return {
      content: [{ type: 'text', text: body }],
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return {
      content: [{ type: 'text', text: `Failed to query directory: ${message}` }],
      isError: true,
    }
  }
}
