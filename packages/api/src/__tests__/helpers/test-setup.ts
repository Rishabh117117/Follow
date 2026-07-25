/**
 * Integration test helpers.
 * Creates a Hono app backed by PGlite (in-memory) for realistic DB-level testing.
 *
 * Usage in test files:
 *   import { getTestApp, makeRequest, DEV_USER_ID, DEV_WORKSPACE_ID } from '../helpers/test-setup'
 *
 *   let app: ReturnType<typeof getTestApp> extends Promise<infer T> ? T : never
 *   beforeAll(async () => { app = await getTestApp() }, 30_000)
 */

import { waitForDb } from '../../db/index'
import { createApp } from '../../app'
import { DEV_USER, DEV_WORKSPACE } from '@workspace/shared/constants'

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
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': DEV_USER_ID,
      'x-workspace-id': DEV_WORKSPACE_ID,
      ...headers,
    },
  }

  if (body && method !== 'GET') {
    init.body = JSON.stringify(body)
  }

  const res = await app.request(url, init)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json()) as any
  return { status: res.status, json, headers: res.headers }
}
