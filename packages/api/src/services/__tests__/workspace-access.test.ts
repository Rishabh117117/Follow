import { describe, it, expect, beforeAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getTestApp, DEV_USER_ID } from '../../__tests__/helpers/test-setup'
import { db } from '../../db/index'
import { users } from '../../db/schema/users'
import { workspaces, workspaceMembers } from '../../db/schema/workspaces'
import { checkWorkspaceAccess } from '../workspace-access'

// Second tenant, seeded fresh for this file.
const USER_B = '3d1f2a9c-0b47-4e5d-8a66-9f1e2d3c4b5a'
const WS_B = '7c8e9f0a-1b2c-4d3e-9f4a-5b6c7d8e9f0a'
const WS_MISSING = '00000000-0000-4000-8000-000000000999'

async function clearMembership() {
  await db
    .delete(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, WS_B), eq(workspaceMembers.userId, DEV_USER_ID)))
}

beforeAll(async () => {
  await getTestApp() // PGlite ready + dev user/workspace seeded
  await db
    .insert(users)
    .values({ id: USER_B, email: 'guard-b@test.local', name: 'Guard User B' })
    .onConflictDoNothing()
  await db
    .insert(workspaces)
    .values({ id: WS_B, name: 'Guard WS B', slug: 'guard-ws-b', ownerId: USER_B })
    .onConflictDoNothing()
}, 30_000)

describe('checkWorkspaceAccess — the multi-tenant boundary predicate', () => {
  it('owner → allowed', async () => {
    expect(await checkWorkspaceAccess(USER_B, WS_B)).toEqual({ ok: true, role: 'owner' })
  })

  it('cross-tenant stranger → 403', async () => {
    const r = await checkWorkspaceAccess(DEV_USER_ID, WS_B)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(403)
  })

  it('active member → allowed with their role', async () => {
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: WS_B, userId: DEV_USER_ID, role: 'editor', status: 'active' })
    expect(await checkWorkspaceAccess(DEV_USER_ID, WS_B)).toEqual({ ok: true, role: 'editor' })
    await clearMembership()
  })

  it('inactive membership (invited, never accepted) → 403', async () => {
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: WS_B, userId: DEV_USER_ID, role: 'editor', status: 'invited' })
    const r = await checkWorkspaceAccess(DEV_USER_ID, WS_B)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(403)
    await clearMembership()
  })

  it('unknown workspace → 404', async () => {
    const r = await checkWorkspaceAccess(DEV_USER_ID, WS_MISSING)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
  })

  // Runs LAST in this file: soft-deletes WS_B.
  it('soft-deleted workspace → 404 even for its owner', async () => {
    await db.update(workspaces).set({ deletedAt: new Date() }).where(eq(workspaces.id, WS_B))
    const r = await checkWorkspaceAccess(USER_B, WS_B)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
  })
})
