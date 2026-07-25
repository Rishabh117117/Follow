import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index'
import { webhooks, apiKeys } from '../db/schema/collaboration'
import { authMiddleware } from '../middleware/auth'
import { assertWorkspaceAccess } from '../services/workspace-access'
import { createHmac, randomBytes } from 'crypto'
import { nanoid } from 'nanoid'

const app = new Hono()

app.use('*', authMiddleware)

// ─── List webhooks ───────────────────────────────────────────────────
app.get('/', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const results = await db.select().from(webhooks).where(eq(webhooks.workspaceId, workspaceId!))

  // Don't expose secrets
  return c.json({
    data: results.map((w) => ({ ...w, secret: '****' })),
    error: null,
  })
})

// ─── Create webhook ──────────────────────────────────────────────────
app.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{
    workspaceId: string
    url: string
    events: string[]
  }>()

  if (!body.workspaceId || !body.url || !body.events?.length) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId, url, events required' } },
      400
    )
  }

  const denied = await assertWorkspaceAccess(c, body.workspaceId)
  if (denied) return denied

  const secret = randomBytes(32).toString('hex')

  const [webhook] = await db
    .insert(webhooks)
    .values({
      workspaceId: body.workspaceId,
      url: body.url,
      events: body.events,
      secret,
      createdBy: userId,
    })
    .returning()

  return c.json({ data: { ...webhook, secret }, error: null }, 201)
})

// ─── Update webhook ──────────────────────────────────────────────────
app.patch('/:id', async (c) => {
  const body = await c.req.json<{
    url?: string
    events?: string[]
    active?: boolean
  }>()

  const [existing] = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, c.req.param('id')))
  if (!existing) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Webhook not found' } }, 404)
  }

  const denied = await assertWorkspaceAccess(c, existing.workspaceId)
  if (denied) return denied

  const [updated] = await db
    .update(webhooks)
    .set({
      url: body.url ?? existing.url,
      events: body.events ?? existing.events,
      active: body.active ?? existing.active,
    })
    .where(eq(webhooks.id, existing.id))
    .returning()

  return c.json({ data: { ...updated, secret: '****' }, error: null })
})

// ─── Delete webhook ──────────────────────────────────────────────────
app.delete('/:id', async (c) => {
  const [existing] = await db
    .select({ workspaceId: webhooks.workspaceId })
    .from(webhooks)
    .where(eq(webhooks.id, c.req.param('id')))
  if (!existing) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Webhook not found' } }, 404)
  }

  const denied = await assertWorkspaceAccess(c, existing.workspaceId)
  if (denied) return denied

  await db.delete(webhooks).where(eq(webhooks.id, c.req.param('id')))
  return c.json({ data: { success: true }, error: null })
})

// ─── API Keys ────────────────────────────────────────────────────────

// List API keys
app.get('/api-keys', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const results = await db.select().from(apiKeys).where(eq(apiKeys.workspaceId, workspaceId!))

  return c.json({
    data: results.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      permissions: k.permissions,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt,
    })),
    error: null,
  })
})

// Create API key
app.post('/api-keys', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{
    workspaceId: string
    name: string
    permissions?: string[]
  }>()

  if (!body.workspaceId || !body.name) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'workspaceId and name required' } },
      400
    )
  }

  // Minting a wsp_ key grants its holder access to the workspace — the caller
  // must belong to it.
  const denied = await assertWorkspaceAccess(c, body.workspaceId)
  if (denied) return denied

  const rawKey = `wsp_${nanoid(40)}`
  const keyHash = createHmac('sha256', 'workspace-api-keys').update(rawKey).digest('hex')
  const keyPrefix = rawKey.slice(0, 12)

  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      workspaceId: body.workspaceId,
      name: body.name,
      keyHash,
      keyPrefix,
      permissions: body.permissions ?? ['read'],
      createdBy: userId,
    })
    .returning()

  if (!apiKey) {
    return c.json(
      { data: null, error: { code: 'INTERNAL', message: 'Failed to create API key' } },
      500
    )
  }

  // Return the raw key only once
  return c.json(
    {
      data: {
        id: apiKey.id,
        name: apiKey.name,
        key: rawKey,
        keyPrefix,
        permissions: apiKey.permissions,
        createdAt: apiKey.createdAt,
      },
      error: null,
    },
    201
  )
})

// Delete API key
app.delete('/api-keys/:id', async (c) => {
  const [existing] = await db
    .select({ workspaceId: apiKeys.workspaceId })
    .from(apiKeys)
    .where(eq(apiKeys.id, c.req.param('id')))
  if (!existing) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404)
  }

  const denied = await assertWorkspaceAccess(c, existing.workspaceId)
  if (denied) return denied

  await db.delete(apiKeys).where(eq(apiKeys.id, c.req.param('id')))
  return c.json({ data: { success: true }, error: null })
})

export const webhooksRouter = app

// ─── Webhook Delivery Utility ────────────────────────────────────────

export async function deliverWebhook(
  workspaceId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  const activeWebhooks = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.active, true)))

  for (const webhook of activeWebhooks) {
    if (!webhook.events.includes(eventType) && !webhook.events.includes('*')) continue

    const body = JSON.stringify({
      type: eventType,
      timestamp: new Date().toISOString(),
      workspaceId,
      payload,
    })

    const signature = createHmac('sha256', webhook.secret).update(body).digest('hex')

    // Fire and forget with retry
    deliverWithRetry(webhook.url, body, signature, 3).catch((err) => {
      console.error(`[Webhook] Delivery failed for ${webhook.id}:`, err)
    })
  }
}

async function deliverWithRetry(
  url: string,
  body: string,
  signature: string,
  retries: number,
  attempt = 1
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok && attempt < retries) {
      const backoff = Math.pow(2, attempt) * 1000
      await new Promise((resolve) => setTimeout(resolve, backoff))
      return deliverWithRetry(url, body, signature, retries, attempt + 1)
    }
  } catch {
    if (attempt < retries) {
      const backoff = Math.pow(2, attempt) * 1000
      await new Promise((resolve) => setTimeout(resolve, backoff))
      return deliverWithRetry(url, body, signature, retries, attempt + 1)
    }
  }
}
