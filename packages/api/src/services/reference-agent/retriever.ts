/**
 * Reference Agent — Multi-Source Retriever (Sprint RA-2)
 *
 * Executes a RetrievalPlan by firing every step in parallel against its
 * backing data source, collecting the results into a uniform
 * `RetrievedItem` shape with version citations.
 *
 * Policy:
 *   - All steps run in parallel via Promise.allSettled
 *   - Required steps that fail → logged into `errors`
 *   - Optional steps that fail → silent (console.warn only)
 *   - Fulfilled-with-0 is fine (the source had nothing relevant)
 *
 * `index_states` (IX-10): queries the real `index_record_states` table.
 * Point-in-time queries resolve each candidate's nearest state at-or-
 * before the requested timestamp; latest-state queries return the most
 * recent rows narrowed to the workspace/document.
 *
 * `foreign_refs`: queries `shared_slices` from SH-2. Filters out revoked
 * slices and optionally narrows by topic / documentId hint from the
 * planner. Returns version-cited slice content with sharer metadata.
 */

import { db } from '../../db/index'
import { and, desc, eq, gte, ilike, inArray, isNull, lte } from 'drizzle-orm'
import type { RetrievalPlan, RetrievalStep } from './planner'
import type { Boundary } from '../scope/types'
import { postFilterItems, type PostFilterStats } from './boundary-hook'
import { currentFactConditions } from '../semantic-index/current-fact-filter'
// SCOPE-A-1: type-only (no runtime cycle) — the contested-edge shape the
// assembler consumes is produced by findContradictsEdgesAmong below.
import type { ContestedEdge } from './assembler'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A single retrieved result from any source. `citation` is the
 * version/timestamp reference the LLM can cite in its reply.
 */
export interface RetrievedItem {
  source: RetrievalStep['source']
  content: string
  /**
   * SCOPE-A-1: the originating record id (`index_records.id`) for record-backed
   * sources. Used to join `semantic_links` for cross-author contested surfacing.
   * Optional — non-record sources (memory_layers, foreign_refs, …) omit it.
   */
  recordId?: string | null
  citation: {
    sourceFileId?: string | null
    sourceVersion?: number | null
    sourceContentHash?: string | null
    timestamp?: string
    label: string
    /** SCOPE-A-1: resolved author display name (who authored the fact). */
    author?: string | null
  }
  relevanceScore?: number
  metadata?: Record<string, unknown>
}

export interface RetrievalResult {
  items: RetrievedItem[]
  errors: Array<{ source: string; error: string }>
  totalLatencyMs: number
  /**
   * Sprint V41-QUERY-1: per-source pre-filter stats from applying boundaries
   * at retrieval time. Defense-in-depth post-filter in the assembler counts
   * separately via AssembledContext.postFilterStats.
   */
  preFilterStats?: PostFilterStats
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export interface ExecuteOptions {
  /**
   * Scope boundaries to apply at retrieval time. Each source best-effort
   * narrows its SQL (where trivially possible); anything that slips
   * through is caught by `postFilterItems` and finally again by the
   * assembler. Fail-closed: items missing the attribute a boundary needs
   * are dropped.
   */
  boundaries?: Boundary[]
}

/**
 * Execute a retrieval plan by querying all data sources in parallel.
 */
export async function executeRetrievalPlan(
  plan: RetrievalPlan,
  opts: ExecuteOptions = {}
): Promise<RetrievalResult> {
  const startTime = Date.now()
  const items: RetrievedItem[] = []
  const errors: Array<{ source: string; error: string }> = []

  // Propagate boundaries into each step's params where the source can use them.
  const effectiveSteps =
    opts.boundaries && opts.boundaries.length > 0
      ? plan.steps.map((s) => ({
          ...s,
          params: { ...s.params, boundaries: opts.boundaries },
        }))
      : plan.steps

  const stepResults = await Promise.allSettled(effectiveSteps.map((step) => executeStep(step)))

  for (let i = 0; i < stepResults.length; i++) {
    const step = effectiveSteps[i]!
    const result = stepResults[i]!

    if (result.status === 'fulfilled') {
      items.push(...result.value)
    } else {
      const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason)
      if (step.priority === 'required') {
        errors.push({ source: step.source, error: errMsg })
      }
      console.warn(`[ReferenceAgent] Step ${step.source} failed:`, errMsg)
    }
  }

  // First-pass post-filter at retrieval layer. This catches what the source-
  // specific SQL couldn't — e.g. confidence on memory_layers. Fail-closed.
  let finalItems = items
  let preFilterStats: PostFilterStats | undefined
  if (opts.boundaries && opts.boundaries.length > 0) {
    const filtered = postFilterItems(items, opts.boundaries, { failClosed: true })
    finalItems = filtered.items
    preFilterStats = filtered.stats
    if (filtered.stats.droppedFailed + filtered.stats.droppedUnknown > 0) {
      console.info(
        `[ReferenceAgent] Retrieval post-filter dropped ${filtered.stats.droppedFailed} failed + ${filtered.stats.droppedUnknown} unknown of ${items.length} items`
      )
    }
  }

  // SCOPE-A-1: resolve author display names for all record-backed items in a
  // single batched `users` lookup (no N+1). Additive — sets citation.author
  // only; never throws (best-effort, falls back to cached name).
  await attachAuthorNames(finalItems)

  return {
    items: finalItems,
    errors,
    totalLatencyMs: Date.now() - startTime,
    preFilterStats,
  }
}

/**
 * SCOPE-A-1: resolve author display names for retrieved items in one batched
 * `users` query. Sets `citation.author` per item. Resolution order:
 *   users.name (live) → cached metadata.contributorName → users.email → short id.
 * Best-effort and idempotent: mutates items in place; any DB failure falls back
 * to the cached contributor name so attribution still works offline/in tests.
 */
export async function attachAuthorNames(items: RetrievedItem[]): Promise<void> {
  const cachedName = (item: RetrievedItem): string | undefined =>
    (item.metadata?.['contributorName'] as string | undefined) || undefined
  const contributorId = (item: RetrievedItem): string | undefined =>
    (item.metadata?.['contributorId'] as string | undefined) || undefined

  const setFromCache = () => {
    for (const item of items) {
      if (item.citation.author) continue
      const id = contributorId(item)
      item.citation.author = cachedName(item) ?? (id ? id.slice(0, 8) : null)
    }
  }

  const ids = Array.from(
    new Set(items.map(contributorId).filter((v): v is string => typeof v === 'string'))
  )
  if (ids.length === 0) {
    setFromCache()
    return
  }

  try {
    const { users } = await import('../../db/schema/users')
    const rows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, ids))
    const byId = new Map(rows.map((r) => [r.id, r]))
    for (const item of items) {
      const id = contributorId(item)
      if (!id) continue
      const u = byId.get(id)
      item.citation.author = u?.name || cachedName(item) || u?.email || id.slice(0, 8)
    }
  } catch (err) {
    console.warn('[ReferenceAgent] author name resolution failed (non-fatal):', err)
    setFromCache()
  }
}

/**
 * SCOPE-A-1: find `contradicts` edges whose BOTH endpoints are in the given
 * record-id set (bounded to the retrieved set, so it's a cheap two-sided
 * `IN` filter). The ANALYST reason/confidence live in `metadata.analyst`
 * (top-level `reason` is null for ANALYST edges). Best-effort: returns [] on
 * any failure so contested surfacing never breaks retrieval.
 */
export async function findContradictsEdgesAmong(recordIds: string[]): Promise<ContestedEdge[]> {
  const ids = Array.from(
    new Set(recordIds.filter((v): v is string => typeof v === 'string' && v.length > 0))
  )
  if (ids.length < 2) return []
  try {
    const { semanticLinks } = await import('../../db/schema/semantic-index')
    const rows = await db
      .select({
        sourceRecordId: semanticLinks.sourceRecordId,
        targetRecordId: semanticLinks.targetRecordId,
        reason: semanticLinks.reason,
        crossUser: semanticLinks.crossUser,
        metadata: semanticLinks.metadata,
      })
      .from(semanticLinks)
      .where(
        and(
          eq(semanticLinks.linkType, 'contradicts'),
          isNull(semanticLinks.deletedAt),
          inArray(semanticLinks.sourceRecordId, ids),
          inArray(semanticLinks.targetRecordId, ids)
        )
      )
    return rows.map((r) => {
      const analyst = ((r.metadata ?? {}) as { analyst?: { reason?: string; confidence?: number } })
        .analyst
      return {
        sourceRecordId: r.sourceRecordId,
        targetRecordId: r.targetRecordId,
        reason: r.reason ?? analyst?.reason ?? null,
        confidence: analyst?.confidence ?? null,
        crossUser: r.crossUser,
      }
    })
  } catch (err) {
    console.warn('[ReferenceAgent] contested edge lookup failed (non-fatal):', err)
    return []
  }
}

// ─── Step Dispatcher ─────────────────────────────────────────────────────────

async function executeStep(step: RetrievalStep): Promise<RetrievedItem[]> {
  switch (step.source) {
    case 'index_records':
      return retrieveFromIndexRecords(step)
    case 'index_states':
      return retrieveFromIndexStates(step)
    case 'file_versions':
      return retrieveFromFileVersions(step)
    case 'gws_snapshots':
      return retrieveFromGwsSnapshots(step)
    case 'episodes':
      return retrieveFromEpisodes(step)
    case 'evidence':
      return retrieveFromEvidence(step)
    case 'memory_layers':
      return retrieveFromMemoryLayers(step)
    case 'decision_trails':
      return retrieveFromDecisionTrails(step)
    case 'chat_history':
      return retrieveFromChatHistory(step)
    case 'thread_events':
      return retrieveFromThreadEvents(step)
    case 'foreign_refs':
      return retrieveFromForeignRefs(step)
    default:
      return []
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isoDate(d: Date | null | undefined): string | undefined {
  if (!d) return undefined
  if (d instanceof Date) return d.toISOString()
  const parsed = new Date(d as unknown as string)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

function shortDate(d: Date | null | undefined): string {
  const iso = isoDate(d)
  return iso ? iso.substring(0, 10) : '?'
}

// ─── Source: index_records ───────────────────────────────────────────────────
// Note: indexRecords has `embeddingText`, not `content`. The stored text
// is the composed text that was embedded — the best "what does this
// record represent" string we have without re-querying the source.

async function retrieveFromIndexRecords(step: RetrievalStep): Promise<RetrievedItem[]> {
  const { workspaceId, documentId, limit = 10 } = step.params
  if (!workspaceId) return []

  try {
    const { indexRecords } = await import('../../db/schema/semantic-index')
    const conditions = [eq(indexRecords.workspaceId, workspaceId)]
    // VERSION-B1 (+ pre-existing leak-fix): exclude superseded (older doc versions),
    // tombstoned, and user-hidden facts from current answers. Shared, version-safe
    // filter (superseded_at only — never source_version). See current-fact-filter.ts.
    conditions.push(...currentFactConditions())
    if (documentId) {
      conditions.push(eq(indexRecords.sourceFileId, documentId))
    }

    // V41-QUERY-1: best-effort time + contributor pre-filter at the SQL layer.
    const boundaries = (step.params as { boundaries?: unknown }).boundaries as
      | Boundary[]
      | undefined
    if (boundaries?.length) {
      for (const b of boundaries) {
        if (
          b.dimension === 'time' &&
          b.op === 'within' &&
          b.window?.type === 'relative' &&
          b.window.days
        ) {
          const cutoff = new Date(Date.now() - b.window.days * 24 * 60 * 60 * 1000)
          conditions.push(gte(indexRecords.indexedAt, cutoff))
        }
        if (b.dimension === 'contributor' && b.op === 'include') {
          const ids = [b.value, ...(b.values ?? [])].filter(
            (v): v is string => typeof v === 'string'
          )
          if (ids.length > 0) conditions.push(inArray(indexRecords.userId, ids))
        }
      }
    }

    const rows = await db
      .select()
      .from(indexRecords)
      .where(and(...conditions))
      .orderBy(desc(indexRecords.indexedAt))
      .limit(limit)

    return rows.map((r) => ({
      source: 'index_records' as const,
      // SCOPE-A-1: carry the record id so the contested join can match edges.
      recordId: r.id,
      content: r.embeddingText ?? '',
      citation: {
        sourceFileId: r.sourceFileId,
        sourceVersion: r.sourceVersion,
        sourceContentHash: r.sourceContentHash,
        timestamp: isoDate(r.indexedAt),
        label:
          r.sourceVersion != null
            ? `Index record (source v${r.sourceVersion}, ${shortDate(r.indexedAt)})`
            : `Index record (${shortDate(r.indexedAt)})`,
        // SCOPE-A-1: author resolved in attachAuthorNames() before assembly.
      },
      relevanceScore: r.engagementDepth ?? undefined,
      metadata: {
        documentId: r.documentId,
        documentTitle: r.documentTitle,
        sectionAlias: r.sectionAlias,
        // V41-QUERY-1: expose filterable attributes for boundary-hook.
        contributorId: r.userId,
        // SCOPE-A-1: cached display name fallback for author resolution.
        contributorName: r.userName ?? null,
        confidence: r.engagementDepth ?? undefined,
        indexId: r.workspaceId,
        sourceTool: 'index_records',
      },
    }))
  } catch (err) {
    console.warn('[ReferenceAgent] index_records retrieval error:', err)
    return []
  }
}

// ─── Source: index_states (Sprint IX-10) ─────────────────────────────────────
// Queries the `index_record_states` table directly. When `asOfTimestamp` is
// provided, returns each candidate record's nearest state at-or-before that
// timestamp (true point-in-time recall). Otherwise returns the latest states
// across the workspace, optionally narrowed by sourceFileId.
//
// Static states (frozen audit snapshots) are preferred when both exist for
// the same record at the requested time, since they represent the
// "what did the AI know when..." truth. Live states fall through.

async function retrieveFromIndexStates(step: RetrievalStep): Promise<RetrievedItem[]> {
  const { workspaceId, documentId, asOfTimestamp, limit = 10 } = step.params
  if (!workspaceId) return []

  try {
    const { indexRecords, indexRecordStates } = await import('../../db/schema/semantic-index')

    // Point-in-time query: find candidate records, then resolve each one's
    // nearest state at-or-before the timestamp.
    if (asOfTimestamp) {
      const recordConditions = [eq(indexRecords.workspaceId, workspaceId)]
      if (documentId) {
        recordConditions.push(eq(indexRecords.sourceFileId, documentId))
      }

      const candidates = await db
        .select({ id: indexRecords.id })
        .from(indexRecords)
        .where(and(...recordConditions))
        .limit(limit)

      const out: RetrievedItem[] = []
      for (const candidate of candidates) {
        const stateRows = await db
          .select()
          .from(indexRecordStates)
          .where(
            and(
              eq(indexRecordStates.indexRecordId, candidate.id),
              lte(indexRecordStates.capturedAt, asOfTimestamp)
            )
          )
          .orderBy(desc(indexRecordStates.capturedAt))
          .limit(1)

        const state = stateRows[0]
        if (!state) continue

        out.push({
          source: 'index_states' as const,
          content: state.embeddingText ?? '',
          citation: {
            sourceFileId: state.sourceFileId,
            sourceVersion: state.sourceVersion,
            sourceContentHash: state.sourceContentHash,
            timestamp: isoDate(state.capturedAt),
            label: `${state.stateType} state at ${shortDate(state.capturedAt)} (${state.capturedBy ?? 'unknown'})`,
          },
          metadata: {
            stateType: state.stateType,
            stateHash: state.stateHash,
            engagementDepth: state.engagementDepth,
            captureReason: state.captureReason,
            documentId: state.documentId,
            sectionAlias: state.sectionAlias,
          },
        })
      }
      return out
    }

    // No timestamp — return the latest states overall (workspace-scoped via
    // the underlying records, optionally narrowed by document).
    const recordConditions = [eq(indexRecords.workspaceId, workspaceId)]
    if (documentId) {
      recordConditions.push(eq(indexRecords.sourceFileId, documentId))
    }
    const candidates = await db
      .select({ id: indexRecords.id })
      .from(indexRecords)
      .where(and(...recordConditions))
      .limit(limit * 2)

    if (candidates.length === 0) return []
    const candidateIds = new Set(candidates.map((c) => c.id))

    const stateRows = await db
      .select()
      .from(indexRecordStates)
      .orderBy(desc(indexRecordStates.capturedAt))
      .limit(limit * 4)

    return stateRows
      .filter((s) => candidateIds.has(s.indexRecordId))
      .slice(0, limit)
      .map((s) => ({
        source: 'index_states' as const,
        content: s.embeddingText ?? '',
        citation: {
          sourceFileId: s.sourceFileId,
          sourceVersion: s.sourceVersion,
          sourceContentHash: s.sourceContentHash,
          timestamp: isoDate(s.capturedAt),
          label: `${s.stateType} state ${shortDate(s.capturedAt)} (${s.capturedBy ?? 'unknown'}: ${s.captureReason ?? 'no reason'})`,
        },
        metadata: {
          stateType: s.stateType,
          stateHash: s.stateHash,
          engagementDepth: s.engagementDepth,
          captureReason: s.captureReason,
          documentId: s.documentId,
          sectionAlias: s.sectionAlias,
        },
      }))
  } catch (err) {
    console.warn('[ReferenceAgent] index_states retrieval error:', err)
    return []
  }
}

// ─── Source: file_versions ───────────────────────────────────────────────────

async function retrieveFromFileVersions(step: RetrievalStep): Promise<RetrievedItem[]> {
  const { documentId, version, asOfTimestamp, limit = 3 } = step.params
  if (!documentId) return []

  try {
    const { fileVersions } = await import('../../db/schema/files')
    const conditions = [eq(fileVersions.fileId, documentId)]
    if (version != null) {
      conditions.push(eq(fileVersions.versionNumber, version))
    }
    if (asOfTimestamp) {
      conditions.push(lte(fileVersions.createdAt, asOfTimestamp))
    }

    const rows = await db
      .select()
      .from(fileVersions)
      .where(and(...conditions))
      .orderBy(desc(fileVersions.versionNumber))
      .limit(limit)

    return rows.map((v) => ({
      source: 'file_versions' as const,
      content: v.diffSummary ?? `Version ${v.versionNumber}`,
      citation: {
        sourceFileId: documentId,
        sourceVersion: v.versionNumber,
        timestamp: isoDate(v.createdAt),
        label: `Document v${v.versionNumber} (${shortDate(v.createdAt)})`,
      },
      metadata: { storagePath: v.storagePath, sizeBytes: v.sizeBytes },
    }))
  } catch (err) {
    console.warn('[ReferenceAgent] file_versions error:', err)
    return []
  }
}

// ─── Source: gws_snapshots (IX-9) ────────────────────────────────────────────

async function retrieveFromGwsSnapshots(step: RetrievalStep): Promise<RetrievedItem[]> {
  const { externalDocId, version, asOfTimestamp, limit = 3 } = step.params
  if (!externalDocId) return []

  try {
    const { gwsSnapshots } = await import('../../db/schema/semantic-index')
    const conditions = [eq(gwsSnapshots.externalDocId, externalDocId)]
    if (version != null) {
      conditions.push(eq(gwsSnapshots.version, version))
    }
    if (asOfTimestamp) {
      conditions.push(lte(gwsSnapshots.createdAt, asOfTimestamp))
    }

    const rows = await db
      .select()
      .from(gwsSnapshots)
      .where(and(...conditions))
      .orderBy(desc(gwsSnapshots.version))
      .limit(limit)

    return rows.map((s) => ({
      source: 'gws_snapshots' as const,
      content: s.content,
      citation: {
        sourceFileId: externalDocId,
        sourceVersion: s.version,
        sourceContentHash: s.contentHash,
        timestamp: isoDate(s.createdAt),
        label: `Google Doc v${s.version} (${shortDate(s.createdAt)})`,
      },
      metadata: {
        docType: s.docType,
        triggerType: s.triggerType,
        diffSummary: s.diffSummary,
      },
    }))
  } catch (err) {
    console.warn('[ReferenceAgent] gws_snapshots error:', err)
    return []
  }
}

// ─── Source: episodes ────────────────────────────────────────────────────────

async function retrieveFromEpisodes(step: RetrievalStep): Promise<RetrievedItem[]> {
  const { workspaceId, topic, limit = 10 } = step.params
  if (!workspaceId) return []

  try {
    const { episodes } = await import('../../db/schema/semantic-index')
    const rows = await db
      .select()
      .from(episodes)
      .where(eq(episodes.workspaceId, workspaceId))
      .orderBy(desc(episodes.startedAt))
      .limit(limit * 2)

    const topicLower = topic?.toLowerCase()
    const filtered = topicLower
      ? rows.filter((e) => {
          const haystack = `${e.title ?? ''} ${e.summaryText ?? ''}`.toLowerCase()
          return haystack.includes(topicLower)
        })
      : rows

    return filtered.slice(0, limit).map((e) => ({
      source: 'episodes' as const,
      content: e.summaryText ?? e.title ?? '(unnamed episode)',
      citation: {
        timestamp: isoDate(e.startedAt),
        label: `Episode: ${e.title ?? e.summaryText?.substring(0, 50) ?? 'unnamed'} (${shortDate(e.startedAt)})`,
      },
      metadata: {
        status: e.status,
        recordCount: e.recordCount,
        endedAt: isoDate(e.endedAt),
      },
    }))
  } catch (err) {
    console.warn('[ReferenceAgent] episodes error:', err)
    return []
  }
}

// ─── Source: evidence ────────────────────────────────────────────────────────

async function retrieveFromEvidence(step: RetrievalStep): Promise<RetrievedItem[]> {
  const { workspaceId, documentId, limit = 10 } = step.params
  if (!workspaceId) return []

  try {
    const { evidenceRecords } = await import('../../db/schema/semantic-index')
    const conditions = [eq(evidenceRecords.workspaceId, workspaceId)]
    if (documentId) {
      conditions.push(eq(evidenceRecords.documentId, documentId))
    }

    const rows = await db
      .select()
      .from(evidenceRecords)
      .where(and(...conditions))
      .orderBy(desc(evidenceRecords.createdAt))
      .limit(limit)

    return rows.map((r) => {
      // Evidence content is one of: contentAfter, contentBefore, chatExchange, sourceSnapshot
      const parts: string[] = []
      if (r.contentBefore) parts.push(`Before: ${r.contentBefore}`)
      if (r.contentAfter) parts.push(`After: ${r.contentAfter}`)
      if (r.chatExchange) parts.push(`Exchange: ${JSON.stringify(r.chatExchange)}`)
      if (!parts.length && r.sourceSnapshot) {
        parts.push(`Source: ${JSON.stringify(r.sourceSnapshot)}`)
      }
      const content = parts.join('\n') || '(empty evidence)'

      // IX-9 stashed version refs inside sourceSnapshot.sourceVersions
      const snapshot = r.sourceSnapshot as
        | { sourceVersions?: Array<{ fileId?: string; version?: number; contentHash?: string }> }
        | null
        | undefined
      const firstVer = snapshot?.sourceVersions?.[0]

      return {
        source: 'evidence' as const,
        content,
        citation: {
          sourceFileId: firstVer?.fileId ?? r.documentId ?? undefined,
          sourceVersion: firstVer?.version ?? null,
          sourceContentHash: firstVer?.contentHash ?? null,
          timestamp: isoDate(r.createdAt),
          label: `Evidence: ${r.evidenceType} (${shortDate(r.createdAt)})`,
        },
        metadata: {
          evidenceType: r.evidenceType,
          sectionRef: r.sectionRef,
          ownershipTier: r.ownershipTier,
        },
      }
    })
  } catch (err) {
    console.warn('[ReferenceAgent] evidence error:', err)
    return []
  }
}

// ─── Source: memory_layers (AI state) ────────────────────────────────────────
// readFullState signature: (userId, workspaceId, documentId?) → {immediate, event, session, persistent, shared?}
// The spec's draft used a different signature; we adapt to the real one.

async function retrieveFromMemoryLayers(step: RetrievalStep): Promise<RetrievedItem[]> {
  const { workspaceId, documentId, userId } = step.params
  // GOVERNANCE-AUDIT-FIX-1: userId is now threaded by the planner for
  // multi_layer / longitudinal intents. If it's still missing (older caller
  // paths), fail-closed with empty — no guessing.
  if (!workspaceId || !userId) return []

  try {
    const { readFullState } = await import('../ai-state/state-reader')
    const state = await readFullState(userId, workspaceId, documentId ?? null)
    const items: RetrievedItem[] = []

    // Immediate layer — current focus / presence / queued events
    const focus = state.immediate?.focus
    if (focus?.documentId || focus?.documentTitle) {
      const title = focus.documentTitle ?? focus.documentId ?? 'current focus'
      items.push({
        source: 'memory_layers',
        content: `Focus: ${title}${focus.sectionRef ? ` § ${focus.sectionRef}` : ''} (surface: ${focus.surface ?? 'unknown'})`,
        citation: { label: `immediate: ${title}` },
        metadata: { contributorId: userId, workspaceId, layer: 'immediate' },
      })
    }

    // Event layer — recent key changes
    const keyEvents = (state.event?.recentEvents ?? []).filter((e) => e.isKeyChange).slice(0, 5)
    for (const ev of keyEvents) {
      items.push({
        source: 'memory_layers',
        content: `[${ev.threadType.toUpperCase()}] ${ev.label}`,
        citation: {
          timestamp: ev.timestamp,
          label: `event: ${ev.label.slice(0, 60)}`,
        },
        metadata: { contributorId: userId, workspaceId, layer: 'event' },
      })
    }

    // Session layer — condensed understanding
    const summary = (state.session as { summary?: string } | undefined)?.summary
    if (summary) {
      items.push({
        source: 'memory_layers',
        content: summary.slice(0, 500),
        citation: { label: 'session summary' },
        metadata: { contributorId: userId, workspaceId, layer: 'session' },
      })
    }

    // Persistent layer — work-style / patterns
    const persistent = state.persistent as unknown as Record<string, unknown> | undefined
    if (persistent && typeof persistent === 'object') {
      const keys = Object.keys(persistent).slice(0, 3)
      for (const key of keys) {
        const value = persistent[key]
        if (value == null) continue
        items.push({
          source: 'memory_layers',
          content: `${key}: ${typeof value === 'string' ? value : JSON.stringify(value).slice(0, 200)}`,
          citation: { label: `persistent: ${key}` },
          metadata: { contributorId: userId, workspaceId, layer: 'persistent' },
        })
      }
    }

    return items
  } catch (err) {
    console.warn('[ReferenceAgent] memory_layers error:', err)
    return []
  }
}

// ─── Source: decision_trails ─────────────────────────────────────────────────
// documentDecisionTrails shape: { fileId, paragraphRef, trailSteps: Array<{step, type, timestamp}>, stabilityScore, humanAuthoredPct, anchorSource, updatedAt }
// NOT the spec draft's { decision, reasoning, alternatives, context }.

async function retrieveFromDecisionTrails(step: RetrievalStep): Promise<RetrievedItem[]> {
  const { documentId, limit = 5 } = step.params
  if (!documentId) return []

  try {
    const { documentDecisionTrails } = await import('../../db/schema/doc-memory')
    const rows = await db
      .select()
      .from(documentDecisionTrails)
      .where(eq(documentDecisionTrails.fileId, documentId))
      .orderBy(desc(documentDecisionTrails.updatedAt))
      .limit(limit)

    return rows.map((t) => {
      const steps = (t.trailSteps ?? []) as Array<{
        step: string
        type: string
        timestamp: string
      }>
      const rendered = steps
        .slice(0, 5)
        .map((s) => `  • [${s.type}] ${s.step}`)
        .join('\n')
      const content = `Paragraph: ${t.paragraphRef}\nStability: ${t.stabilityScore.toFixed(2)}, human-authored: ${(t.humanAuthoredPct * 100).toFixed(0)}%\nTrail:\n${rendered || '  (no steps recorded)'}`

      return {
        source: 'decision_trails' as const,
        content,
        citation: {
          sourceFileId: documentId,
          timestamp: isoDate(t.updatedAt),
          label: `Decision trail: "${t.paragraphRef.substring(0, 40)}…" (${shortDate(t.updatedAt)})`,
        },
        metadata: {
          anchorSource: t.anchorSource,
          stabilityScore: t.stabilityScore,
          humanAuthoredPct: t.humanAuthoredPct,
          stepCount: steps.length,
        },
      }
    })
  } catch (err) {
    console.warn('[ReferenceAgent] decision_trails error:', err)
    return []
  }
}

// ─── Source: chat_history ────────────────────────────────────────────────────

async function retrieveFromChatHistory(step: RetrievalStep): Promise<RetrievedItem[]> {
  const { workspaceId, query, limit = 10 } = step.params
  if (!workspaceId) return []

  try {
    const { chatMessages, chatConversations } = await import('../../db/schema/chat')

    const conversations = await db
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(eq(chatConversations.workspaceId, workspaceId))
      .limit(20)

    if (conversations.length === 0) return []
    const convIds = conversations.map((c) => c.id)

    const conditions = [inArray(chatMessages.conversationId, convIds)]
    if (query) {
      conditions.push(ilike(chatMessages.content, `%${query}%`))
    }

    const rows = await db
      .select()
      .from(chatMessages)
      .where(and(...conditions))
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit)

    return rows.map((m) => ({
      source: 'chat_history' as const,
      content: m.content ?? '',
      citation: {
        sourceFileId: m.conversationId,
        timestamp: isoDate(m.createdAt),
        label: `Chat message (${m.role}, ${shortDate(m.createdAt)})`,
      },
      metadata: { role: m.role, conversationId: m.conversationId },
    }))
  } catch (err) {
    console.warn('[ReferenceAgent] chat_history error:', err)
    return []
  }
}

// ─── Source: thread_events ───────────────────────────────────────────────────

async function retrieveFromThreadEvents(step: RetrievalStep): Promise<RetrievedItem[]> {
  const { asOfTimestamp, limit = 10 } = step.params

  try {
    const { threadEvents } = await import('../../db/schema/threads')
    const conditions: ReturnType<typeof eq>[] = []
    if (asOfTimestamp) {
      conditions.push(lte(threadEvents.time, asOfTimestamp))
    }

    const rows = await db
      .select()
      .from(threadEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(threadEvents.time))
      .limit(limit)

    return rows.map((e) => ({
      source: 'thread_events' as const,
      content: e.label ?? '',
      citation: {
        timestamp: isoDate(e.time),
        label: `Thread event: ${e.type} — "${(e.label ?? '').substring(0, 40)}…" (${shortDate(e.time)})`,
      },
      metadata: {
        type: e.type,
        magnitude: e.magnitude,
        keyChange: e.keyChange,
        contextNotes: e.contextNotes,
      },
    }))
  } catch (err) {
    console.warn('[ReferenceAgent] thread_events error:', err)
    return []
  }
}

// ─── Source: foreign_refs (Sprint SH-2) ──────────────────────────────────────
//
// Shared slices are content packages another user (the "from" user) has
// approved + filtered + sent into this workspace. The retriever surfaces
// them via the `foreign_refs` source so the LLM can cite "Shared by User
// X (preset, redactions)" alongside its own index records.
//
// TODO: thread `userId` through `RetrievalStep.params` so we can scope
// to `toUserId === currentUser`. For now we filter by workspace and
// exclude revoked slices in JS (drizzle's isNull import is gated by
// version compatibility — JS filter is portable).

async function retrieveFromForeignRefs(step: RetrievalStep): Promise<RetrievedItem[]> {
  const { workspaceId, topic, documentId, limit = 10 } = step.params
  if (!workspaceId) return []

  try {
    const { sharedSlices } = await import('../../db/schema/sharing')

    const slices = await db
      .select()
      .from(sharedSlices)
      .where(eq(sharedSlices.workspaceId, workspaceId))
      .orderBy(desc(sharedSlices.createdAt))
      .limit(limit * 2) // over-fetch so post-filter still has room

    const topicLower = topic?.toLowerCase()
    const filtered = slices
      .filter((s) => !s.revokedAt) // exclude soft-deleted
      .filter((s) => {
        if (topicLower && !s.sliceContent.toLowerCase().includes(topicLower)) return false
        if (documentId && s.scopeRefId !== documentId) return false
        return true
      })
      .slice(0, limit)

    return filtered.map((s) => ({
      source: 'foreign_refs' as const,
      content: s.sliceContent,
      citation: {
        sourceFileId: s.scopeRefId ?? undefined,
        timestamp: isoDate(s.createdAt),
        label: `Shared slice (${s.presetUsed} preset, ${s.redactionCount} redactions, ${shortDate(s.createdAt)})`,
      },
      metadata: {
        sliceId: s.id,
        fromUserId: s.fromUserId,
        presetUsed: s.presetUsed,
        redactionCount: s.redactionCount,
        sourceMetadata: s.sliceMetadata,
      },
    }))
  } catch (err) {
    console.warn('[ReferenceAgent] foreign_refs retrieval error:', err)
    return []
  }
}
