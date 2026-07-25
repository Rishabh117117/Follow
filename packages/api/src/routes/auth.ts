/**
 * Auth Routes — Extension login via Google OAuth token.
 *
 * POST /api/auth/extension-login
 *   Validates a Google OAuth access token, finds or creates the user,
 *   and returns userId + workspaceId for the extension to store.
 */

import { Hono } from 'hono'
import { db } from '../db/index'
import { users } from '../db/schema/users'
import { workspaces, workspaceMembers } from '../db/schema/workspaces'
import { eq } from 'drizzle-orm'

const authRouter = new Hono()

authRouter.post('/extension-login', async (c) => {
  const body = await c.req.json<{ googleAccessToken: string }>()

  if (!body.googleAccessToken) {
    return c.json({ error: { message: 'googleAccessToken is required' } }, 400)
  }

  // Validate token with Google
  let profile: { email: string; name: string; picture?: string }
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${body.googleAccessToken}` },
    })
    if (!res.ok) {
      return c.json({ error: { message: 'Invalid Google token' } }, 401)
    }
    const data = (await res.json()) as { email?: string; name?: string; picture?: string }
    if (!data.email) {
      return c.json({ error: { message: 'Could not retrieve email from Google' } }, 401)
    }
    profile = { email: data.email, name: data.name ?? data.email.split('@')[0]!, picture: data.picture }
  } catch (err) {
    return c.json({ error: { message: 'Failed to validate Google token' } }, 500)
  }

  // Find or create user
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, profile.email))
    .limit(1)

  if (!user) {
    const [created] = await db
      .insert(users)
      .values({
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.picture ?? null,
        image: profile.picture ?? null,
      })
      .returning()
    user = created!
  }

  // Find or create workspace
  let workspace: { id: string } | undefined

  // Check if user has any workspace membership
  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, user.id))
    .limit(1)

  if (memberships.length > 0) {
    workspace = { id: memberships[0]!.workspaceId }
  } else {
    // Create workspace for new user
    const slug = profile.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) + '-ws'

    const [newWorkspace] = await db
      .insert(workspaces)
      .values({
        name: `${profile.name}'s Workspace`,
        slug,
        ownerId: user.id,
      })
      .returning()

    workspace = newWorkspace!

    // Add as owner member
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: user.id,
      role: 'admin',
    })
  }

  return c.json({
    data: {
      userId: user.id,
      workspaceId: workspace.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    },
  })
})

/**
 * POST /api/auth/resolve-user
 *   Find or create a user by email (used by web app NextAuth to share
 *   the same user/workspace as the extension).
 */
authRouter.post('/resolve-user', async (c) => {
  const body = await c.req.json<{ email: string; name?: string; avatarUrl?: string }>()

  if (!body.email) {
    return c.json({ error: { message: 'email is required' } }, 400)
  }

  // Find or create user
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, body.email))
    .limit(1)

  if (!user) {
    const name = body.name ?? body.email.split('@')[0]!
    const [created] = await db
      .insert(users)
      .values({
        email: body.email,
        name,
        avatarUrl: body.avatarUrl ?? null,
        image: body.avatarUrl ?? null,
      })
      .returning()
    user = created!
  }

  // Find existing workspace membership first
  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, user.id))
    .limit(1)

  if (memberships.length > 0) {
    return c.json({
      data: {
        userId: user.id,
        workspaceId: memberships[0]!.workspaceId,
      },
    })
  }

  // Also check if user owns any workspace directly
  const ownedWorkspaces = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerId, user.id))
    .limit(1)

  if (ownedWorkspaces.length > 0) {
    // Add membership and return
    await db.insert(workspaceMembers).values({
      workspaceId: ownedWorkspaces[0]!.id,
      userId: user.id,
      role: 'admin',
    }).onConflictDoNothing()

    return c.json({
      data: {
        userId: user.id,
        workspaceId: ownedWorkspaces[0]!.id,
      },
    })
  }

  // Create new workspace with unique slug
  const baseSlug = (user.name || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
  const slug = `${baseSlug}-ws-${Date.now().toString(36)}`

  const [newWorkspace] = await db
    .insert(workspaces)
    .values({
      name: `${user.name}'s Workspace`,
      slug,
      ownerId: user.id,
    })
    .returning()

  await db.insert(workspaceMembers).values({
    workspaceId: newWorkspace!.id,
    userId: user.id,
    role: 'admin',
  })

  return c.json({
    data: {
      userId: user.id,
      workspaceId: newWorkspace!.id,
    },
  })
})

export { authRouter }
