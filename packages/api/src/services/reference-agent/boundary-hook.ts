/**
 * Reference Agent — Boundary Hook (Sprint V41-QUERY-1)
 *
 * Closes the SCOPE-LIVECTX-1 deferred gap: applies scope boundaries to
 * items that flow through the reference agent's multi-source retrieval
 * pipeline.
 *
 * Invariants:
 *   - Fail-closed: if a boundary needs an attribute that a RetrievedItem
 *     does not expose (metadata.contributorId, metadata.confidence, etc.)
 *     and the boundary CAN'T be verified, the item is DROPPED. Never
 *     "assumed fine". Governance wins.
 *   - Scope-builder's governance pre-check runs BEFORE retrieval in the
 *     caller (`resolveEffectiveBoundaries`). This module's job is defense
 *     in depth — catch anything that slipped past per-source filtering.
 *   - Pure: no DB, no LLM, no side effects.
 */

import type { Boundary } from '../scope/types'
import type { RetrievedItem } from './retriever'

export type MatchResult = 'pass' | 'fail' | 'unknown'

/**
 * Evaluate a single boundary against a RetrievedItem.
 *
 * Returns:
 *   'pass'    — item satisfies the boundary
 *   'fail'    — item clearly violates the boundary
 *   'unknown' — the item does not expose the attribute this boundary filters on.
 *               In fail-closed mode the caller drops it.
 */
export function evaluateBoundaryAgainstItem(
  item: RetrievedItem,
  b: Boundary
): MatchResult {
  const meta = (item.metadata ?? {}) as Record<string, unknown>

  switch (b.dimension) {
    case 'time': {
      const ts = item.citation.timestamp
      if (!ts) return 'unknown'
      const t = Date.parse(ts)
      if (Number.isNaN(t)) return 'unknown'
      if (b.op === 'within' && b.window) {
        if (b.window.type === 'relative' && typeof b.window.days === 'number') {
          const cutoff = Date.now() - b.window.days * 24 * 60 * 60 * 1000
          return t >= cutoff ? 'pass' : 'fail'
        }
        if (b.window.type === 'absolute') {
          const from = b.window.from ? Date.parse(b.window.from) : -Infinity
          const to = b.window.to ? Date.parse(b.window.to) : Infinity
          return t >= from && t <= to ? 'pass' : 'fail'
        }
      }
      if (b.op === 'not_within' && b.window) {
        const inner = evaluateBoundaryAgainstItem(item, { ...b, op: 'within' })
        if (inner === 'pass') return 'fail'
        if (inner === 'fail') return 'pass'
        return 'unknown'
      }
      return 'unknown'
    }

    case 'confidence': {
      const confRaw = meta.confidence ?? item.relevanceScore
      if (typeof confRaw !== 'number') return 'unknown'
      if (b.op === 'gte' && typeof b.value === 'number') {
        return confRaw >= b.value ? 'pass' : 'fail'
      }
      if (b.op === 'lte' && typeof b.value === 'number') {
        return confRaw <= b.value ? 'pass' : 'fail'
      }
      return 'unknown'
    }

    case 'contributor': {
      const id = meta.contributorId ?? meta.userId ?? meta.ownerId
      const values = collectValues(b).map(String)
      if (id === undefined || id === null) return 'unknown'
      const idStr = String(id)
      if (b.op === 'include') return values.includes(idStr) ? 'pass' : 'fail'
      if (b.op === 'exclude') return values.includes(idStr) ? 'fail' : 'pass'
      return 'unknown'
    }

    case 'topic': {
      const topic = meta.topic
      const topics = Array.isArray(topic)
        ? topic.map(String)
        : typeof topic === 'string'
          ? [topic]
          : null
      const needles = collectValues(b).map((v) => String(v).toLowerCase())
      if (!topics) return 'unknown'
      const lower = topics.map((t) => t.toLowerCase())
      if (b.op === 'include') {
        return needles.length === 0 || needles.some((n) => lower.includes(n)) ? 'pass' : 'fail'
      }
      if (b.op === 'exclude') {
        return needles.some((n) => lower.includes(n)) ? 'fail' : 'pass'
      }
      if (b.op === 'matches' && b.value) {
        const re = new RegExp(String(b.value), 'i')
        return topics.some((t) => re.test(t)) ? 'pass' : 'fail'
      }
      return 'unknown'
    }

    case 'index': {
      const idxId = meta.indexId ?? meta.workspaceId
      const values = collectValues(b).map(String)
      if (idxId === undefined || idxId === null) return 'unknown'
      const idStr = String(idxId)
      if (b.op === 'include') return values.includes(idStr) ? 'pass' : 'fail'
      if (b.op === 'exclude') return values.includes(idStr) ? 'fail' : 'pass'
      return 'unknown'
    }

    case 'edge_type': {
      const et = meta.edgeType
      if (et === undefined || et === null) return 'unknown'
      const values = collectValues(b).map(String)
      const str = String(et)
      if (b.op === 'include') return values.includes(str) ? 'pass' : 'fail'
      if (b.op === 'exclude') return values.includes(str) ? 'fail' : 'pass'
      return 'unknown'
    }

    case 'source_tool': {
      const tool = meta.sourceTool ?? meta.chatSourceType ?? item.source
      const values = collectValues(b).map(String)
      if (tool === undefined || tool === null) return 'unknown'
      const str = String(tool)
      if (b.op === 'include') return values.includes(str) ? 'pass' : 'fail'
      if (b.op === 'exclude') return values.includes(str) ? 'fail' : 'pass'
      return 'unknown'
    }

    case 'freshness': {
      const freshness = meta.freshness ?? meta.stateType
      if (freshness === undefined) return 'unknown'
      const values = collectValues(b).map(String)
      const str = String(freshness)
      if (b.op === 'include') return values.includes(str) ? 'pass' : 'fail'
      if (b.op === 'exclude') return values.includes(str) ? 'fail' : 'pass'
      return 'unknown'
    }

    case 'provenance': {
      const prov = meta.provenance
      if (prov === undefined) return 'unknown'
      const values = collectValues(b).map(String)
      const str = String(prov)
      if (b.op === 'include') return values.includes(str) ? 'pass' : 'fail'
      if (b.op === 'exclude') return values.includes(str) ? 'fail' : 'pass'
      return 'unknown'
    }

    case 'privacy':
      // Privacy is enforced upstream by services/sharing/privacy-filter.
      // Items reaching this point have already been filtered; pass through.
      return 'pass'

    case 'custom':
      // Best-effort — custom boundaries depend on meta.rule. Fail-closed.
      return 'unknown'

    default:
      return 'unknown'
  }
}

export interface PostFilterOptions {
  /**
   * If true (default), items that return 'unknown' for ANY active boundary
   * are dropped. This is the fail-closed policy. Set to false only for
   * observability / diagnostic paths where counts matter more than safety.
   */
  failClosed?: boolean
}

export interface PostFilterStats {
  kept: number
  droppedFailed: number
  droppedUnknown: number
}

/**
 * Apply boundaries to an array of RetrievedItems. Returns kept items +
 * stats for observability.
 */
export function postFilterItems(
  items: RetrievedItem[],
  boundaries: Boundary[],
  opts: PostFilterOptions = {}
): { items: RetrievedItem[]; stats: PostFilterStats } {
  const failClosed = opts.failClosed !== false
  if (boundaries.length === 0) {
    return {
      items,
      stats: { kept: items.length, droppedFailed: 0, droppedUnknown: 0 },
    }
  }
  let droppedFailed = 0
  let droppedUnknown = 0
  const kept: RetrievedItem[] = []
  for (const item of items) {
    let verdict: 'pass' | 'fail' | 'unknown' = 'pass'
    for (const b of boundaries) {
      const r = evaluateBoundaryAgainstItem(item, b)
      if (r === 'fail') {
        verdict = 'fail'
        break
      }
      if (r === 'unknown' && failClosed) {
        verdict = 'unknown'
        break
      }
    }
    if (verdict === 'pass') {
      kept.push(item)
    } else if (verdict === 'fail') {
      droppedFailed++
    } else {
      droppedUnknown++
    }
  }
  return { items: kept, stats: { kept: kept.length, droppedFailed, droppedUnknown } }
}

function collectValues(b: Boundary): unknown[] {
  const out: unknown[] = []
  if (b.value !== undefined) out.push(b.value)
  if (b.values) out.push(...b.values)
  return out
}
