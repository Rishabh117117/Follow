/**
 * Scope Routes (Sprint SCOPE-LIVECTX-1)
 *
 * HTTP counterpart to the `scope_configure` MCP tool. Frontend uses this
 * to drive the Scope Builder panel + Live Context block.
 *
 * Wegner invariant: every mutation here is user-initiated. The AI side
 * (MCP tool) is subject to the same rule.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../db/index'
import { scopeSessions } from '../db/schema/scope'
import { authMiddleware } from '../middleware/auth'
import {
  buildScopeFromBoundaries,
  validateScopeBoundaries,
  resolveAgainstGovernance,
  loadGovernanceSnapshot,
  getActiveScope,
  setActiveScope,
  pauseActiveScope,
  resumeActiveScope,
  endActiveScope,
  listUserPresets,
  savePreset,
  getPresetById,
  applyPostFilters,
  parseScopeFromNL,
  type Boundary,
} from '../services/scope'
import {
  activateLiveContext,
  pauseLiveContext,
  resumeLiveContext,
  endLiveContext,
  getLiveContextSlice,
} from '../services/live-context'

export const scopeRouter = new Hono()
scopeRouter.use('*', authMiddleware)

// ─── Validators ──────────────────────────────────────────────────────────────

const boundarySchema = z.object({
  dimension: z.enum([
    'index',
    'contributor',
    'confidence',
    'time',
    'topic',
    'edge_type',
    'privacy',
    'freshness',
    'source_tool',
    'provenance',
    'custom',
  ]),
  op: z.enum(['include', 'exclude', 'gte', 'lte', 'within', 'not_within', 'matches']),
  value: z.unknown().optional(),
  values: z.array(z.unknown()).optional(),
  window: z
    .object({
      type: z.enum(['relative', 'absolute']),
      days: z.number().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  rule: z.record(z.unknown()).optional(),
})

const setScopeSchema = z.object({
  action: z.enum(['set', 'adjust']).default('set'),
  boundaries: z.array(boundarySchema).optional(),
  presetId: z.string().uuid().optional(),
  presetName: z.string().optional(),
  mode: z.enum(['live', 'static']).default('static'),
})

const validateSchema = z.object({
  boundaries: z.array(boundarySchema),
})

// Token derivation: one active scope per (user, workspace). Frontend and
// MCP share the same token scheme so scope set from the web flows to MCP.
function sessionTokenFor(userId: string, workspaceId: string | undefined): string {
  return `mcp:${userId}:${workspaceId ?? 'default'}`
}

// ─── POST /api/scope — set or adjust the active scope ────────────────────────

scopeRouter.post('/', zValidator('json', setScopeSchema), async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const body = c.req.valid('json')
  const sessionToken = sessionTokenFor(userId, workspaceId)

  let effective: Boundary[] = body.boundaries ?? []
  let scopeDefinitionId: string | undefined
  let name: string | undefined

  if (body.presetId) {
    const preset = await getPresetById(body.presetId)
    if (!preset) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Preset not found' } },
        404
      )
    }
    effective = preset.boundaries
    scopeDefinitionId = body.presetId
    name = preset.name
  }

  if (body.action === 'adjust') {
    const current = await getActiveScope(sessionToken, userId)
    const keyOf = (b: Boundary) => `${b.dimension}:${b.op}:${b.name ?? ''}`
    const merged = new Map<string, Boundary>()
    for (const b of current?.boundaries ?? []) merged.set(keyOf(b), b)
    for (const b of effective) merged.set(keyOf(b), b)
    effective = [...merged.values()]
  }

  const validation = validateScopeBoundaries(effective)
  if (!validation.valid) {
    return c.json({
      data: { scope: null, conflicts: validation.conflicts, valid: false },
      error: null,
    })
  }

  const scope = buildScopeFromBoundaries({
    userId,
    workspaceId,
    boundaries: effective,
    name,
    mode: body.mode,
  })

  const governance = await loadGovernanceSnapshot({ userId, workspaceId })
  const resolved = resolveAgainstGovernance(scope, governance)

  await setActiveScope(sessionToken, resolved.scope, { scopeDefinitionId })

  if (body.mode === 'live') {
    try {
      await activateLiveContext({
        scope: resolved.scope,
        sessionToken,
        userId,
        workspaceId,
      })
    } catch (err) {
      // Non-blocking — log and continue.
      console.warn('[scope] live activation failed:', err)
    }
  }

  return c.json({
    data: { scope: resolved.scope, conflicts: resolved.conflicts, valid: true },
    error: null,
  })
})

// ─── GET /api/scope/active ──────────────────────────────────────────────────

scopeRouter.get('/active', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const sessionToken = sessionTokenFor(userId, workspaceId)

  const scope = await getActiveScope(sessionToken, userId)

  // Also read lifecycle state (paused/ended) for the badge.
  const rows = await db
    .select({
      paused: scopeSessions.paused,
      endedAt: scopeSessions.endedAt,
      mode: scopeSessions.mode,
    })
    .from(scopeSessions)
    .where(
      and(
        eq(scopeSessions.sessionToken, sessionToken),
        eq(scopeSessions.userId, userId)
      )
    )
    .orderBy(desc(scopeSessions.activatedAt))
    .limit(1)
  const row = rows[0]

  return c.json({
    data: {
      scope,
      lifecycle: {
        active: !!scope,
        paused: row?.paused ?? false,
        ended: !!row?.endedAt,
        mode: row?.mode ?? 'static',
      },
    },
    error: null,
  })
})

// ─── GET /api/scope/presets ─────────────────────────────────────────────────

scopeRouter.get('/presets', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const presets = await listUserPresets(userId, workspaceId)
  return c.json({ data: { presets }, error: null })
})

// ─── POST /api/scope/presets — save a preset ────────────────────────────────

const savePresetSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  boundaries: z.array(boundarySchema),
})

scopeRouter.post('/presets', zValidator('json', savePresetSchema), async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const body = c.req.valid('json')
  const id = await savePreset({ userId, workspaceId, ...body })
  return c.json({ data: { id }, error: null })
})

// ─── POST /api/scope/presets/:id/apply — activate a preset ──────────────────

scopeRouter.post('/presets/:id/apply', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const id = c.req.param('id')
  const sessionToken = sessionTokenFor(userId, workspaceId)

  const preset = await getPresetById(id)
  if (!preset) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Preset not found' } },
      404
    )
  }

  const scope = buildScopeFromBoundaries({
    userId,
    workspaceId,
    boundaries: preset.boundaries,
    name: preset.name,
  })
  const governance = await loadGovernanceSnapshot({ userId, workspaceId })
  const resolved = resolveAgainstGovernance(scope, governance)

  await setActiveScope(sessionToken, resolved.scope, { scopeDefinitionId: id })

  return c.json({
    data: { scope: resolved.scope, conflicts: resolved.conflicts },
    error: null,
  })
})

// ─── Lifecycle: pause / resume / end ────────────────────────────────────────

scopeRouter.post('/pause', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const sessionToken = sessionTokenFor(userId, workspaceId)
  await pauseActiveScope(sessionToken)
  await pauseLiveContext({ userId, sessionToken }).catch(() => {})
  return c.json({ data: { paused: true }, error: null })
})

scopeRouter.post('/resume', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const sessionToken = sessionTokenFor(userId, workspaceId)
  await resumeActiveScope(sessionToken)
  await resumeLiveContext({ userId, sessionToken }).catch(() => {})
  return c.json({ data: { paused: false }, error: null })
})

scopeRouter.post('/end', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const sessionToken = sessionTokenFor(userId, workspaceId)
  await endActiveScope(sessionToken)
  await endLiveContext({ userId, sessionToken }).catch(() => {})
  return c.json({ data: { ended: true }, error: null })
})

// ─── POST /api/scope/validate — dry-run boundary check ──────────────────────

scopeRouter.post('/validate', zValidator('json', validateSchema), async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const body = c.req.valid('json')

  const intraValidation = validateScopeBoundaries(body.boundaries)
  const scope = buildScopeFromBoundaries({
    userId,
    workspaceId,
    boundaries: body.boundaries,
  })
  const governance = await loadGovernanceSnapshot({ userId, workspaceId })
  const govResult = resolveAgainstGovernance(scope, governance)

  const allConflicts = [...intraValidation.conflicts, ...govResult.conflicts]
  const estimated = await estimateFactCount(userId, workspaceId, govResult.scope.boundaries)

  return c.json({
    data: {
      valid: intraValidation.valid,
      conflicts: allConflicts,
      estimatedFactCount: estimated,
    },
    error: null,
  })
})

// ─── GET /api/scope/preview — live fact-count ───────────────────────────────

scopeRouter.get('/preview', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const raw = c.req.query('boundaries') ?? '[]'
  let boundaries: Boundary[]
  try {
    boundaries = z.array(boundarySchema).parse(JSON.parse(raw)) as Boundary[]
  } catch {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'Invalid boundaries query param' } },
      400
    )
  }
  const count = await estimateFactCount(userId, workspaceId, boundaries)
  return c.json({ data: { estimatedFactCount: count }, error: null })
})

// ─── GET /api/scope/live-slice — current live context slice body ────────────

scopeRouter.get('/live-slice', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const sessionToken = sessionTokenFor(userId, workspaceId)
  const slice = await getLiveContextSlice({ userId, sessionToken })
  return c.json({ data: { slice }, error: null })
})

// ─── POST /api/scope/parse-nl — natural-language → boundaries ────────────────
// Wraps parseScopeFromNL() so the dashboard's NL textarea can hand a free-form
// prompt to the MICRO_MODEL and receive a typed boundary array back. The route
// only parses; the caller decides whether to POST /api/scope to persist.

const parseNlSchema = z.object({
  text: z.string().min(1).max(2000),
})

scopeRouter.post('/parse-nl', zValidator('json', parseNlSchema), async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const { text } = c.req.valid('json')

  const result = await parseScopeFromNL({ text, userId, workspaceId })

  return c.json({
    data: {
      boundaries: result.scope.boundaries,
      warning: result.warning ?? null,
    },
    error: null,
  })
})

// ─── Helpers ────────────────────────────────────────────────────────────────

async function estimateFactCount(
  userId: string,
  workspaceId: string,
  boundaries: Boundary[]
): Promise<number> {
  // Light estimate: count index_records in workspace, then apply post-filters
  // on a sampled projection. Exact count would require running the full
  // retrieval pipeline; this is a cheap heuristic suitable for live preview.
  try {
    const { indexRecords } = await import('../db/schema/semantic-index')
    const rows = await db
      .select({
        id: indexRecords.id,
        indexedAt: indexRecords.indexedAt,
      })
      .from(indexRecords)
      .where(eq(indexRecords.workspaceId, workspaceId))
      .limit(500)

    // Map to Filterable shape for applyPostFilters.
    const filterable = rows.map((r) => ({
      score: 1,
      createdAt: r.indexedAt,
    }))
    const filtered = applyPostFilters(filterable, boundaries)
    // Scale estimate: if we hit 500 cap, multiply by proportion.
    if (rows.length < 500) return filtered.length
    return Math.round((filtered.length / rows.length) * 500)
  } catch (err) {
    console.warn('[scope] estimateFactCount failed:', err)
    return 0
  }
}
