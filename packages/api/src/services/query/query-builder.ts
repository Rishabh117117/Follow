/**
 * Query Builder (Sprint V41-QUERY-1)
 *
 * Composes a StructuredQuery, validates it for coherence, and serializes
 * to user-facing JSON. Reuses scope-builder for boundary validation —
 * query queries and scope filters share the same underlying constraint
 * model.
 *
 * Wegner invariant: every boundary in a query is user-decided. The AI
 * never widens a query's boundaries, never silently relaxes thresholds.
 */

import { validateScopeBoundaries } from '../scope/scope-builder'
import type { Boundary } from '../scope/types'
import type {
  Aggregation,
  QueryValidationError,
  SelectField,
  SelectSpec,
  StructuredQuery,
} from './types'

export interface BuildQueryParams {
  userId: string
  workspaceId: string
  boundaries: Boundary[]
  select: SelectSpec
  aggregations?: Aggregation[]
  name?: string
  description?: string
}

const VALID_FIELDS: SelectField[] = [
  'id',
  'content',
  'contributor',
  'confidence',
  'createdAt',
  'sourceTool',
  'edgeType',
  'supersedes',
  'topic',
]

const VALID_GROUP_BY_FIELDS = new Set<string>([
  'contributor',
  'sourceTool',
  'edgeType',
  'topic',
])

const MAX_LIMIT = 1000
const DEFAULT_LIMIT = 100

export function buildStructuredQuery(params: BuildQueryParams): StructuredQuery {
  const validation = validateStructuredQuery({
    boundaries: params.boundaries,
    select: params.select,
    aggregations: params.aggregations,
  })
  if (!validation.valid) {
    const details = validation.errors.map((e) => `${e.field}: ${e.reason}`).join('; ')
    throw new Error(`Invalid structured query: ${details}`)
  }

  const now = new Date()
  const ts =
    `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}_${String(
      now.getDate()
    ).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}_${String(
      now.getMinutes()
    ).padStart(2, '0')}`

  const slug = (params.name ?? 'query')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 40) || 'query'

  return {
    query_id: `${slug}_${ts}`,
    name: params.name,
    description: params.description,
    boundaries: params.boundaries,
    select: normalizeSelect(params.select),
    aggregations: params.aggregations,
    createdAt: now,
    createdBy: params.userId,
    workspaceId: params.workspaceId,
  }
}

function normalizeSelect(s: SelectSpec): SelectSpec {
  return {
    fields: s.fields.length > 0 ? s.fields : ['id', 'content', 'contributor', 'confidence', 'createdAt'],
    limit: Math.min(s.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
    offset: Math.max(s.offset ?? 0, 0),
    orderBy: s.orderBy ?? { field: 'createdAt', direction: 'desc' },
    groupBy: s.groupBy,
  }
}

export interface ValidateInput {
  boundaries: Boundary[]
  select: SelectSpec
  aggregations?: Aggregation[]
}

export interface ValidationResult {
  valid: boolean
  errors: QueryValidationError[]
}

export function validateStructuredQuery(input: ValidateInput): ValidationResult {
  const errors: QueryValidationError[] = []

  // Boundary coherence (reuse scope validator).
  const boundaryCheck = validateScopeBoundaries(input.boundaries)
  for (const c of boundaryCheck.conflicts) {
    errors.push({ field: 'boundaries', reason: c.resolution.reason })
  }

  // Select.fields must be non-empty and contain only valid entries.
  if (!input.select.fields || input.select.fields.length === 0) {
    errors.push({ field: 'select.fields', reason: 'At least one field is required.' })
  } else {
    for (const f of input.select.fields) {
      if (!VALID_FIELDS.includes(f)) {
        errors.push({ field: 'select.fields', reason: `Unknown field '${f}'.` })
      }
    }
  }

  // Limit bounds.
  if (input.select.limit !== undefined) {
    if (input.select.limit < 1 || input.select.limit > MAX_LIMIT) {
      errors.push({
        field: 'select.limit',
        reason: `Limit must be within [1, ${MAX_LIMIT}].`,
      })
    }
  }

  if (input.select.offset !== undefined && input.select.offset < 0) {
    errors.push({ field: 'select.offset', reason: 'Offset must be >= 0.' })
  }

  // groupBy must reference a known groupable field.
  if (input.select.groupBy && !VALID_GROUP_BY_FIELDS.has(input.select.groupBy)) {
    errors.push({
      field: 'select.groupBy',
      reason: `groupBy must be one of: ${[...VALID_GROUP_BY_FIELDS].join(', ')}.`,
    })
  }

  // Aggregation references a known field.
  if (input.aggregations) {
    for (const agg of input.aggregations) {
      if (agg.kind !== 'count' && !agg.field) {
        errors.push({
          field: 'aggregations',
          reason: `Aggregation kind '${agg.kind}' requires a field.`,
        })
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

export function serializeQueryToJson(q: StructuredQuery): string {
  return JSON.stringify(
    {
      query_id: q.query_id,
      name: q.name,
      description: q.description,
      boundaries: q.boundaries,
      select: q.select,
      aggregations: q.aggregations,
    },
    null,
    2
  )
}
