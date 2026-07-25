/**
 * Dashboard Token Middleware
 *
 * Gates admin-only dev endpoints (model overrides, openrouter proxy, etc.)
 * behind a simple shared secret. The launcher generates the token at startup
 * and injects it into the dashboard HTML so both ends agree without any
 * human copy-paste.
 *
 * Token source (in order):
 *   1. process.env.DASHBOARD_TOKEN
 *   2. data/.dashboard-token (written by scripts/launch.ts)
 *
 * If neither is present and NODE_ENV !== 'production', endpoints are left
 * open so first-run bootstrap isn't blocked. In prod, missing token → 503.
 */
import type { MiddlewareHandler } from 'hono'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const TOKEN_FILE = resolve(process.cwd(), 'data', '.dashboard-token')

let cached: { token: string | null; at: number } = { token: null, at: 0 }
const TTL_MS = 5000

function getExpectedToken(): string | null {
  const now = Date.now()
  if (now - cached.at < TTL_MS) return cached.token
  let token: string | null = process.env['DASHBOARD_TOKEN'] ?? null
  if (!token && existsSync(TOKEN_FILE)) {
    try {
      token = readFileSync(TOKEN_FILE, 'utf-8').trim() || null
    } catch {
      token = null
    }
  }
  cached = { token, at: now }
  return token
}

export const dashboardTokenMiddleware: MiddlewareHandler = async (c, next) => {
  const expected = getExpectedToken()
  if (!expected) {
    if (process.env['NODE_ENV'] === 'production') {
      return c.json(
        { data: null, error: { code: 'NO_DASHBOARD_TOKEN', message: 'Dashboard token not configured' } },
        503
      )
    }
    // Dev bootstrap: allow through.
    return next()
  }
  const provided = c.req.header('x-dashboard-token') ?? c.req.query('token')
  if (provided !== expected) {
    return c.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid dashboard token' } },
      401
    )
  }
  return next()
}

/** Utility for other modules that want to verify a token outside Hono. */
export function verifyDashboardToken(token: string | undefined | null): boolean {
  const expected = getExpectedToken()
  if (!expected) return process.env['NODE_ENV'] !== 'production'
  return !!token && token === expected
}

/**
 * Accept EITHER a valid dashboard token OR a valid user session.
 *
 * Use this for queue-control endpoints that need to be callable from:
 *   1. The dev console on :4000 (dashboard token, no user session)
 *   2. The web app on :3009 (signed-in user via x-user-id, no dashboard token)
 *
 * If the request carries a dashboard token, verify and allow.
 * Otherwise fall through to the injected auth middleware (typically authMiddleware).
 */
export function dashboardTokenOrAuth(
  userAuth: MiddlewareHandler,
): MiddlewareHandler {
  return async (c, next) => {
    const provided = c.req.header('x-dashboard-token') ?? c.req.query('token')
    if (provided && verifyDashboardToken(provided)) {
      return next()
    }
    // No valid token — defer to user-session auth.
    return userAuth(c, next)
  }
}
