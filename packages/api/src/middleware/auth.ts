import type { MiddlewareHandler } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db/index'
import { users } from '../db/schema/index'
import { DEV_USER, DEV_WORKSPACE } from '@workspace/shared/constants'
import { verifyApiToken } from '../lib/api-token'

// Read lazily — ESM import hoisting means module-level reads happen
// before dotenv has loaded .env.local, so we defer reading the flag.
function isDevBypass(): boolean {
  return process.env['DEV_BYPASS_AUTH'] === 'true'
}

export interface AuthUser {
  id: string
  email: string
  name: string
  avatarUrl: string | null
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
    userId: string
    workspaceId: string | undefined
  }
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const headerUserId = c.req.header('x-user-id')

  // Dev-bypass is a permissive fallback, not a hard override. If the caller
  // sent an x-user-id header (web app from NextAuth session, extension from
  // its own auth flow), honour it. Without any header, fall back to the
  // seeded DEV_USER so curl/manual tests still work.
  if (isDevBypass() && !headerUserId) {
    c.set('user', DEV_USER)
    c.set('userId', DEV_USER.id)
    c.set('workspaceId', c.req.header('x-workspace-id') || DEV_WORKSPACE.id)
    await next()
    return
  }

  // AUTH-FIX-1: prefer a verified bearer JWT (human identity). A VALID API
  // token authenticates by its `sub` claim and takes precedence over any
  // x-user-id header. DUAL-ACCEPT (Phase 1): an absent/invalid token falls
  // through to the legacy x-user-id path so existing header clients
  // (extension / GWS / mobile) keep working. Phase 3 (deferred) removes that
  // fallthrough so an invalid/expired bearer becomes a hard 401. `wsp_` keys
  // are handled upstream by api-key-auth/flexAuth, not here.
  const authz = c.req.header('authorization')
  const bearer = authz && /^Bearer\s+/i.test(authz) ? authz.replace(/^Bearer\s+/i, '').trim() : null
  if (bearer && !bearer.startsWith('wsp_')) {
    const verified = await verifyApiToken(bearer)
    if (verified) {
      const [tokenUser] = await db.select().from(users).where(eq(users.id, verified.userId))
      if (!tokenUser) {
        return c.json(
          { data: null, error: { code: 'UNAUTHORIZED', message: 'User not found' } },
          401
        )
      }
      c.set('user', {
        id: tokenUser.id,
        email: tokenUser.email,
        name: tokenUser.name,
        avatarUrl: tokenUser.avatarUrl,
      })
      c.set('userId', tokenUser.id)
      c.set('workspaceId', c.req.header('x-workspace-id') || undefined)
      await next()
      return
    }
    // Bearer present but not a valid API token → fall through (dual-accept).
    // PHASE 3: replace this fallthrough with a 401 (no header trust).
  }

  const userId = headerUserId

  if (!userId) {
    return c.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      401
    )
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId))

  if (!user) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'User not found' } }, 401)
  }

  c.set('user', {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  })
  c.set('userId', user.id)
  c.set('workspaceId', c.req.header('x-workspace-id') || undefined)

  await next()
}
