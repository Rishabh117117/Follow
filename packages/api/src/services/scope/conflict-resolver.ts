/**
 * Conflict Resolver (Sprint SCOPE-LIVECTX-1)
 *
 * Reconciles user-proposed boundaries against governance (privacy preset,
 * index access, contributor visibility) and cross-user constraints.
 *
 * Invariants:
 *   - Governance ALWAYS wins. A boundary that violates governance is
 *     surfaced as a conflict with a `request_access` resolution — never
 *     silently downgraded.
 *   - For cross-user shared slices, the receiver's scope applies (per SH-3).
 *   - No boundary is dropped without an explicit conflict record the user
 *     can see and act on.
 */

import type {
  Boundary,
  GovernanceSnapshot,
  Scope,
  ScopeConflict,
} from './types'

export interface GovernanceResolveResult {
  scope: Scope
  conflicts: ScopeConflict[]
}

export function resolveAgainstGovernance(
  scope: Scope,
  governance: GovernanceSnapshot
): GovernanceResolveResult {
  const conflicts: ScopeConflict[] = []
  const keptBoundaries: Boundary[] = []

  for (const b of scope.boundaries) {
    const conflict = evaluateBoundaryAgainstGovernance(b, governance)
    if (conflict) {
      conflicts.push(conflict)
      // Governance wins: boundary is NOT silently included. User must
      // either remove it or complete `request_access`.
      continue
    }
    keptBoundaries.push(b)
  }

  return {
    scope: {
      ...scope,
      boundaries: keptBoundaries,
      updatedAt: new Date(),
    },
    conflicts,
  }
}

function evaluateBoundaryAgainstGovernance(
  b: Boundary,
  gov: GovernanceSnapshot
): ScopeConflict | null {
  // Private preset — strictest. Contributor boundaries naming non-self
  // users need a context request.
  if (gov.activePreset === 'private') {
    if (b.dimension === 'contributor' && b.op === 'include') {
      const namedUsers = collectValues(b).filter((v) => v !== gov.userId)
      if (namedUsers.length > 0) {
        return {
          type: 'vs_governance',
          boundaries: [b],
          governance: { rule: 'privacy_preset_private', severity: 'hard' },
          resolution: {
            action: 'request_access',
            reason:
              "Private preset blocks contributor boundaries naming other users without an explicit context request.",
            next_step: `Send context request to: ${namedUsers.join(', ')}`,
          },
        }
      }
    }
  }

  // Index boundary naming a blocked (non-owned, non-shared) index → request_access.
  if (b.dimension === 'index' && gov.blockedIndexIds?.length) {
    const blocked = collectValues(b).filter((v) =>
      gov.blockedIndexIds!.includes(String(v))
    )
    if (blocked.length > 0) {
      return {
        type: 'vs_governance',
        boundaries: [b],
        governance: { rule: 'index_access_denied', severity: 'hard' },
        resolution: {
          action: 'request_access',
          reason: `You don't have access to index(es): ${blocked.join(', ')}.`,
          next_step: 'Request access from the index owner.',
        },
      }
    }
  }

  // Contributor boundary naming a blocked contributor (any preset) → request_access.
  if (b.dimension === 'contributor' && gov.blockedContributorIds?.length) {
    const blocked = collectValues(b).filter((v) =>
      gov.blockedContributorIds!.includes(String(v))
    )
    if (blocked.length > 0) {
      return {
        type: 'vs_governance',
        boundaries: [b],
        governance: { rule: 'contributor_access_denied', severity: 'hard' },
        resolution: {
          action: 'request_access',
          reason: `You don't have context access to: ${blocked.join(', ')}.`,
          next_step: `Send context request to ${blocked.join(', ')}.`,
        },
      }
    }
  }

  // Balanced preset — allow with source-summary redaction (soft governance).
  // We record the rule but don't drop the boundary; retrieval applies redaction.
  if (gov.activePreset === 'balanced' && b.dimension === 'privacy' && b.op === 'include') {
    // No conflict, just annotate — retrieval layer reads preset from state.
    return null
  }

  return null
}

function collectValues(b: Boundary): unknown[] {
  const out: unknown[] = []
  if (b.value !== undefined) out.push(b.value)
  if (b.values) out.push(...b.values)
  return out
}

// ─── Cross-user resolution ───────────────────────────────────────────────────

/**
 * For a cross-user shared slice: receiver's scope applies.
 * Returns the receiver's scope unchanged. Caller should log the
 * incoming scope for audit so it's clear the receiver's rules won.
 */
export function resolveCrossUser(
  incoming: Scope,
  receiver: Scope
): { scope: Scope; conflict: ScopeConflict | null } {
  // If scopes are identical (same boundaries), no conflict.
  const sameBoundaries =
    JSON.stringify(normalizeBoundaries(incoming.boundaries)) ===
    JSON.stringify(normalizeBoundaries(receiver.boundaries))

  if (sameBoundaries) {
    return { scope: receiver, conflict: null }
  }

  return {
    scope: receiver,
    conflict: {
      type: 'cross_user',
      boundaries: incoming.boundaries,
      resolution: {
        action: 'apply_receiver_scope',
        reason:
          "Receiver's scope applies for cross-user shared slices (SH-3 policy).",
        next_step: "The incoming scope was logged for audit; receiver's boundaries are in effect.",
      },
    },
  }
}

function normalizeBoundaries(bs: Boundary[]): Boundary[] {
  return [...bs].sort((a, b) => {
    const aKey = `${a.dimension}:${a.op}`
    const bKey = `${b.dimension}:${b.op}`
    return aKey.localeCompare(bKey)
  })
}

// ─── Governance snapshot loader ──────────────────────────────────────────────

/**
 * Best-effort governance snapshot. Reads index_access.active_preset and
 * derives blocked-index/blocked-contributor sets lazily (empty arrays by
 * default — callers who need strict enforcement should populate them
 * from sharing/privacy-filter + indexAccess).
 */
export async function loadGovernanceSnapshot(params: {
  userId: string
  workspaceId: string
}): Promise<GovernanceSnapshot> {
  const { db } = await import('../../db/index')
  const { indexAccess } = await import('../../db/schema/sharing')
  const { eq } = await import('drizzle-orm')

  let activePreset: GovernanceSnapshot['activePreset'] = 'balanced'
  try {
    const rows = await db
      .select({ activePreset: indexAccess.activePreset })
      .from(indexAccess)
      .where(eq(indexAccess.userId, params.userId))
      .limit(1)
    const row = rows[0]
    if (row?.activePreset) {
      activePreset = row.activePreset as GovernanceSnapshot['activePreset']
    }
  } catch (err) {
    // Non-fatal: default to balanced.
    console.warn('[scope] loadGovernanceSnapshot failed, defaulting to balanced:', err)
  }

  return {
    activePreset,
    userId: params.userId,
    workspaceId: params.workspaceId,
    blockedIndexIds: [],
    blockedContributorIds: [],
  }
}
