/**
 * Integration test helpers.
 * Creates a Hono app backed by PGlite (in-memory) for realistic DB-level testing.
 *
 * Phase 3 (security-gate-1): requests authenticate with a REAL bearer JWT
 * minted here — the x-user-id header no longer carries identity. makeRequest
 * still accepts an `x-user-id` override and mints the token for THAT user, so
 * multi-user tests keep working unchanged. To suppress the mint, pass your own
 * `Authorization` header (e.g. `Bearer wsp_...` for key tests); to go fully
 * unauthenticated, pass `'x-user-id': ''` or `Authorization: ''` (empty-string
 * headers are omitted from the request entirely).
 *
 * Usage in test files:
 *   import { getTestApp, makeRequest, DEV_USER_ID, DEV_WORKSPACE_ID } from '../helpers/test-setup'
 *
 *   let app: ReturnType<typeof getTestApp> extends Promise<infer T> ? T : never
 *   beforeAll(async () => { app = await getTestApp() }, 30_000)
 */

import { SignJWT } from 'jose'
import { waitForDb } from '../../db/index'
import { createApp } from '../../app'
import { DEV_USER, DEV_WORKSPACE } from '@workspace/shared/constants'
import { API_TOKEN_ISSUER, API_TOKEN_AUDIENCE } from '../../lib/api-token'

// Both the mint below and the middleware's verify read the secret lazily per
// call, so setting it at helper-import time is early enough.
process.env['AUTH_API_SECRET'] ||= 'test-auth-api-secret-0123456789-abcdef'

// Dev user / workspace seeded by PGlite init
export const DEV_USER_ID = DEV_USER.id
export const DEV_WORKSPACE_ID = DEV_WORKSPACE.id

let _app: ReturnType<typeof createApp> | null = null
let _ready: Promise<void> | null = null

/**
 * Returns a shared Hono app instance with PGlite DB ready.
 * Only initialises once across all test files.
 */
export async function getTestApp() {
  if (_app) return _app

  if (!_ready) {
    _ready = waitForDb()
  }

  await _ready
  _app = createApp({ silent: true })
  return _app
}

/** Mint a real API bearer token for `sub`, same shape the web mint route signs. */
export async function mintTestApiToken(sub: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setIssuer(API_TOKEN_ISSUER)
    .setAudience(API_TOKEN_AUDIENCE)
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(process.env['AUTH_API_SECRET']!))
}

/**
 * Convenience wrapper for making requests against the test app.
 */
export async function makeRequest(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; json: any; headers: Headers }> {
  const url = `http://localhost${path}`
  const merged: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-id': DEV_USER_ID,
    'x-workspace-id': DEV_WORKSPACE_ID,
    ...headers,
  }

  // Mint the bearer for whoever the test claims to be, unless the test brought
  // its own Authorization header or explicitly asked to stay anonymous.
  const hasExplicitAuth = Object.keys(headers ?? {}).some(
    (k) => k.toLowerCase() === 'authorization'
  )
  const wantsAnonymous = headers !== undefined && headers['x-user-id'] === ''
  if (!hasExplicitAuth && !wantsAnonymous) {
    merged['Authorization'] = `Bearer ${await mintTestApiToken(merged['x-user-id'] || DEV_USER_ID)}`
  }

  // Empty-string entries mean "omit this header entirely".
  for (const [k, v] of Object.entries(merged)) {
    if (v === '') delete merged[k]
  }

  const init: RequestInit = { method, headers: merged }

  if (body && method !== 'GET') {
    init.body = JSON.stringify(body)
  }

  const res = await app.request(url, init)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json()) as any
  return { status: res.status, json, headers: res.headers }
}
