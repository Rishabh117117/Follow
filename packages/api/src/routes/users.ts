import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { eq, sql } from 'drizzle-orm'
import { CreateUserSchema, UpdateUserSchema } from '@workspace/shared/schemas'
import { db } from '../db/index'
import { users } from '../db/schema/index'

export const usersRouter = new Hono()

/**
 * GET / - List all users
 */
usersRouter.get('/', async (c) => {
  const allUsers = await db.select().from(users)
  return c.json({ data: allUsers, error: null })
})

/**
 * GET /stats - List users with aggregate counts (files, llm cost) for the dashboard.
 */
usersRouter.get('/stats', async (c) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        u.id,
        u.name,
        u.email,
        u.avatar_url,
        u.created_at,
        COALESCE(f.file_count, 0)::int  AS file_count,
        COALESCE(r.record_count, 0)::int AS record_count,
        COALESCE(l.cost_total, 0)::float AS cost_total,
        COALESCE(l.tokens_total, 0)::int AS tokens_total
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS file_count
        FROM raw_files
        WHERE deleted_at IS NULL
        GROUP BY user_id
      ) f ON f.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS record_count
        FROM index_records
        GROUP BY user_id
      ) r ON r.user_id = u.id
      LEFT JOIN (
        SELECT user_id,
               SUM(cost_usd) AS cost_total,
               SUM(input_tokens + output_tokens) AS tokens_total
        FROM llm_usage
        GROUP BY user_id
      ) l ON l.user_id = u.id
      ORDER BY u.created_at ASC
    `)
    // Drizzle .execute() may return either an array (pg-js) or a { rows: [] } wrapper (pglite).
    // Normalise to an array before mapping.
    const rowsArray: Array<Record<string, unknown>> = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>)
      : ((rows as { rows?: Array<Record<string, unknown>> })?.rows ?? [])
    const data = rowsArray.map((r) => ({
      id: String(r['id']),
      name: String(r['name'] ?? ''),
      email: String(r['email'] ?? ''),
      avatarUrl: r['avatar_url'] ? String(r['avatar_url']) : null,
      createdAt: r['created_at'] ? String(r['created_at']) : null,
      fileCount: Number(r['file_count'] ?? 0),
      recordCount: Number(r['record_count'] ?? 0),
      costTotal: Number(r['cost_total'] ?? 0),
      tokensTotal: Number(r['tokens_total'] ?? 0),
    }))
    return c.json({ data, error: null })
  } catch (e: unknown) {
    return c.json(
      {
        data: [],
        error: { code: 'QUERY_FAILED', message: e instanceof Error ? e.message : String(e) },
      },
      500
    )
  }
})

/**
 * GET /:id - Get a user by ID
 */
usersRouter.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [user] = await db.select().from(users).where(eq(users.id, id))

  if (!user) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } }, 404)
  }

  return c.json({ data: user, error: null })
})

/**
 * POST / - Create a new user
 */
usersRouter.post('/', zValidator('json', CreateUserSchema), async (c) => {
  const body = c.req.valid('json')

  const [created] = await db
    .insert(users)
    .values({
      email: body.email,
      name: body.name,
      avatarUrl: body.avatarUrl ?? null,
    })
    .returning()

  return c.json({ data: created, error: null }, 201)
})

/**
 * PATCH /:id - Update a user
 */
usersRouter.patch('/:id', zValidator('json', UpdateUserSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [updated] = await db.update(users).set(body).where(eq(users.id, id)).returning()

  if (!updated) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } }, 404)
  }

  return c.json({ data: updated, error: null })
})

/**
 * DELETE /:id - Delete a user
 */
usersRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')

  const [deleted] = await db.delete(users).where(eq(users.id, id)).returning()

  if (!deleted) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } }, 404)
  }

  return c.json({ data: deleted, error: null })
})
