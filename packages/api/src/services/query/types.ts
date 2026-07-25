/**
 * Query Types (Sprint V41-QUERY-1)
 *
 * A StructuredQuery extends SCOPE-LIVECTX-1's Boundary model with a
 * `select` shape describing what fields to return, how to paginate,
 * and optional aggregations. Inspectable JSON — no black boxes.
 */

import type { Boundary, ScopeConflict } from '../scope/types'

export type SelectField =
  | 'id'
  | 'content'
  | 'contributor'
  | 'confidence'
  | 'createdAt'
  | 'sourceTool'
  | 'edgeType'
  | 'supersedes'
  | 'topic'

export interface SelectSpec {
  fields: SelectField[]
  limit?: number
  offset?: number
  orderBy?: { field: string; direction: 'asc' | 'desc' }
  groupBy?: string
}

export interface Aggregation {
  kind: 'count' | 'group_count' | 'distinct'
  field?: string
}

export interface StructuredQuery {
  query_id: string
  name?: string
  description?: string
  boundaries: Boundary[]
  select: SelectSpec
  aggregations?: Aggregation[]
  createdAt: Date
  createdBy: string
  workspaceId: string
}

export interface QueryResultFact {
  id: string
  content: string
  contributor: { id: string; name: string }
  confidence: number
  createdAt: Date
  sourceTool: string
  edgeType?: string
  supersedes?: string
  topic?: string[]
}

export interface QueryResult {
  query: StructuredQuery
  facts: QueryResultFact[]
  totalCount: number
  aggregations?: Record<string, unknown>
  conflicts: ScopeConflict[]
  truncated: boolean
  runtimeMs: number
}

export interface QueryValidationError {
  field: string
  reason: string
}
