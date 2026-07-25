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

// Phase 3 break-glass: legacy x-user-id identity is trusted ONLY under
// DEV_BYPASS_AUTH (local stacks, where the extension/mobile/GWS clients still
// send headers) or the emergency flag below (rollback without a redeploy: set
// it in Railway, restart, migrate the broken client, unset). Never enable the
// flag as a steady state — it reopens impersonation-by-header.
function acceptLegacyUserHeader(): boolean {
  return isDevBypass() || process.env['AUTH_ACCEPT_LEGACY_USER_HEADER'] === 'true'
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

  // AUTH-FIX-1 Phase 3 (2026-07): identity comes ONLY from verified
  // credentials — this bearer JWT (humans; minted by the web app, verified by
  // signature) or a wsp_ API key handled upstream by api-key-auth/flexAuth
  // (machines). The x-user-id header is NOT trusted for identity anymore;
  // the legacy path below survives solely behind acceptLegacyUserHeader()
  // (local dev bypass / emergency break-glass).
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
    // Bearer present but not a valid API token: hard 401 (Phase 3). Only the
    // dev-bypass/break-glass path may fall through to header identity.
    if (!acceptLegacyUserHeader()) {
      return c.json(
        { data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        401
      )
    }
  }

  // No usable bearer: Phase 3 rejects here — header identity is forgeable and
  // no longer authenticates outside dev bypass / break-glass.
  if (!acceptLegacyUserHeader()) {
    return c.json(
      {
        data: null,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required (Bearer API token or wsp_ API key)',
        },
      },
      401
    )
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
