/**
 * Scope type definitions (Sprint SCOPE-LIVECTX-1)
 *
 * These types are the lingua franca between scope services, MCP tools,
 * HTTP routes, and the frontend. The wire shape is intentionally JSON-safe.
 */

export type BoundaryDimension =
  | 'index'
  | 'contributor'
  | 'confidence'
  | 'time'
  | 'topic'
  | 'edge_type'
  | 'privacy'
  | 'freshness'
  | 'source_tool'
  | 'provenance'
  | 'custom'

export type BoundaryOp =
  | 'include'
  | 'exclude'
  | 'gte'
  | 'lte'
  | 'within'
  | 'not_within'
  | 'matches'

export interface BoundaryTimeWindow {
  type: 'relative' | 'absolute'
  days?: number
  from?: string
  to?: string
}

export interface Boundary {
  dimension: BoundaryDimension
  op: BoundaryOp
  value?: unknown
  values?: unknown[]
  window?: BoundaryTimeWindow
  /** Required when dimension === 'custom'. */
  name?: string
  description?: string
  /** Custom dimension payload — free-form rule body. */
  rule?: Record<string, unknown>
}

export type ScopeMode = 'live' | 'static'

export interface Scope {
  scope_id: string
  name: string
  mode: ScopeMode
  persists_until: 'session_end' | 'manual_end' | string
  boundaries: Boundary[]
  ownerId: string
  workspaceId: string
  createdAt: Date
  updatedAt: Date
}

export type ConflictType = 'within_scope' | 'vs_governance' | 'cross_user'

export interface ScopeConflictGovernanceRef {
  rule: string
  severity: 'hard' | 'soft'
}

export interface ScopeConflictResolution {
  action: 'reject' | 'downgrade' | 'request_access' | 'apply_receiver_scope'
  reason: string
  next_step?: string
}

export interface ScopeConflict {
  type: ConflictType
  boundaries: Boundary[]
  governance?: ScopeConflictGovernanceRef
  resolution: ScopeConflictResolution
}

/** Snapshot of the governance state relevant to scope resolution. */
export interface GovernanceSnapshot {
  activePreset: 'private' | 'balanced' | 'open' | 'custom'
  userId: string
  workspaceId: string
  /** Indexes the user does NOT own or have shared access to. */
  blockedIndexIds?: string[]
  /** Contributors the user has not been granted context access to. */
  blockedContributorIds?: string[]
}
