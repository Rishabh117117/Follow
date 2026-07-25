import type { MiddlewareHandler } from 'hono'
import { eq } from 'drizzle-orm'
import { createHmac } from 'crypto'
import { db } from '../db/index'
import { apiKeys } from '../db/schema/collaboration'

/**
 * Middleware that authenticates requests using an API key.
 *
 * Accepts the key in any of:
 *   - `Authorization: Bearer wsp_...` header (preferred)
 *   - `?key=wsp_...` query string (for clients that can't set headers,
 *     e.g. claude.ai's custom-connector dialog which only takes a URL)
 *   - `?api_key=wsp_...` query string (alias)
 *
 * Sets userId (from the key creator) and workspaceId on context.
 */
export const apiKeyAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header('authorization')
  const queryKey = c.req.query('key') || c.req.query('api_key')

  let rawKey: string | null = null
  if (authHeader && authHeader.startsWith('Bearer wsp_')) {
    rawKey = authHeader.slice('Bearer '.length)
  } else if (queryKey && queryKey.startsWith('wsp_')) {
    rawKey = queryKey
  }

  if (!rawKey) {
    return c.json(
      {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Valid API key required (Bearer wsp_... or ?key=wsp_...)' },
      },
      401
    )
  }

  const keyHash = createHmac('sha256', 'workspace-api-keys').update(rawKey).digest('hex')

  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1)

  if (!key) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }, 401)
  }

  // Check expiry
  if (key.expiresAt && key.expiresAt < new Date()) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'API key expired' } }, 401)
  }

  // Update lastUsedAt (fire-and-forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .catch(() => {})

  // Set context values matching the auth middleware interface
  c.set('userId', key.createdBy)
  c.set('workspaceId', key.workspaceId)

  await next()
}

/**
 * Combined middleware: accepts either session auth (x-user-id) or API key auth.
 * Tries API key first if Authorization header starts with "Bearer wsp_",
 * otherwise falls through to the standard authMiddleware.
 */
export function createFlexAuthMiddleware(authMiddleware: MiddlewareHandler): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header('authorization')
    const queryKey = c.req.query('key') || c.req.query('api_key')

    // Route to API-key auth if a wsp_ key was provided either via header or query.
    if (
      (authHeader && authHeader.startsWith('Bearer wsp_')) ||
      (queryKey && queryKey.startsWith('wsp_'))
    ) {
      return apiKeyAuthMiddleware(c, next)
    }

    return authMiddleware(c, next)
  }
}
