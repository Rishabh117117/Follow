/**
 * Queries Routes (Sprint V41-QUERY-1)
 *
 * HTTP counterpart to the `query_index` structured mode. Backs the
 * Query Composer panel on the web.
 *
 * 8 endpoints:
 *   POST   /run            — ad-hoc structured run (no save)
 *   POST   /parse          — NL → StructuredQuery (pre-run)
 *   POST   /               — save a named query
 *   GET    /               — list saved queries
 *   GET    /:id            — get one
 *   POST   /:id/run        — run a saved query, bump lastRunAt + runCount
 *   PATCH  /:id            — rename, toggle pin, update boundaries/select
 *   DELETE /:id            — hard delete (rows are cheap; soft would complicate the UI)
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../db/index'
import { savedQueries } from '../db/schema/query'
import { authMiddleware } from '../middleware/auth'
import {
  buildStructuredQuery,
  parseQueryFromNL,
  runStructuredQuery,
  type Aggregation,
  type SelectSpec,
} from '../services/query'
import {
  getActiveScope,
  resolveEffectiveBoundaries,
  type Boundary,
} from '../services/scope'

export const queriesRouter = new Hono()
queriesRouter.use('*', authMiddleware)

// ─── Zod ────────────────────────────────────────────────────────────────────

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

const selectSpecSchema = z.object({
  fields: z.array(
    z.enum([
      'id',
      'content',
      'contributor',
      'confidence',
      'createdAt',
      'sourceTool',
      'edgeType',
      'supersedes',
      'topic',
    ])
  ),
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional(),
  orderBy: z
    .object({ field: z.string(), direction: z.enum(['asc', 'desc']) })
    .optional(),
  groupBy: z.string().optional(),
})

const aggregationSchema = z.object({
  kind: z.enum(['count', 'group_count', 'distinct']),
  field: z.string().optional(),
})

const structuredInputSchema = z.object({
  boundaries: z.array(boundarySchema),
  select: selectSpecSchema,
  aggregations: z.array(aggregationSchema).optional(),
  name: z.string().optional(),
})

const runBodySchema = z.object({
  structured: structuredInputSchema,
})

const parseBodySchema = z.object({
  nl: z.string().min(1),
})

const saveBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  structured: structuredInputSchema,
})

const patchBodySchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  isPinned: z.boolean().optional(),
  structured: structuredInputSchema.partial().optional(),
})

function sessionTokenFor(userId: string, workspaceId: string | undefined): string {
  return `mcp:${userId}:${workspaceId ?? 'default'}`
}

async function runWithGovernance(
  userId: string,
  workspaceId: string,
  sessionToken: string,
  input: {
    boundaries: Boundary[]
    select: SelectSpec
    aggregations?: Aggregation[]
    name?: string
  }
) {
  const resolved = await resolveEffectiveBoundaries({
    userId,
    workspaceId,
    sessionToken,
    explicitBoundaries: input.boundaries,
  })

  const q = buildStructuredQuery({
    userId,
    workspaceId,
    boundaries: resolved.boundaries,
    select: input.select,
    aggregations: input.aggregations,
    name: input.name,
  })

  return runStructuredQuery(q, { conflicts: resolved.conflicts })
}

// ─── POST /api/queries/run — ad-hoc ─────────────────────────────────────────

queriesRouter.post('/run', zValidator('json', runBodySchema), async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const sessionToken = sessionTokenFor(userId, workspaceId)
  const body = c.req.valid('json')
  const result = await runWithGovernance(userId, workspaceId, sessionToken, body.structured)
  return c.json({ data: { result }, error: null })
})

// ─── POST /api/queries/parse — NL → StructuredQuery ─────────────────────────

queriesRouter.post('/parse', zValidator('json', parseBodySchema), async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const sessionToken = sessionTokenFor(userId, workspaceId)
  const body = c.req.valid('json')

  const activeScope = await getActiveScope(sessionToken, userId)
  const parsed = await parseQueryFromNL({
    text: body.nl,
    userId,
    workspaceId,
    activeScope: activeScope ?? undefined,
  })

  return c.json({
    data: { query: parsed.query, warnings: parsed.warnings },
    error: null,
  })
})

// ─── POST /api/queries — save ───────────────────────────────────────────────

queriesRouter.post('/', zValidator('json', saveBodySchema), async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const body = c.req.valid('json')

  const rows = await db
    .insert(savedQueries)
    .values({
      userId,
      workspaceId,
      name: body.name,
      description: body.description ?? null,
      boundaries: body.structured.boundaries,
      selectSpec: body.structured.select,
      aggregations: body.structured.aggregations ?? null,
      isPinned: false,
    })
    .returning({ id: savedQueries.id })

  const first = rows[0]
  if (!first) {
    return c.json(
      { data: null, error: { code: 'INTERNAL', message: 'Insert returned no row' } },
      500
    )
  }
  return c.json({ data: { id: first.id }, error: null })
})

// ─── GET /api/queries — list ────────────────────────────────────────────────

queriesRouter.get('/', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const rows = await db
    .select()
    .from(savedQueries)
    .where(
      and(eq(savedQueries.userId, userId), eq(savedQueries.workspaceId, workspaceId))
    )
    .orderBy(desc(savedQueries.isPinned), desc(savedQueries.updatedAt))
  return c.json({ data: { queries: rows }, error: null })
})

// ─── GET /api/queries/:id ──────────────────────────────────────────────────

queriesRouter.get('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const rows = await db
    .select()
    .from(savedQueries)
    .where(and(eq(savedQueries.id, id), eq(savedQueries.userId, userId)))
    .limit(1)
  const row = rows[0]
  if (!row) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Query not found' } }, 404)
  }
  return c.json({ data: { query: row }, error: null })
})

// ─── POST /api/queries/:id/run — re-run saved ───────────────────────────────

queriesRouter.post('/:id/run', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.get('workspaceId') ?? 'default'
  const sessionToken = sessionTokenFor(userId, workspaceId)
  const id = c.req.param('id')

  const rows = await db
    .select()
    .from(savedQueries)
    .where(and(eq(savedQueries.id, id), eq(savedQueries.userId, userId)))
    .limit(1)
  const row = rows[0]
  if (!row) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Query not found' } }, 404)
  }

  const result = await runWithGovernance(userId, workspaceId, sessionToken, {
    boundaries: (row.boundaries as Boundary[]) ?? [],
    select: row.selectSpec as SelectSpec,
    aggregations: (row.aggregations as Aggregation[]) ?? undefined,
    name: row.name,
  })

  await db
    .update(savedQueries)
    .set({
      lastRunAt: new Date(),
      runCount: sql`${savedQueries.runCount} + 1`,
    })
    .where(eq(savedQueries.id, id))

  return c.json({ data: { result }, error: null })
})

// ─── PATCH /api/queries/:id — rename, pin, update ───────────────────────────

queriesRouter.patch('/:id', zValidator('json', patchBodySchema), async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined) updates.name = body.name
  if (body.description !== undefined) updates.description = body.description
  if (body.isPinned !== undefined) updates.isPinned = body.isPinned
  if (body.structured?.boundaries) updates.boundaries = body.structured.boundaries
  if (body.structured?.select) updates.selectSpec = body.structured.select
  if (body.structured?.aggregations !== undefined)
    updates.aggregations = body.structured.aggregations ?? null

  await db
    .update(savedQueries)
    .set(updates)
    .where(and(eq(savedQueries.id, id), eq(savedQueries.userId, userId)))

  return c.json({ data: { id }, error: null })
})

// ─── DELETE /api/queries/:id — hard delete ──────────────────────────────────

queriesRouter.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  await db
    .delete(savedQueries)
    .where(and(eq(savedQueries.id, id), eq(savedQueries.userId, userId)))
  return c.json({ data: { deleted: true }, error: null })
})
