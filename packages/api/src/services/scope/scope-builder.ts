/**
 * Scope Builder (Sprint SCOPE-LIVECTX-1)
 *
 * Composes Boundary[] into a usable Scope object, validates for
 * intra-scope contradictions, serializes to user-facing JSON, and
 * parses free-form NL into boundaries via OpenRouter MICRO_SUMMARY.
 *
 * Wegner invariant: every boundary must be traceable to a user decision.
 * NL parsing is only invoked when the user explicitly pastes/types intent
 * into the scope editor — never proactively by the AI.
 */

import type {
  Boundary,
  BoundaryDimension,
  Scope,
  ScopeConflict,
  ScopeMode,
} from './types'

// ─── Builder ──────────────────────────────────────────────────────────────────

export interface BuildScopeParams {
  userId: string
  workspaceId: string
  boundaries: Boundary[]
  name?: string
  mode?: ScopeMode
  persistsUntil?: Scope['persists_until']
}

export function buildScopeFromBoundaries(params: BuildScopeParams): Scope {
  const now = new Date()
  const timestamp =
    `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}_${String(
      now.getDate()
    ).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}_${String(
      now.getMinutes()
    ).padStart(2, '0')}`

  const label = params.name?.trim() || 'scope'
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)

  return {
    scope_id: `${slug || 'scope'}_${timestamp}`,
    name: label,
    mode: params.mode ?? 'static',
    persists_until: params.persistsUntil ?? 'session_end',
    boundaries: params.boundaries,
    ownerId: params.userId,
    workspaceId: params.workspaceId,
    createdAt: now,
    updatedAt: now,
  }
}

// ─── Validator ────────────────────────────────────────────────────────────────

const DIMENSIONS_REQUIRING_VALUE: BoundaryDimension[] = [
  'index',
  'contributor',
  'confidence',
  'topic',
  'edge_type',
  'privacy',
  'freshness',
  'source_tool',
  'provenance',
]

const OPS_REQUIRING_VALUE = new Set(['gte', 'lte', 'matches', 'within', 'not_within'])

export interface ValidationResult {
  valid: boolean
  conflicts: ScopeConflict[]
}

/**
 * Intra-scope validation. Catches:
 *   - missing value/values where the op requires one
 *   - custom boundaries missing `name`
 *   - mutually exclusive confidence bounds (gte > lte)
 *   - duplicate dimension with contradictory ops (include vs exclude same value)
 */
export function validateScopeBoundaries(boundaries: Boundary[]): ValidationResult {
  const conflicts: ScopeConflict[] = []

  for (const b of boundaries) {
    // Missing value/values
    const opRequiresValue =
      OPS_REQUIRING_VALUE.has(b.op) ||
      (b.op === 'include' && DIMENSIONS_REQUIRING_VALUE.includes(b.dimension)) ||
      (b.op === 'exclude' && DIMENSIONS_REQUIRING_VALUE.includes(b.dimension))

    if (opRequiresValue && b.value === undefined && (!b.values || b.values.length === 0) && !b.window) {
      conflicts.push({
        type: 'within_scope',
        boundaries: [b],
        resolution: {
          action: 'reject',
          reason: `Boundary on '${b.dimension}' with op '${b.op}' requires a value.`,
          next_step: 'Add a value or remove this boundary.',
        },
      })
    }

    // Custom missing name
    if (b.dimension === 'custom' && (!b.name || b.name.trim().length === 0)) {
      conflicts.push({
        type: 'within_scope',
        boundaries: [b],
        resolution: {
          action: 'reject',
          reason: "Custom boundary is missing required 'name'.",
          next_step: 'Provide a short name for the custom dimension.',
        },
      })
    }
  }

  // Confidence: gte > lte contradiction
  const confidences = boundaries.filter((b) => b.dimension === 'confidence')
  const gteVals = confidences
    .filter((b) => b.op === 'gte' && typeof b.value === 'number')
    .map((b) => b.value as number)
  const lteVals = confidences
    .filter((b) => b.op === 'lte' && typeof b.value === 'number')
    .map((b) => b.value as number)
  if (gteVals.length && lteVals.length) {
    const minGte = Math.min(...gteVals)
    const maxLte = Math.max(...lteVals)
    if (minGte > maxLte) {
      conflicts.push({
        type: 'within_scope',
        boundaries: confidences,
        resolution: {
          action: 'reject',
          reason: `Confidence boundaries are mutually exclusive (gte ${minGte} > lte ${maxLte}).`,
          next_step: 'Widen one of the bounds or remove one.',
        },
      })
    }
  }

  // Include vs exclude same dimension+value
  const byDim = new Map<BoundaryDimension, Boundary[]>()
  for (const b of boundaries) {
    if (!byDim.has(b.dimension)) byDim.set(b.dimension, [])
    byDim.get(b.dimension)!.push(b)
  }
  for (const [dim, bs] of byDim.entries()) {
    const includes = bs.filter((b) => b.op === 'include')
    const excludes = bs.filter((b) => b.op === 'exclude')
    if (!includes.length || !excludes.length) continue

    const incValues = new Set<string>()
    for (const b of includes) {
      if (b.value !== undefined) incValues.add(JSON.stringify(b.value))
      for (const v of b.values ?? []) incValues.add(JSON.stringify(v))
    }
    const excValues = new Set<string>()
    for (const b of excludes) {
      if (b.value !== undefined) excValues.add(JSON.stringify(b.value))
      for (const v of b.values ?? []) excValues.add(JSON.stringify(v))
    }
    const overlap = [...incValues].filter((v) => excValues.has(v))
    if (overlap.length) {
      conflicts.push({
        type: 'within_scope',
        boundaries: bs,
        resolution: {
          action: 'reject',
          reason: `Dimension '${dim}' has contradictory include/exclude on values: ${overlap.join(', ')}.`,
          next_step: 'Remove one of the conflicting values.',
        },
      })
    }
  }

  return { valid: conflicts.length === 0, conflicts }
}

// ─── Serialization ────────────────────────────────────────────────────────────

export function serializeScopeToJson(scope: Scope): string {
  return JSON.stringify(
    {
      scope_id: scope.scope_id,
      name: scope.name,
      mode: scope.mode,
      persists_until: scope.persists_until,
      boundaries: scope.boundaries,
    },
    null,
    2
  )
}

// ─── NL parsing (best-effort, non-blocking fallback) ─────────────────────────

export interface ParseScopeParams {
  text: string
  workspaceId: string
  userId: string
}

export interface ParseScopeResult {
  scope: Scope
  warning?: string
}

/**
 * Parse free-form NL into a scope.
 *
 * Strategy: try OpenRouter MICRO_SUMMARY tier to extract boundaries. If the
 * call fails for any reason (no key, rate limit, malformed response), fall
 * back to an empty "unscoped default" and surface a warning so the caller
 * can render an "AI parse failed — add boundaries manually" banner.
 *
 * The fallback path is intentional and aligned with the Wegner invariant:
 * if the AI can't translate intent, the user edits boundaries by hand
 * rather than accepting a silently-wrong scope.
 */
export async function parseScopeFromNL(
  params: ParseScopeParams
): Promise<ParseScopeResult> {
  const unscopedDefault = (warning: string): ParseScopeResult => ({
    scope: buildScopeFromBoundaries({
      userId: params.userId,
      workspaceId: params.workspaceId,
      boundaries: [],
      name: 'unscoped',
    }),
    warning,
  })

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return unscopedDefault('OPENROUTER_API_KEY not set — NL parsing disabled. Add boundaries manually.')
  }

  const systemPrompt = [
    'You convert a user request into a JSON array of Boundary objects.',
    'Each Boundary has: dimension, op, value?, values?, window?, name?, rule?.',
    'Valid dimensions: index, contributor, confidence, time, topic, edge_type, privacy, freshness, source_tool, provenance, custom.',
    'Valid ops: include, exclude, gte, lte, within, not_within, matches.',
    'Return ONLY the JSON array, no prose. Example:',
    '[{"dimension":"confidence","op":"gte","value":0.8},{"dimension":"time","op":"within","window":{"type":"relative","days":14}}]',
  ].join('\n')

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MICRO_MODEL ?? 'anthropic/claude-haiku-4-5',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: params.text },
        ],
        temperature: 0,
      }),
    })

    if (!response.ok) {
      return unscopedDefault(`OpenRouter returned ${response.status}. Add boundaries manually.`)
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = json.choices?.[0]?.message?.content?.trim() ?? ''
    const jsonStart = content.indexOf('[')
    const jsonEnd = content.lastIndexOf(']')
    if (jsonStart < 0 || jsonEnd < 0) {
      return unscopedDefault('NL parser returned non-JSON. Add boundaries manually.')
    }
    const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as Boundary[]

    return {
      scope: buildScopeFromBoundaries({
        userId: params.userId,
        workspaceId: params.workspaceId,
        boundaries: parsed,
      }),
    }
  } catch (err) {
    return unscopedDefault(
      `NL parsing failed (${(err as Error).message}). Add boundaries manually.`
    )
  }
}
