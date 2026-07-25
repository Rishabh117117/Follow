/**
 * Discover Governance (Sprint V41-DISCOVER-1)
 *
 * Encapsulates the rules that decide whether a candidate index is
 * eligible to appear in a requestor's Discover results.
 *
 * Invariants enforced here:
 *   1. Opt-in required: `spaces.discoverable = true`. Default is false;
 *      never infer opt-in.
 *   2. Scope walls:
 *        - `discoverableScope = 'workspace'` → only same-workspace requestor
 *        - `discoverableScope = 'org'` → same org (workspace membership chain)
 *        - `discoverableScope = 'public'` → all workspaces
 *   3. Personal indexes are always non-discoverable (there is no row in
 *      `spaces` for them, so the opt-in gate is physically absent).
 *   4. The requestor must be authenticated — the route/MCP layer has
 *      already enforced this; we don't re-verify here.
 *
 * NOTE: the workspaceMembers check is best-effort — if the table lookup
 * fails, we FAIL CLOSED (disallow) rather than silently expose data.
 */

import { and, eq } from 'drizzle-orm'
import { db } from '../../db/index'
import { spaces } from '../../db/schema/spaces'
import { workspaceMembers } from '../../db/schema/workspaces'
import type { DiscoverConflict } from './types'

export interface DiscoverAllowResult {
  allowed: boolean
  reason?: string
  conflict?: DiscoverConflict
}

export async function checkDiscoverableAllowed(params: {
  candidateIndexId: string
  requestorId: string
  requestorWorkspaceId: string
}): Promise<DiscoverAllowResult> {
  try {
    const rows = await db
      .select({
        id: spaces.id,
        ownerId: spaces.createdBy,
        workspaceId: spaces.workspaceId,
        discoverable: spaces.discoverable,
        discoverableScope: spaces.discoverableScope,
      })
      .from(spaces)
      .where(eq(spaces.id, params.candidateIndexId))
      .limit(1)

    const cand = rows[0]
    if (!cand) {
      return {
        allowed: false,
        reason: 'Candidate index not found.',
        conflict: {
          type: 'requestor_ineligible',
          indexId: params.candidateIndexId,
          reason: 'Candidate index not found or inaccessible.',
        },
      }
    }

    // Opt-in gate.
    if (!cand.discoverable) {
      return {
        allowed: false,
        reason: 'Index is not discoverable (owner has not opted in).',
        conflict: {
          type: 'owner_optout',
          indexId: params.candidateIndexId,
          reason: 'Owner has not marked this index as discoverable.',
          next_step: 'Owner can enable discovery in the index settings.',
        },
      }
    }

    // Requestor is the owner — always allowed (they can self-discover).
    if (cand.ownerId === params.requestorId) return { allowed: true }

    // Same workspace as requestor — always allowed when discoverable.
    if (cand.workspaceId === params.requestorWorkspaceId) return { allowed: true }

    const scope = cand.discoverableScope ?? 'workspace'

    if (scope === 'workspace') {
      return {
        allowed: false,
        reason: 'Discoverable only within the owner workspace.',
        conflict: {
          type: 'workspace_policy',
          indexId: params.candidateIndexId,
          reason: 'Owner restricted discoverability to their workspace only.',
        },
      }
    }

    if (scope === 'public') return { allowed: true }

    if (scope === 'org') {
      // Org-scope: requestor must share a workspace-members chain with the
      // owner's workspace. Minimal MVP: if the requestor is a member of the
      // candidate's workspace at any level, allow. Anything else — fail closed.
      const membership = await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, cand.workspaceId),
            eq(workspaceMembers.userId, params.requestorId)
          )
        )
        .limit(1)
      if (membership.length > 0) return { allowed: true }
      return {
        allowed: false,
        reason: 'Org-scope requires workspace membership.',
        conflict: {
          type: 'workspace_policy',
          indexId: params.candidateIndexId,
          reason:
            'Owner opted into org-wide discovery but requestor is not a member of the owner workspace.',
        },
      }
    }

    // Unknown scope — fail closed.
    return {
      allowed: false,
      reason: `Unknown discoverable scope '${scope}'. Failing closed.`,
      conflict: {
        type: 'workspace_policy',
        indexId: params.candidateIndexId,
        reason: `Unrecognized discoverable scope '${scope}'. Failing closed for safety.`,
      },
    }
  } catch (err) {
    console.warn('[discover.governance] check failed, failing closed:', err)
    return {
      allowed: false,
      reason: 'Governance check failed; failing closed.',
      conflict: {
        type: 'workspace_policy',
        indexId: params.candidateIndexId,
        reason: 'Governance check errored; discover denied (fail-closed).',
      },
    }
  }
}
