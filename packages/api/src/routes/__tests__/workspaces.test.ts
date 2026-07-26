/**
 * Teams lifecycle — the first HTTP coverage of create → invite → public
 * preview → join → members → role → leave, plus the dedup and owner-protection
 * edges. Runs against real PGlite; makeRequest mints a real bearer per user, so
 * requirePermission + the membership guard are exercised end to end.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { getTestApp, makeRequest } from '../../__tests__/helpers/test-setup'
import { db } from '../../db/index'
import { users } from '../../db/schema/users'

const OWNER = 'a0000000-0000-4000-8000-000000000001'
const INVITEE = 'a0000000-0000-4000-8000-000000000002'
const INVITEE_EMAIL = 'teammate@test.local'

let app: Awaited<ReturnType<typeof getTestApp>>

beforeAll(async () => {
  app = await getTestApp()
  await db
    .insert(users)
    .values([
      { id: OWNER, email: 'owner@test.local', name: 'Owner' },
      { id: INVITEE, email: INVITEE_EMAIL, name: 'Teammate' },
    ])
    .onConflictDoNothing()
}, 30_000)

// Each request acts as a specific user (makeRequest mints that user's bearer).
const asOwner = (m: string, p: string, b?: unknown) =>
  makeRequest(app, m, p, b, { 'x-user-id': OWNER })
const asInvitee = (m: string, p: string, b?: unknown) =>
  makeRequest(app, m, p, b, { 'x-user-id': INVITEE })

describe('Teams lifecycle', () => {
  let wsId = ''
  let inviteToken = ''

  it('owner creates a workspace and it appears in their list with role owner', async () => {
    const slug = 'team-ws-' + OWNER.slice(0, 8)
    const created = await asOwner('POST', '/api/workspaces', { name: 'Team WS', slug })
    expect(created.status).toBe(201)
    wsId = created.json.data.id
    expect(wsId).toBeTruthy()

    const list = await asOwner('GET', '/api/workspaces')
    expect(list.status).toBe(200)
    const mine = list.json.data.find((w: { id: string }) => w.id === wsId)
    expect(mine?.role).toBe('owner')
  })

  it('a non-member cannot see the workspace members (guard: 403)', async () => {
    const res = await asInvitee('GET', `/api/workspaces/${wsId}/members`)
    expect(res.status).toBe(403)
  })

  it('owner invites a teammate and gets a token', async () => {
    const res = await asOwner('POST', `/api/workspaces/${wsId}/invite`, {
      email: INVITEE_EMAIL,
      role: 'editor',
    })
    expect(res.status).toBe(201)
    inviteToken = res.json.data.inviteToken
    expect(inviteToken).toBeTruthy()
  })

  it('the invite is previewable unauthenticated by token', async () => {
    const res = await makeRequest(app, 'GET', `/api/public/invite/${inviteToken}`, undefined, {
      'x-user-id': '',
      'x-workspace-id': '',
      Authorization: '',
    })
    expect(res.status).toBe(200)
    expect(res.json.data.workspaceId).toBe(wsId)
    expect(res.json.data.role).toBe('editor')
  })

  it('re-inviting the same pending email reissues (no duplicate pending row)', async () => {
    const res = await asOwner('POST', `/api/workspaces/${wsId}/invite`, {
      email: INVITEE_EMAIL,
      role: 'editor',
    })
    expect(res.status).toBe(201)
    // The reissued token supersedes; use the latest for the join.
    inviteToken = res.json.data.inviteToken
    const members = await asOwner('GET', `/api/workspaces/${wsId}/members`)
    const pendingForEmail = members.json.data.filter(
      (m: { inviteEmail: string | null; status: string }) =>
        m.inviteEmail === INVITEE_EMAIL && m.status === 'pending'
    )
    expect(pendingForEmail.length).toBe(1)
  })

  it('teammate joins with the token and becomes an active member', async () => {
    const res = await asInvitee('POST', `/api/workspaces/${wsId}/join`, { token: inviteToken })
    expect(res.status).toBe(200)
    expect(res.json.data.status).toBe('active')
    expect(res.json.data.userId).toBe(INVITEE)
  })

  it('after joining, the teammate can see members (guard: 403 → 200)', async () => {
    const res = await asInvitee('GET', `/api/workspaces/${wsId}/members`)
    expect(res.status).toBe(200)
    const emails = res.json.data.map((m: { userEmail: string | null }) => m.userEmail)
    expect(emails).toContain('owner@test.local')
    expect(emails).toContain(INVITEE_EMAIL)
  })

  it('re-inviting an already-active member is rejected (409)', async () => {
    const res = await asOwner('POST', `/api/workspaces/${wsId}/invite`, {
      email: INVITEE_EMAIL,
      role: 'viewer',
    })
    expect(res.status).toBe(409)
  })

  it('owner can change a member role but not the owner role', async () => {
    const ok = await asOwner('PATCH', `/api/workspaces/${wsId}/members/${INVITEE}`, {
      role: 'viewer',
    })
    expect(ok.status).toBe(200)

    const nope = await asOwner('PATCH', `/api/workspaces/${wsId}/members/${OWNER}`, {
      role: 'viewer',
    })
    expect(nope.status).toBe(403)
  })

  it('the owner cannot leave their own workspace', async () => {
    const res = await asOwner('POST', `/api/workspaces/${wsId}/leave`)
    expect(res.status).toBe(403)
  })

  it('a member can leave, and then loses access', async () => {
    const leave = await asInvitee('POST', `/api/workspaces/${wsId}/leave`)
    expect(leave.status).toBe(200)

    const after = await asInvitee('GET', `/api/workspaces/${wsId}/members`)
    expect(after.status).toBe(403)
  })
})
