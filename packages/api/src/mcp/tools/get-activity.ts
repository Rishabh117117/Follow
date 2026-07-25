/**
 * MCP Tool: get_activity (Sprint MCP-2)
 *
 * Returns recent activity from the personal or project index.
 */

import type { MCPToolDefinition, MCPToolResult, MCPSession } from '../types'
import { db } from '../../db/index'
import { eq, and, gt, desc } from 'drizzle-orm'
import { indexRecords } from '../../db/schema/semantic-index'
import { sharedSlices, contextRequests } from '../../db/schema/sharing'
import { rawFiles } from '../../db/schema/raw-files'
import { chatConversations } from '../../db/schema/chat'
import {
  resolveEffectiveBoundaries,
  summarizeConflictsForResponse,
  type Boundary,
} from '../../services/scope'
import { mcpSessionToken } from './scope-configure'
import { postFilterItems } from '../../services/reference-agent/boundary-hook'
import type { RetrievedItem } from '../../services/reference-agent/retriever'

export const getActivityTool: MCPToolDefinition = {
  name: 'get_activity',
  description:
    'Get recent activity from your personal or project index. Shows indexed facts, contributions, messages, and file uploads.',
  inputSchema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['personal', 'project', 'auto'],
        description: "Which index to query. Default: 'auto'",
      },
      since: {
        type: 'string',
        description: "Time filter. E.g., 'today', 'this week', '3 days', '2026-04-10'. Default: 'today'",
      },
      type: {
        type: 'string',
        enum: ['all', 'contributions', 'contradictions', 'messages', 'ingestions'],
        description: "Filter by activity type. Default: 'all'",
      },
      boundaries: {
        type: 'array',
        description:
          'Optional Boundary[] override. If omitted, uses the active session scope. Governance wins on conflicts; items missing the attribute a boundary filters on are dropped fail-closed.',
        items: { type: 'object' },
      },
    },
  },
  handler: getActivityHandler,
}

function parseSince(since: string): Date {
  const now = new Date()
  const lower = since.toLowerCase().trim()

  if (lower === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }
  if (lower === 'this week') {
    const day = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((day + 6) % 7))
    monday.setHours(0, 0, 0, 0)
    return monday
  }
  const daysMatch = lower.match(/^(\d+)\s*days?$/)
  if (daysMatch) {
    const days = parseInt(daysMatch[1]!, 10)
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  }
  // Try ISO date
  const parsed = new Date(since)
  if (!isNaN(parsed.getTime())) return parsed

  // Default: 24 hours ago
  return new Date(now.getTime() - 24 * 60 * 60 * 1000)
}

async function getActivityHandler(
  params: Record<string, unknown>,
  session: MCPSession
): Promise<MCPToolResult> {
  const scope = (params.scope as string) ?? 'auto'
  const sinceStr = (params.since as string) ?? 'today'
  const activityType = (params.type as string) ?? 'all'
  const sinceDate = parseSince(sinceStr)
  const explicitBoundaries = params.boundaries as Boundary[] | undefined

  const effectiveScope = scope === 'auto' ? session.activeProjectScope : scope
  const workspaceId =
    effectiveScope === 'project' && session.activeProjectId
      ? session.activeProjectId
      : session.workspaceId

  // GOVERNANCE-AUDIT-FIX-1: resolve boundaries + governance pre-check before retrieval.
  const boundaryResult = await resolveEffectiveBoundaries({
    userId: session.userId,
    workspaceId: session.workspaceId,
    sessionToken: mcpSessionToken(session),
    explicitBoundaries,
  }).catch((err) => {
    console.warn('[MCP get_activity] boundary resolution failed, continuing unscoped:', err)
    return { boundaries: [] as Boundary[], conflicts: [], unscoped: true }
  })

  if (boundaryResult.conflicts.length > 0) {
    return {
      content: [
        {
          type: 'text',
          text:
            '[GET_ACTIVITY BLOCKED]\nReason: governance conflicts detected.' +
            summarizeConflictsForResponse(boundaryResult.conflicts),
        },
      ],
    }
  }

  const conflictTrailer = summarizeConflictsForResponse(boundaryResult.conflicts)
  const effectiveBoundaries = boundaryResult.boundaries

  const scopeLabel = effectiveScope === 'project' ? 'project' : 'personal'
  const activities: Array<{ time: Date; label: string; type: string; item: RetrievedItem }> = []

  // Index records (ingestions)
  if (activityType === 'all' || activityType === 'ingestions') {
    const records = await db
      .select({
        eventTime: indexRecords.eventTime,
        documentTitle: indexRecords.documentTitle,
        threadType: indexRecords.threadType,
        isAIInvolved: indexRecords.isAIInvolved,
      })
      .from(indexRecords)
      .where(
        and(eq(indexRecords.workspaceId, workspaceId), gt(indexRecords.eventTime, sinceDate))
      )
      .orderBy(desc(indexRecords.eventTime))
      .limit(20)

    for (const r of records) {
      const title = r.documentTitle ?? 'Untitled'
      const aiTag = r.isAIInvolved ? ' (AI)' : ''
      activities.push({
        time: r.eventTime,
        label: `Indexed: "${title}" [${r.threadType}]${aiTag}`,
        type: 'ingestion',
        item: {
          source: 'index_records',
          content: title,
          citation: { timestamp: r.eventTime.toISOString(), label: title },
          metadata: {
            workspaceId,
            indexId: workspaceId,
            sourceTool: r.threadType,
            freshness: r.isAIInvolved ? 'ai' : 'human',
          },
        },
      })
    }
  }

  // Shared slices (contributions) — project scope only
  if (
    effectiveScope === 'project' &&
    (activityType === 'all' || activityType === 'contributions')
  ) {
    const slices = await db
      .select({
        createdAt: sharedSlices.createdAt,
        presetUsed: sharedSlices.presetUsed,
        redactionCount: sharedSlices.redactionCount,
      })
      .from(sharedSlices)
      .where(
        and(eq(sharedSlices.workspaceId, workspaceId), gt(sharedSlices.createdAt, sinceDate))
      )
      .orderBy(desc(sharedSlices.createdAt))
      .limit(10)

    for (const s of slices) {
      activities.push({
        time: s.createdAt,
        label: `Contribution (preset: ${s.presetUsed ?? 'balanced'}, ${s.redactionCount ?? 0} redacted)`,
        type: 'contribution',
        item: {
          source: 'foreign_refs',
          content: `Contribution: ${s.presetUsed ?? 'balanced'}`,
          citation: { timestamp: s.createdAt.toISOString(), label: 'contribution' },
          metadata: {
            workspaceId,
            indexId: workspaceId,
            sourceTool: 'contribute',
            provenance: s.presetUsed ?? 'balanced',
          },
        },
      })
    }
  }

  // Context requests (messages)
  if (activityType === 'all' || activityType === 'messages') {
    const requests = await db
      .select({
        createdAt: contextRequests.createdAt,
        query: contextRequests.query,
        status: contextRequests.status,
      })
      .from(contextRequests)
      .where(
        and(
          eq(contextRequests.workspaceId, workspaceId),
          gt(contextRequests.createdAt, sinceDate)
        )
      )
      .orderBy(desc(contextRequests.createdAt))
      .limit(10)

    for (const r of requests) {
      activities.push({
        time: r.createdAt,
        label: `Message: "${(r.query ?? '').slice(0, 80)}..." [${r.status}]`,
        type: 'message',
        item: {
          source: 'foreign_refs',
          content: r.query ?? '',
          citation: { timestamp: r.createdAt.toISOString(), label: 'context_request' },
          metadata: {
            workspaceId,
            indexId: workspaceId,
            sourceTool: 'send_message',
            freshness: r.status ?? undefined,
          },
        },
      })
    }
  }

  // Raw file uploads
  if (activityType === 'all' || activityType === 'ingestions') {
    const uploads = await db
      .select({
        createdAt: rawFiles.createdAt,
        fileName: rawFiles.fileName,
        sourceType: rawFiles.sourceType,
      })
      .from(rawFiles)
      .where(
        and(
          eq(rawFiles.workspaceId, workspaceId),
          gt(rawFiles.createdAt, sinceDate)
        )
      )
      .orderBy(desc(rawFiles.createdAt))
      .limit(10)

    for (const f of uploads) {
      activities.push({
        time: f.createdAt,
        label: `File uploaded: ${f.fileName} (${f.sourceType})`,
        type: 'ingestion',
        item: {
          source: 'index_records',
          content: f.fileName,
          citation: { timestamp: f.createdAt.toISOString(), label: f.fileName },
          metadata: {
            contributorId: session.userId,
            workspaceId,
            indexId: workspaceId,
            sourceTool: f.sourceType ?? 'raw_file',
          },
        },
      })
    }
  }

  // Saved conversations (MCP-FIX-1: previously only indexRecords were checked,
  // but save_conversation writes to chatConversations + documentChunks, not
  // indexRecords — so these never appeared in the activity feed).
  if (activityType === 'all' || activityType === 'ingestions') {
    const conversations = await db
      .select({
        createdAt: chatConversations.createdAt,
        title: chatConversations.title,
        chatSourceType: chatConversations.chatSourceType,
      })
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.workspaceId, workspaceId),
          gt(chatConversations.createdAt, sinceDate)
        )
      )
      .orderBy(desc(chatConversations.createdAt))
      .limit(10)

    for (const c of conversations) {
      const source = c.chatSourceType ?? 'unknown'
      const createdAtDate = c.createdAt ?? new Date(0)
      activities.push({
        time: createdAtDate,
        label: `Conversation saved: "${c.title}" (${source})`,
        type: 'ingestion',
        item: {
          source: 'chat_history',
          content: c.title,
          citation: { timestamp: createdAtDate.toISOString(), label: c.title },
          metadata: {
            workspaceId,
            indexId: workspaceId,
            sourceTool: source,
          },
        },
      })
    }
  }

  // GOVERNANCE-AUDIT-FIX-1: fail-closed post-filter across all 5 activity sources.
  // Items missing the attribute a boundary filters on are dropped.
  const filtered = postFilterItems(
    activities.map((a) => a.item),
    effectiveBoundaries,
    { failClosed: true }
  )
  const keptIds = new Set(filtered.items.map((it) => it.citation.timestamp ?? ''))
  const keptActivities = activities.filter((a) =>
    keptIds.has(a.item.citation.timestamp ?? '')
  )

  // Sort chronologically (newest first)
  keptActivities.sort((a, b) => b.time.getTime() - a.time.getTime())

  if (keptActivities.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No activity in ${scopeLabel} index since ${sinceStr}.` + conflictTrailer,
        },
      ],
    }
  }

  let text = `Activity for ${scopeLabel} index since ${sinceStr}:\n\n`
  for (const a of keptActivities.slice(0, 30)) {
    const ts = a.time.toISOString().slice(0, 16).replace('T', ' ')
    text += `- [${ts}] ${a.label}\n`
  }
  text += `\nTotal: ${keptActivities.length} activities`
  text += conflictTrailer

  return { content: [{ type: 'text', text }] }
}
