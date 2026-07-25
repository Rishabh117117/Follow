/**
 * MCP Tool: discover_similar (Sprint V41-DISCOVER-1)
 *
 * Privacy-preserving index similarity. Returns signatures + topical overlap,
 * never fact content. Always user-initiated — the AI calls this only when
 * the user has explicitly asked for discovery.
 *
 * See docs/follow-product-reference.md §7.9 for the locked spec.
 */

import type {
  MCPToolDefinition,
  MCPToolResult,
  MCPSession,
  MCPDependencies,
} from '../types'
import {
  findSimilarIndexes,
  type DiscoverParams,
  type PrivacyFloor,
  type SimilarityResult,
} from '../../services/discover'

export const discoverSimilarTool: MCPToolDefinition = {
  name: 'discover_similar',
  description:
    'Find indexes similar to a source (index | contributor | topic). Returns index signatures and topical overlap only — NEVER fact content. Privacy-preserving by construction. User-initiated only: do not call unless the user asked to discover overlap/similarity with other indexes.',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'object',
        description: 'What to compare against.',
        properties: {
          kind: { type: 'string', enum: ['index', 'contributor', 'topic'] },
          value: { type: 'string' },
        },
        required: ['kind', 'value'],
      },
      scope: {
        type: 'object',
        properties: {
          workspace: { type: 'string' },
          org: { type: 'boolean' },
          minRecordCount: { type: 'number' },
        },
      },
      privacyFloor: {
        type: 'string',
        enum: ['fingerprint_only', 'topics_only', 'full_signature'],
        description:
          "Highest privacy level that still returns results. Default 'topics_only'.",
      },
      limit: { type: 'number', description: 'Default 20, max 100.' },
    },
    required: ['source'],
  },
  handler: discoverSimilarHandler,
}

async function discoverSimilarHandler(
  params: Record<string, unknown>,
  session: MCPSession,
  _deps: MCPDependencies
): Promise<MCPToolResult> {
  try {
    const input: DiscoverParams = {
      source: params.source as DiscoverParams['source'],
      scope: params.scope as DiscoverParams['scope'],
      privacyFloor: (params.privacyFloor as PrivacyFloor | undefined) ?? 'topics_only',
      limit: params.limit as number | undefined,
    }

    if (!input.source?.kind || !input.source?.value) {
      return textResult(
        "Error: source.kind and source.value are required.",
        { isError: true }
      )
    }

    const result = await findSimilarIndexes(input, {
      userId: session.userId,
      workspaceId: session.workspaceId,
    })

    return { content: [{ type: 'text', text: formatResult(result) }] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[MCP discover_similar] failed:', err)
    // Non-blocking per sprint constraint — degrade to empty result + warning.
    return textResult(
      `Discover failed: ${msg}. No fact content was returned (fail-closed).`,
      { isError: true }
    )
  }
}

function formatResult(result: SimilarityResult): string {
  const lines: string[] = []
  lines.push('[DISCOVER RESULT]')
  lines.push(
    `Source: ${result.sourceIndexName} (id=${result.sourceIndexId})`
  )
  lines.push('')
  if (result.matches.length === 0) {
    lines.push('No similar indexes found at this privacy floor.')
    lines.push('(Scope correctly reports empty — not silently widened.)')
  } else {
    lines.push(`Top ${result.matches.length} similar indexes:`)
    result.matches.forEach((m, i) => {
      const owner = m.ownerName ?? (m.ownerId ? `user:${m.ownerId}` : 'anonymous')
      lines.push(
        `${i + 1}. ${m.indexName} by ${owner} — similarity ${m.similarity.toFixed(2)}`
      )
      if (m.topicalOverlap.length > 0) {
        lines.push(
          `   Overlapping topics: ${m.topicalOverlap.slice(0, 8).join(', ')}`
        )
      }
      const activity = m.lastActivityAt
        ? new Date(m.lastActivityAt).toISOString().slice(0, 10)
        : '—'
      lines.push(
        `   ~${m.recordCount} records, last active ${activity}`
      )
    })
  }
  lines.push('')
  lines.push('[PRIVACY]')
  lines.push(`Privacy floor: ${result.privacyFloor}`)
  lines.push('No fact content was returned. Signatures only.')
  lines.push(`Scanned ${result.scanned} candidate index(es) in ${result.runtimeMs}ms.`)
  if (result.conflicts.length > 0) {
    lines.push('')
    lines.push('[CONFLICTS]')
    for (const c of result.conflicts) {
      lines.push(`- ${c.type}: ${c.reason}${c.next_step ? ` → ${c.next_step}` : ''}`)
    }
    lines.push(
      'Governance wins: blocked indexes were NOT returned. Owner opt-in is required for discovery.'
    )
  }
  return lines.join('\n')
}

function textResult(text: string, opts: { isError?: boolean } = {}): MCPToolResult {
  return { content: [{ type: 'text', text }], isError: opts.isError }
}
