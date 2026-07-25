/**
 * security-gate-1 — end-to-end proof of the two locks through the real app:
 *   1. Phase 3: identity comes only from a verified bearer (or wsp_ key), never
 *      the x-user-id header.
 *   2. Membership guard: a caller-supplied workspaceId only works for a member.
 * Plus the formerly-unauthenticated public surfaces.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { getTestApp, makeRequest, DEV_USER_ID, DEV_WORKSPACE_ID } from './helpers/test-setup'
import { db } from '../db/index'
import { users } from '../db/schema/users'
import { workspaces } from '../db/schema/workspaces'

// A second tenant with no relationship to the seeded DEV workspace.
const OUTSIDER_ID = '9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d'
const OUTSIDER_WS = '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7081'

let app: Awaited<ReturnType<typeof getTestApp>>

beforeAll(async () => {
  app = await getTestApp()
  await db
    .insert(users)
    .values({ id: OUTSIDER_ID, email: 'outsider@test.local', name: 'Outsider' })
    .onConflictDoNothing()
  await db
    .insert(workspaces)
    .values({ id: OUTSIDER_WS, name: 'Outsider WS', slug: 'outsider-ws', ownerId: OUTSIDER_ID })
    .onConflictDoNothing()
}, 30_000)

describe('Phase 3 — the x-user-id header no longer authenticates', () => {
  it('a bare x-user-id header (no bearer) → 401', async () => {
    // Suppress the helper's auto-minted bearer; send only the legacy header.
    const res = await makeRequest(app, 'GET', '/api/users/me', undefined, {
      Authorization: '',
      'x-user-id': DEV_USER_ID,
    })
    expect(res.status).toBe(401)
  })

  it('a valid minted bearer → 200', async () => {
    const res = await makeRequest(app, 'GET', '/api/users/me')
    expect(res.status).toBe(200)
    expect(res.json.data.user.id).toBe(DEV_USER_ID)
  })
})

describe('Membership guard — caller-supplied workspaceId', () => {
  it('CROSS-TENANT: outsider querying the DEV workspace index → 403', async () => {
    const res = await makeRequest(
      app,
      'POST',
      '/api/index/query',
      { workspaceId: DEV_WORKSPACE_ID, query: 'anything', limit: 1 },
      { 'x-user-id': OUTSIDER_ID, 'x-workspace-id': OUTSIDER_WS }
    )
    expect(res.status).toBe(403)
  })

  it('OWN WORKSPACE: the DEV user querying their own index → not blocked', async () => {
    const res = await makeRequest(app, 'POST', '/api/index/query', {
      workspaceId: DEV_WORKSPACE_ID,
      query: 'anything',
      limit: 1,
    })
    expect(res.status).not.toBe(403)
    expect(res.status).not.toBe(401)
  })

  it('PRIVILEGE ESCALATION: outsider minting a wsp_ key into the DEV workspace → 403', async () => {
    const res = await makeRequest(
      app,
      'POST',
      '/api/mcp/keys',
      { name: 'evil' },
      {
        'x-user-id': OUTSIDER_ID,
        'x-workspace-id': DEV_WORKSPACE_ID,
      }
    )
    expect(res.status).toBe(403)
  })
})

describe('Public surfaces — /api/users is no longer wide open', () => {
  it('unauthenticated DELETE /api/users/:id → 401 (was: deletes any account)', async () => {
    const res = await makeRequest(app, 'DELETE', `/api/users/${DEV_USER_ID}`, undefined, {
      Authorization: '',
      'x-user-id': '',
      'x-workspace-id': '',
    })
    expect(res.status).toBe(401)
  })

  it('authenticated DELETE of ANOTHER user → 403 (self only)', async () => {
    const res = await makeRequest(app, 'DELETE', `/api/users/${DEV_USER_ID}`, undefined, {
      'x-user-id': OUTSIDER_ID,
    })
    expect(res.status).toBe(403)
  })
})
