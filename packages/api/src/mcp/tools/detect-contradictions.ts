/**
 * MCP Tool: detect_contradictions (Sprint MCP-2)
 *
 * Queries the project index for cross-contributor conflicts.
 * Wraps the AI state system's tension/conflict detection.
 */

import type { MCPToolDefinition, MCPToolResult, MCPSession } from '../types'
import { db } from '../../db/index'
import { eq } from 'drizzle-orm'
import { documentSharedState } from '../../db/schema/ai-state'
import { workspaces } from '../../db/schema/workspaces'
import {
  resolveEffectiveBoundaries,
  summarizeConflictsForResponse,
  type Boundary,
} from '../../services/scope'
import { mcpSessionToken } from './scope-configure'
import { postFilterItems } from '../../services/reference-agent/boundary-hook'
import type { RetrievedItem } from '../../services/reference-agent/retriever'
import {
  getContradictionEdges,
  formatContradictionEdges,
} from '../../services/contradictions/edges'

interface Tension {
  id: string
  description: string
  severity: string
  type: string
  involvedUsers: string[]
  involvedSections: string[]
  detectedAt: string
  resolvedAt: string | null
  resolution: string | null
  confidence: number
}

interface KnowledgeEntry {
  id: string
  fact: string
  source: string
  confidence: number
  contributedByName: string
  sharedAt: string
  conflictsWith: string | null
  status: string
}

export const detectContradictionsTool: MCPToolDefinition = {
  name: 'detect_contradictions',
  description:
    'Detect cross-contributor conflicts and contradictions in the active project index. Returns claims from different contributors that disagree.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description:
          'Optional topic to narrow contradiction search. If empty, returns all active contradictions.',
      },
      include_resolved: {
        type: 'boolean',
        description: 'Include previously resolved contradictions. Default: false',
      },
      boundaries: {
        type: 'array',
        description:
          'Optional Boundary[] override. If omitted, uses the active session scope. Governance wins on conflicts; entries missing the attribute a boundary filters on are dropped fail-closed. Note: documentSharedState carries contributor/time/topic/confidence; other dimensions like edge_type will fail-closed drop everything.',
        items: { type: 'object' },
      },
    },
  },
  handler: detectContradictionsHandler,
}

async function detectContradictionsHandler(
  params: Record<string, unknown>,
  session: MCPSession
): Promise<MCPToolResult> {
  if (!session.activeProjectId) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: No project scope is active. Contradictions only exist in shared project indexes. Call set_scope first.',
        },
      ],
      isError: true,
    }
  }

  const topic = params.topic as string | undefined
  const includeResolved = (params.include_resolved as boolean) ?? false
  const explicitBoundaries = params.boundaries as Boundary[] | undefined

  // GOVERNANCE-AUDIT-FIX-1: resolve boundaries + governance pre-check before retrieval.
  const boundaryResult = await resolveEffectiveBoundaries({
    userId: session.userId,
    workspaceId: session.workspaceId,
    sessionToken: mcpSessionToken(session),
    explicitBoundaries,
  }).catch((err) => {
    console.warn(
      '[MCP detect_contradictions] boundary resolution failed, continuing unscoped:',
      err
    )
    return { boundaries: [] as Boundary[], conflicts: [], unscoped: true }
  })

  if (boundaryResult.conflicts.length > 0) {
    return {
      content: [
        {
          type: 'text',
          text:
            '[DETECT_CONTRADICTIONS BLOCKED]\nReason: governance conflicts detected.' +
            summarizeConflictsForResponse(boundaryResult.conflicts),
        },
      ],
    }
  }

  const conflictTrailer = summarizeConflictsForResponse(boundaryResult.conflicts)
  const effectiveBoundaries = boundaryResult.boundaries

  // Get project name
  const [workspace] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, session.activeProjectId))
    .limit(1)
  const projectName = workspace?.name ?? 'Unknown Project'

  // Query all document shared states for this workspace
  const states = await db
    .select()
    .from(documentSharedState)
    .where(eq(documentSharedState.workspaceId, session.activeProjectId))

  // Collect tensions and knowledge conflicts
  const allTensions: Tension[] = []
  const allKnowledge: KnowledgeEntry[] = []

  for (const stateRow of states) {
    const state = stateRow.state as Record<string, unknown> | null
    if (!state) continue

    const tensions = (state.tensions as Tension[]) ?? []
    const knowledge = (state.knowledge as KnowledgeEntry[]) ?? []

    allTensions.push(...tensions)
    allKnowledge.push(...knowledge)
  }

  // Filter tensions
  let contradictions = allTensions.filter((t) => t.type === 'contradiction' || t.type === 'gap')

  if (!includeResolved) {
    contradictions = contradictions.filter((t) => !t.resolvedAt)
  }

  // Filter by topic if provided
  if (topic) {
    const lowerTopic = topic.toLowerCase()
    contradictions = contradictions.filter(
      (t) =>
        t.description.toLowerCase().includes(lowerTopic) ||
        t.involvedSections?.some((s) => s.toLowerCase().includes(lowerTopic))
    )
  }

  // Also find knowledge entries that conflict
  const disputedKnowledge = allKnowledge.filter((k) => k.status === 'disputed' || k.conflictsWith)

  // GOVERNANCE-AUDIT-FIX-1: fail-closed post-filter on tensions + knowledge entries.
  // documentSharedState entries carry contributor (via involvedUsers/contributedByName),
  // time (detectedAt/sharedAt), topic (description/involvedSections), confidence.
  // Boundaries on other dimensions (edge_type, source_tool, etc.) will fail-closed
  // drop everything — see tool description.
  if (effectiveBoundaries.length > 0) {
    const tensionItems = contradictions.map(tensionToItem)
    const keptTensions = postFilterItems(tensionItems, effectiveBoundaries, { failClosed: true })
    const keptTensionIds = new Set(keptTensions.items.map((it) => it.citation.sourceFileId))
    contradictions = contradictions.filter((t) => keptTensionIds.has(t.id))

    const knowledgeItems = disputedKnowledge.map(knowledgeToItem)
    const keptKnowledge = postFilterItems(knowledgeItems, effectiveBoundaries, { failClosed: true })
    const keptKnowledgeIds = new Set(keptKnowledge.items.map((it) => it.citation.sourceFileId))
    const filteredDisputed = disputedKnowledge.filter((k) => keptKnowledgeIds.has(k.id))
    disputedKnowledge.length = 0
    disputedKnowledge.push(...filteredDisputed)
  }

  // CONTRADICT-1: bridge ANALYST's `contradicts` edges (semanticLinks) into the
  // surface. The legacy paths above read documentSharedState.tensions; this reads
  // the edges ANALYST actually writes during indexing. Non-fatal if it fails.
  const edges = await getContradictionEdges({
    workspaceId: session.activeProjectId,
    topic,
  }).catch((err) => {
    console.warn('[MCP detect_contradictions] edge bridge failed:', err)
    return []
  })

  if (contradictions.length === 0 && disputedKnowledge.length === 0 && edges.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text:
            `No active contradictions found in ${projectName}.${
              topic ? ` (filtered by "${topic}")` : ''
            } This could mean the team is aligned, or the index needs more contributions to detect conflicts.` +
            conflictTrailer,
        },
      ],
    }
  }

  let text = `Found ${contradictions.length + disputedKnowledge.length + edges.length} contradiction(s) in ${projectName}:\n\n`

  // Format tensions
  for (let i = 0; i < contradictions.length; i++) {
    const t = contradictions[i]!
    const severityTag = t.severity?.toUpperCase() ?? 'UNKNOWN'
    const status = t.resolvedAt ? 'Resolved' : 'Active'
    text += `${i + 1}. ${t.description.toUpperCase()} (${severityTag} severity)\n`
    text += `   ${t.description}\n`
    if (t.involvedUsers?.length) {
      text += `   Involved: ${t.involvedUsers.join(', ')}\n`
    }
    text += `   Confidence: ${(t.confidence * 100).toFixed(0)}%\n`
    text += `   Status: ${status} | Detected: ${t.detectedAt}\n`
    if (t.resolution) text += `   Resolution: ${t.resolution}\n`
    text += '\n'
  }

  // Format disputed knowledge
  for (const k of disputedKnowledge) {
    if (k.conflictsWith) {
      const conflicting = allKnowledge.find((other) => other.id === k.conflictsWith)
      if (conflicting) {
        text += `KNOWLEDGE CONFLICT:\n`
        text += `   Claim A: "${k.fact}" — by ${k.contributedByName} (${(k.confidence * 100).toFixed(0)}%)\n`
        text += `   Claim B: "${conflicting.fact}" — by ${conflicting.contributedByName} (${(conflicting.confidence * 100).toFixed(0)}%)\n\n`
      }
    }
  }

  // CONTRADICT-1: append the ANALYST `contradicts` edges (both sides + reason).
  if (edges.length > 0) {
    text += `ANALYST-detected contradictions (semantic edges):\n${formatContradictionEdges(edges)}\n\n`
  }

  return { content: [{ type: 'text', text: text.trim() + conflictTrailer }] }
}

// ─── Tension/Knowledge → RetrievedItem mapping (GOVERNANCE-AUDIT-FIX-1) ─────

function tensionToItem(t: Tension): RetrievedItem {
  return {
    source: 'index_records',
    content: t.description,
    citation: {
      sourceFileId: t.id,
      timestamp: t.detectedAt,
      label: t.description.slice(0, 60),
    },
    relevanceScore: typeof t.confidence === 'number' ? t.confidence : undefined,
    metadata: {
      contributorId: t.involvedUsers?.[0],
      topic: t.involvedSections,
      confidence: t.confidence,
      freshness: t.resolvedAt ? 'resolved' : 'active',
    },
  }
}

function knowledgeToItem(k: KnowledgeEntry): RetrievedItem {
  return {
    source: 'index_records',
    content: k.fact,
    citation: {
      sourceFileId: k.id,
      timestamp: k.sharedAt,
      label: k.fact.slice(0, 60),
    },
    relevanceScore: typeof k.confidence === 'number' ? k.confidence : undefined,
    metadata: {
      contributorId: k.contributedByName,
      confidence: k.confidence,
      provenance: k.source,
      freshness: k.status,
    },
  }
}
