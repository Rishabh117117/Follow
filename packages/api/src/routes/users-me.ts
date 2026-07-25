/**
 * User "me" endpoints — authenticated user's own profile + settings.
 */

import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { db } from '../db/index'
import { users, userProfiles, accounts } from '../db/schema/users'
import { files } from '../db/schema/files'
import { chatConversations } from '../db/schema/chat'
import { aiState } from '../db/schema/ai-state'
import { apiKeys } from '../db/schema/collaboration'
import { getActiveClients } from '../mcp/transport'
import type { UserSettings } from '@workspace/shared/types'

export const usersMeRouter = new Hono()
usersMeRouter.use('*', authMiddleware)

// ─── GET /me — current user + profile + statePersistent ──────────────

usersMeRouter.get('/', async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = c.get('workspaceId') as string

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } }, 404)
  }

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(and(eq(userProfiles.userId, userId), eq(userProfiles.workspaceId, workspaceId)))
    .limit(1)

  const [state] = await db
    .select()
    .from(aiState)
    .where(and(eq(aiState.userId, userId), eq(aiState.workspaceId, workspaceId)))
    .limit(1)

  return c.json({
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        image: user.image,
      },
      profile: profile
        ? {
            settings: (profile.settings ?? {}) as UserSettings,
            promptPreferences: profile.promptPreferences ?? {},
            knownFacts: profile.knownFacts ?? [],
          }
        : { settings: {} as UserSettings, promptPreferences: {}, knownFacts: [] },
      statePersistent: state?.statePersistent ?? {},
    },
    error: null,
  })
})

// ─── PATCH /me — update name and/or settings ─────────────────────────

usersMeRouter.patch('/', async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = c.get('workspaceId') as string
  const body = (await c.req.json()) as { name?: string; settings?: Partial<UserSettings> }

  // Update user name if provided
  if (body.name !== undefined && body.name.trim().length > 0) {
    await db.update(users).set({ name: body.name.trim() }).where(eq(users.id, userId))
  }

  // Merge settings into userProfiles.settings
  if (body.settings) {
    const [existing] = await db
      .select()
      .from(userProfiles)
      .where(and(eq(userProfiles.userId, userId), eq(userProfiles.workspaceId, workspaceId)))
      .limit(1)

    if (existing) {
      const merged: UserSettings = {
        ...((existing.settings ?? {}) as UserSettings),
        ...body.settings,
        notifications: {
          ...((existing.settings as UserSettings | undefined)?.notifications ?? {}),
          ...(body.settings.notifications ?? {}),
        },
      }
      await db
        .update(userProfiles)
        .set({ settings: merged, lastUpdated: new Date() })
        .where(eq(userProfiles.id, existing.id))
    } else {
      await db.insert(userProfiles).values({
        userId,
        workspaceId,
        settings: body.settings as UserSettings,
      })
    }
  }

  return c.json({ data: { ok: true }, error: null })
})

// ─── POST /me/push-token — register mobile push token ───────────────
//
// The mobile app calls this on sign-in to associate an Expo/APNs/FCM push
// token with the user so the backend can deliver notifications. MVP: we
// store the token on the user's settings blob keyed by platform. A later
// iteration can move this to a dedicated table once multi-device is needed.

usersMeRouter.post('/push-token', async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = c.get('workspaceId') as string
  const body = (await c.req.json()) as { token?: string; platform?: string }

  if (!body.token) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'token required' } },
      400,
    )
  }

  const platform = body.platform ?? 'unknown'

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(and(eq(userProfiles.userId, userId), eq(userProfiles.workspaceId, workspaceId)))
    .limit(1)

  if (profile) {
    const currentSettings = ((profile.settings ?? {}) as Record<string, unknown>)
    const tokens = (currentSettings.pushTokens ?? {}) as Record<string, string>
    tokens[platform] = body.token

    await db
      .update(userProfiles)
      .set({
        settings: {
          ...currentSettings,
          pushTokens: tokens,
        } as UserSettings,
        lastUpdated: new Date(),
      })
      .where(eq(userProfiles.id, profile.id))
  } else {
    await db.insert(userProfiles).values({
      userId,
      workspaceId,
      settings: { pushTokens: { [platform]: body.token } } as UserSettings,
    })
  }

  return c.json({ data: { ok: true }, error: null })
})

// ─── GET /me/accounts — linked OAuth providers ───────────────────────

usersMeRouter.get('/accounts', async (c) => {
  const userId = c.get('userId')

  const rows = await db
    .select({ provider: accounts.provider, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.userId, userId))

  return c.json({ data: rows, error: null })
})

// ─── GET /me/connected-apps — AI clients/agents connected via MCP (WIRE-1) ───

usersMeRouter.get('/connected-apps', async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = c.get('workspaceId') as string

  // Active clients currently in MCP session map
  const active = getActiveClients()

  // Historical API keys created by this user (for inactive/past clients)
  let keyRows: Array<{ name: string; lastUsedAt: Date | null; createdAt: Date }> = []
  try {
    keyRows = await db
      .select({
        name: apiKeys.name,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.createdBy, userId), eq(apiKeys.workspaceId, workspaceId)))
  } catch {
    // Non-fatal
  }

  // Merge: active sessions first, then historical keys that aren't already represented
  const activeNames = new Set(active.map((a) => a.name))
  const result: Array<{
    name: string
    transport: string
    status: 'active' | 'inactive'
    lastSeen: string | null
    callCount: number
  }> = active.map((a) => ({
    name: a.name,
    transport: a.transport,
    status: 'active',
    lastSeen: a.lastSeen,
    callCount: a.callCount,
  }))

  for (const key of keyRows) {
    if (!activeNames.has(key.name)) {
      result.push({
        name: key.name,
        transport: 'API Key',
        status: 'inactive',
        lastSeen: key.lastUsedAt?.toISOString() ?? null,
        callCount: 0,
      })
    }
  }

  return c.json({ data: result, error: null })
})

// ─── GET /me/export — JSON dump of user's data ───────────────────────

usersMeRouter.get('/export', async (c) => {
  const userId = c.get('userId') as string
  const workspaceId = c.get('workspaceId') as string

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  const userFiles = await db.select().from(files).where(eq(files.createdBy, userId))
  const userConvos = await db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.userId, userId))
  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(and(eq(userProfiles.userId, userId), eq(userProfiles.workspaceId, workspaceId)))
    .limit(1)
  const [state] = await db
    .select()
    .from(aiState)
    .where(and(eq(aiState.userId, userId), eq(aiState.workspaceId, workspaceId)))
    .limit(1)

  const payload = {
    exportedAt: new Date().toISOString(),
    user,
    profile,
    files: userFiles,
    conversations: userConvos,
    aiState: state,
  }

  c.header('Content-Type', 'application/json')
  c.header('Content-Disposition', `attachment; filename="follow-export-${userId}.json"`)
  return c.body(JSON.stringify(payload, null, 2))
})

// ─── DELETE /me — soft delete (anonymize) ────────────────────────────

usersMeRouter.delete('/', async (c) => {
  const userId = c.get('userId')

  const anonEmail = `deleted-${userId}@follow.deleted`
  await db
    .update(users)
    .set({
      email: anonEmail,
      name: 'Deleted User',
      avatarUrl: null,
      image: null,
    })
    .where(eq(users.id, userId))

  return c.json({ data: { ok: true }, error: null })
})
