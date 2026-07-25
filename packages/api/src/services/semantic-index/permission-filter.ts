/**
 * Permission Filter (Sprint IX-1)
 *
 * Enforces strand/workspace-level permissions on index query results.
 * Three permission tiers: full, fact_only, hidden.
 */

import type { ScoredResult } from './weighted-referencing'

// ─── Types ───────────────────────────────────────────────────────────────────

export type PermissionLevel = 'full' | 'fact_only' | 'hidden'

export interface PermissionContext {
  requestingUserId: string
  strandVisibility?: {
    canSeeUserThread: boolean
    canSeeAiThread: boolean
    canSeeDocThreads: boolean
    canSeeBrowserThread: boolean
  }
}

export interface PermittedResult extends ScoredResult {
  permissionLevel: PermissionLevel
}

// ─── Filter ──────────────────────────────────────────────────────────────────

/**
 * Determine the permission level for a single result.
 */
export function getPermissionLevel(
  result: ScoredResult,
  permissions: PermissionContext
): PermissionLevel {
  // Own events are always fully visible
  if (result.record.userId === permissions.requestingUserId) {
    return 'full'
  }

  const vis = permissions.strandVisibility

  // If no strand visibility context, default to doc threads visible only
  if (!vis) {
    switch (result.record.threadType) {
      case 'doc':
        return 'full'
      case 'ai':
        return 'fact_only'
      case 'browser':
        return 'fact_only'
      case 'user':
        return 'hidden'
      case 'import':
        return 'full'
      default:
        return 'fact_only'
    }
  }

  switch (result.record.threadType) {
    case 'doc':
      return vis.canSeeDocThreads ? 'full' : 'hidden'
    case 'ai':
      return vis.canSeeAiThread ? 'full' : 'fact_only'
    case 'browser':
      return vis.canSeeBrowserThread ? 'full' : 'fact_only'
    case 'user':
      return vis.canSeeUserThread ? 'full' : 'hidden'
    case 'import':
      return 'full'
    default:
      return 'fact_only'
  }
}

/**
 * Apply permissions to scored results. Removes hidden results,
 * redacts fact_only results (strips chat transcripts, source URLs).
 */
export function applyPermissions(
  results: ScoredResult[],
  permissions: PermissionContext
): PermittedResult[] {
  const permitted: PermittedResult[] = []

  for (const result of results) {
    const level = getPermissionLevel(result, permissions)

    // Hidden results are completely removed
    if (level === 'hidden') continue

    if (level === 'fact_only') {
      // Redact sensitive metadata for fact_only
      permitted.push({
        ...result,
        permissionLevel: level,
        record: {
          ...result.record,
          metadata: redactMetadata(result.record.metadata),
        },
      })
    } else {
      permitted.push({ ...result, permissionLevel: level })
    }
  }

  return permitted
}

/**
 * Redact sensitive fields from metadata for fact_only permission.
 * Preserves: type indicators, magnitude, timestamps
 * Removes: chat content, URLs, source details
 */
function redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {}
  const safeKeys = [
    'type',
    'magnitude',
    'action',
    'outcome',
    'wordDelta',
    'timeOnPage',
    'eventType',
  ]

  for (const key of safeKeys) {
    if (metadata[key] !== undefined) {
      redacted[key] = metadata[key]
    }
  }

  return redacted
}
