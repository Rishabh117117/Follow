/**
 * CONTRADICT-1 — read-side bridge (2026-06-19).
 *
 * ANALYST (when `pipeline-analyst-llm` is on) writes `contradicts` edges into
 * `semanticLinks` with `metadata.analyst.reason`. The legacy `detect_contradictions`
 * tool only read `documentSharedState.tensions` — a *separate* system with no
 * bridge. This module is that bridge: it reads the `contradicts` edges directly
 * and resolves both record texts + contributors + the analyst reason, so the
 * edges ANALYST produces are actually surfaceable (to the MCP tool and a future UI).
 */
import { and, eq, isNull, desc, inArray } from 'drizzle-orm'
import { db } from '../../db/index'
import { semanticLinks, indexRecords } from '../../db/schema/semantic-index'

export interface ContradictionEdge {
  linkId: string
  similarity: number
  crossUser: boolean
  confidence: number | null
  reason: string | null
  createdAt: string
  source: {
    recordId: string
    text: string
    contributor: string | null
    documentTitle: string | null
  }
  target: {
    recordId: string
    text: string
    contributor: string | null
    documentTitle: string | null
  }
}

/**
 * Read ANALYST `contradicts` edges for a workspace, resolving both sides.
 * Read-only. `topic` (optional) does a case-insensitive substring filter over
 * either record's text or the analyst reason.
 */
export async function getContradictionEdges(params: {
  workspaceId: string
  topic?: string
  limit?: number
}): Promise<ContradictionEdge[]> {
  const limit = params.limit ?? 50

  const edges = await db
    .select()
    .from(semanticLinks)
    .where(
      and(
        eq(semanticLinks.workspaceId, params.workspaceId),
        eq(semanticLinks.linkType, 'contradicts'),
        isNull(semanticLinks.deletedAt)
      )
    )
    .orderBy(desc(semanticLinks.createdAt))
    .limit(limit)

  if (edges.length === 0) return []

  // Resolve both records for every edge in one round-trip.
  const recordIds = Array.from(new Set(edges.flatMap((e) => [e.sourceRecordId, e.targetRecordId])))
  const records = await db
    .select({
      id: indexRecords.id,
      embeddingText: indexRecords.embeddingText,
      userName: indexRecords.userName,
      documentTitle: indexRecords.documentTitle,
    })
    .from(indexRecords)
    .where(inArray(indexRecords.id, recordIds))
  const byId = new Map(records.map((r) => [r.id, r]))

  const result: ContradictionEdge[] = []
  for (const e of edges) {
    const src = byId.get(e.sourceRecordId)
    const tgt = byId.get(e.targetRecordId)
    // Skip edges whose records were hard-deleted out from under us.
    if (!src || !tgt) continue
    const analyst = ((e.metadata ?? {}) as { analyst?: { reason?: string; confidence?: number } })
      .analyst
    const reason = e.reason ?? analyst?.reason ?? null

    if (params.topic) {
      const t = params.topic.toLowerCase()
      const hay = `${src.embeddingText} ${tgt.embeddingText} ${reason ?? ''}`.toLowerCase()
      if (!hay.includes(t)) continue
    }

    result.push({
      linkId: e.id,
      similarity: e.similarity,
      crossUser: e.crossUser,
      confidence: analyst?.confidence ?? null,
      reason,
      createdAt: e.createdAt.toISOString(),
      source: {
        recordId: src.id,
        text: src.embeddingText,
        contributor: src.userName,
        documentTitle: src.documentTitle,
      },
      target: {
        recordId: tgt.id,
        text: tgt.embeddingText,
        contributor: tgt.userName,
        documentTitle: tgt.documentTitle,
      },
    })
  }
  return result
}

/** Render edges as human-readable lines for the MCP tool surface. */
export function formatContradictionEdges(edges: ContradictionEdge[]): string {
  const lines: string[] = []
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!
    const conf = e.confidence != null ? ` (${Math.round(e.confidence * 100)}% confidence)` : ''
    lines.push(
      `${i + 1}. CONTRADICTION${conf} — ${Math.round(e.similarity * 100)}% similar${e.crossUser ? ', cross-contributor' : ''}`
    )
    lines.push(
      `   A: "${e.source.text.slice(0, 200)}"${e.source.contributor ? ` — ${e.source.contributor}` : ''}`
    )
    lines.push(
      `   B: "${e.target.text.slice(0, 200)}"${e.target.contributor ? ` — ${e.target.contributor}` : ''}`
    )
    if (e.reason) lines.push(`   Why: ${e.reason}`)
    lines.push('')
  }
  return lines.join('\n').trim()
}
