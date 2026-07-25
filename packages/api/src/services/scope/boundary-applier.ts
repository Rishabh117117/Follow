/**
 * Boundary Applier (Sprint SCOPE-LIVECTX-1)
 *
 * Resolves effective boundaries for a tool call:
 *   1. If the caller passed explicit `boundaries`, those override the active scope.
 *   2. Otherwise fall back to the active session scope.
 *   3. If neither is present, returns an empty list (unscoped mode).
 *
 * Also performs the governance pre-check: returns conflicts rather than
 * silently dropping boundaries. Caller must decide whether to execute
 * retrieval anyway (minus blocked boundaries) or short-circuit.
 */

import {
  getActiveScope,
  resolveAgainstGovernance,
  loadGovernanceSnapshot,
  buildScopeFromBoundaries,
} from './index'
import type { Boundary, ScopeConflict } from './types'

export interface ResolveParams {
  userId: string
  workspaceId: string
  sessionToken: string
  /** Call-time override. If present, replaces session scope for this call. */
  explicitBoundaries?: Boundary[]
}

export interface ResolveResult {
  boundaries: Boundary[]
  conflicts: ScopeConflict[]
  /** true iff no boundaries are in effect (session scope absent, no override). */
  unscoped: boolean
}

export async function resolveEffectiveBoundaries(
  params: ResolveParams
): Promise<ResolveResult> {
  let base: Boundary[]
  if (params.explicitBoundaries && params.explicitBoundaries.length > 0) {
    base = params.explicitBoundaries
  } else {
    const active = await getActiveScope(params.sessionToken, params.userId)
    base = active?.boundaries ?? []
  }

  if (base.length === 0) {
    return { boundaries: [], conflicts: [], unscoped: true }
  }

  // Governance pre-check.
  const governance = await loadGovernanceSnapshot({
    userId: params.userId,
    workspaceId: params.workspaceId,
  })
  const transient = buildScopeFromBoundaries({
    userId: params.userId,
    workspaceId: params.workspaceId,
    boundaries: base,
  })
  const resolved = resolveAgainstGovernance(transient, governance)

  return {
    boundaries: resolved.scope.boundaries,
    conflicts: resolved.conflicts,
    unscoped: false,
  }
}

// ─── Post-filter helpers (applied after retrieval) ───────────────────────────

export interface Filterable {
  score?: number
  text?: string
  createdAt?: Date | string | null
  topic?: string | null
  contributorId?: string | null
  indexId?: string | null
  [k: string]: unknown
}

export function applyPostFilters<T extends Filterable>(
  items: T[],
  boundaries: Boundary[]
): T[] {
  if (!boundaries.length) return items
  return items.filter((item) => boundaries.every((b) => matchesBoundary(item, b)))
}

function matchesBoundary(item: Filterable, b: Boundary): boolean {
  switch (b.dimension) {
    case 'confidence': {
      const s = item.score
      if (typeof s !== 'number') return true
      if (b.op === 'gte' && typeof b.value === 'number') return s >= b.value
      if (b.op === 'lte' && typeof b.value === 'number') return s <= b.value
      return true
    }
    case 'time': {
      if (!item.createdAt) return true
      const created = new Date(item.createdAt).getTime()
      if (b.op === 'within' && b.window) {
        const now = Date.now()
        if (b.window.type === 'relative' && b.window.days) {
          return created >= now - b.window.days * 24 * 60 * 60 * 1000
        }
        if (b.window.type === 'absolute') {
          const from = b.window.from ? Date.parse(b.window.from) : -Infinity
          const to = b.window.to ? Date.parse(b.window.to) : Infinity
          return created >= from && created <= to
        }
      }
      return true
    }
    case 'topic': {
      const t = item.topic
      if (!t) return true
      const needles = collectValues(b).map((v) => String(v).toLowerCase())
      if (b.op === 'include') return needles.length === 0 || needles.includes(t.toLowerCase())
      if (b.op === 'exclude') return !needles.includes(t.toLowerCase())
      if (b.op === 'matches' && b.value) {
        return new RegExp(String(b.value), 'i').test(t)
      }
      return true
    }
    case 'contributor': {
      const c = item.contributorId
      const ids = collectValues(b).map((v) => String(v))
      if (b.op === 'include') return c ? ids.includes(c) : ids.length === 0
      if (b.op === 'exclude') return !c || !ids.includes(c)
      return true
    }
    case 'index': {
      const i = item.indexId
      const ids = collectValues(b).map((v) => String(v))
      if (b.op === 'include') return i ? ids.includes(i) : ids.length === 0
      if (b.op === 'exclude') return !i || !ids.includes(i)
      return true
    }
    default:
      // edge_type / privacy / freshness / source_tool / provenance / custom —
      // retrievers don't surface these uniformly, so best-effort pass-through.
      return true
  }
}

function collectValues(b: Boundary): unknown[] {
  const out: unknown[] = []
  if (b.value !== undefined) out.push(b.value)
  if (b.values) out.push(...b.values)
  return out
}

// ─── Conflict summary for natural-language responses ─────────────────────────

export function summarizeConflictsForResponse(conflicts: ScopeConflict[]): string {
  if (!conflicts.length) return ''
  const lines = conflicts.map((c) => `- ${c.resolution.reason}${c.resolution.next_step ? ` → ${c.resolution.next_step}` : ''}`)
  return [
    '\n\n[SCOPE CONFLICTS — governance wins, these boundaries were not applied]',
    ...lines,
  ].join('\n')
}
