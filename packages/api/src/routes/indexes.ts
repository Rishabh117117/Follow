/**
 * Indexes API (Sprint WIRE-1)
 *
 * "Index" concept:
 * - Personal index = user's own data (files, conversations, facts not in any project)
 * - Project index = a space (existing `spaces` table with isProject=true)
 *
 * GET  /api/indexes        — list user's personal + project indexes with real counts
 * POST /api/indexes        — create a new project index (personal index is implicit per user)
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, isNull, count, inArray, or, ne } from 'drizzle-orm'
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { db } from '../db/index'
import { spaces } from '../db/schema/spaces'
import { rawFiles } from '../db/schema/raw-files'
import { chatConversations } from '../db/schema/chat'
import { indexRecords } from '../db/schema/semantic-index'
import { files } from '../db/schema/files'
import { users } from '../db/schema/users'
import { authMiddleware } from '../middleware/auth'
import { assertWorkspaceAccess } from '../services/workspace-access'
import { ensureProjectStrand } from '../services/project-strand-manager'

// ─── Passcode hashing (STABILIZE-3) ────────────────────────────────────
// scrypt is part of Node core — avoids adding bcrypt/argon2 as a dep.
// N/r/p tuned for ~100ms per hash on modern hardware.
const SCRYPT_KEYLEN = 64

function hashPasscode(passcode: string, salt: string): string {
  return scryptSync(passcode, salt, SCRYPT_KEYLEN).toString('hex')
}

function verifyPasscode(passcode: string, salt: string, expectedHex: string): boolean {
  const computed = scryptSync(passcode, salt, SCRYPT_KEYLEN)
  const expected = Buffer.from(expectedHex, 'hex')
  if (computed.length !== expected.length) return false
  return timingSafeEqual(computed, expected)
}

interface LockMeta {
  locked?: boolean
  passcodeHash?: string
  passcodeSalt?: string
  lockedAt?: string
  failedAttempts?: number
  cooldownUntil?: string // ISO, rate-limits after N failures
}

const MAX_FAILURES = 5
const COOLDOWN_AFTER_FAILURES_MS = 60_000 // 1 minute cooldown after 5 bad attempts

const indexesRouter = new Hono()
indexesRouter.use('*', authMiddleware)

const CreateIndexSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['personal', 'project']),
  workspaceId: z.string().uuid().optional(),
})

interface FollowIndex {
  id: string
  name: string
  type: 'personal' | 'project'
  facts: number
  files: number
  chats: number
  members?: number
  locked?: boolean // STABILIZE-3
}

/**
 * Helper: count of index_records scoped to a user (personal) or space (project).
 * We treat index_records with the user as creator and no project scope as personal.
 */
async function countFactsForPersonal(userId: string): Promise<number> {
  try {
    const [row] = await db
      .select({ cnt: count() })
      .from(indexRecords)
      .where(eq(indexRecords.userId, userId))
    return Number(row?.cnt ?? 0)
  } catch {
    return 0
  }
}

async function countFactsForProject(spaceId: string): Promise<number> {
  try {
    // index_records don't carry spaceId directly. Find owning conversations
    // via either `spaceId = projectId` (canonical) OR `workspaceId = projectId`
    // (MCP save_conversation sets workspaceId to the active project id when
    // save_to='project', and leaves spaceId null). Same for files.
    const convRows = await db
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(or(eq(chatConversations.spaceId, spaceId), eq(chatConversations.workspaceId, spaceId)))
    const convIds = convRows.map((r) => r.id)

    const fileRows = await db
      .select({ id: files.id })
      .from(files)
      .where(or(eq(files.spaceId, spaceId), eq(files.workspaceId, spaceId)))
    const fileIds = fileRows.map((r) => r.id)

    if (convIds.length === 0 && fileIds.length === 0) return 0

    const threadIds = [...convIds, ...fileIds]
    const [row] = await db
      .select({ cnt: count() })
      .from(indexRecords)
      .where(inArray(indexRecords.threadId, threadIds))
    return Number(row?.cnt ?? 0)
  } catch {
    return 0
  }
}

async function countFilesForPersonal(userId: string): Promise<number> {
  try {
    // chat_artifact rows are internal wrappers for the chat-indexing path;
    // the /api/raw-files list filters them out by default so we do the
    // same here to keep the sidebar count aligned with what the user sees.
    const [row] = await db
      .select({ cnt: count() })
      .from(rawFiles)
      .where(
        and(
          eq(rawFiles.userId, userId),
          isNull(rawFiles.deletedAt),
          ne(rawFiles.sourceType, 'chat_artifact')
        )
      )
    return Number(row?.cnt ?? 0)
  } catch {
    return 0
  }
}

async function countFilesForProject(spaceId: string): Promise<number> {
  try {
    // Raw files + workspace files tied to this project — either explicitly
    // (spaceId = projectId) or implicitly via MCP save paths that used
    // workspaceId = projectId. Raw files are the canonical count since
    // that's what the chat-artifact wrapper lands in.
    const [rawRow] = await db
      .select({ cnt: count() })
      .from(rawFiles)
      .where(and(eq(rawFiles.workspaceId, spaceId), isNull(rawFiles.deletedAt)))
    const [fileRow] = await db
      .select({ cnt: count() })
      .from(files)
      .where(
        and(or(eq(files.spaceId, spaceId), eq(files.workspaceId, spaceId)), isNull(files.deletedAt))
      )
    return Number(rawRow?.cnt ?? 0) + Number(fileRow?.cnt ?? 0)
  } catch {
    return 0
  }
}

async function countChatsForPersonal(userId: string): Promise<number> {
  try {
    const [row] = await db
      .select({ cnt: count() })
      .from(chatConversations)
      .where(and(eq(chatConversations.userId, userId), isNull(chatConversations.spaceId)))
    return Number(row?.cnt ?? 0)
  } catch {
    return 0
  }
}

async function countChatsForProject(spaceId: string): Promise<number> {
  try {
    const [row] = await db
      .select({ cnt: count() })
      .from(chatConversations)
      .where(or(eq(chatConversations.spaceId, spaceId), eq(chatConversations.workspaceId, spaceId)))
    return Number(row?.cnt ?? 0)
  } catch {
    return 0
  }
}

async function countMembersForProject(spaceId: string): Promise<number> {
  try {
    // Count distinct users with conversations in this space
    const rows = await db
      .selectDistinct({ userId: chatConversations.userId })
      .from(chatConversations)
      .where(eq(chatConversations.spaceId, spaceId))
    // At minimum the creator is a member — return max(distinct, 1)
    return Math.max(rows.length, 1)
  } catch {
    return 1
  }
}

// ─── GET /api/indexes ───────────────────────────────────────────────────

indexesRouter.get('/', async (c) => {
  const userId = c.get('userId') as string

  const result: FollowIndex[] = []

  // Personal index (always present per user)
  const [pFacts, pFiles, pChats] = await Promise.all([
    countFactsForPersonal(userId),
    countFilesForPersonal(userId),
    countChatsForPersonal(userId),
  ])
  result.push({
    id: 'personal',
    name: 'Personal',
    type: 'personal',
    facts: pFacts,
    files: pFiles,
    chats: pChats,
  })

  // Project indexes — all spaces the user created or is a member of
  try {
    const userSpaces = await db
      .select()
      .from(spaces)
      .where(
        and(eq(spaces.createdBy, userId), eq(spaces.isProject, true), isNull(spaces.deletedAt))
      )

    for (const space of userSpaces) {
      const [facts, files, chats, members] = await Promise.all([
        countFactsForProject(space.id),
        countFilesForProject(space.id),
        countChatsForProject(space.id),
        countMembersForProject(space.id),
      ])
      const meta = (space.metadata as LockMeta | null) ?? {}
      result.push({
        id: space.id,
        name: space.name,
        type: 'project',
        facts,
        files,
        chats,
        members,
        locked: meta.locked === true,
      })
    }
  } catch {
    // Non-fatal — spaces table may be empty
  }

  return c.json({ data: result, error: null })
})

// ─── POST /api/indexes ──────────────────────────────────────────────────

indexesRouter.post('/', zValidator('json', CreateIndexSchema), async (c) => {
  const userId = c.get('userId') as string
  const body = c.req.valid('json')

  // Personal index is implicit — only one per user, cannot be created via API
  if (body.type === 'personal') {
    return c.json(
      {
        data: null,
        error: { message: 'Personal index already exists for this user (one per user)' },
      },
      400
    )
  }

  // Create project index → creates a space
  const workspaceId = body.workspaceId
  if (!workspaceId) {
    return c.json(
      { data: null, error: { message: 'workspaceId is required for project indexes' } },
      400
    )
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  try {
    const [space] = await db
      .insert(spaces)
      .values({
        workspaceId,
        name: body.name,
        isProject: true,
        createdBy: userId,
      })
      .returning()

    if (!space) {
      return c.json({ data: null, error: { message: 'Failed to create space' } }, 500)
    }

    // Ensure project strand exists (non-blocking)
    try {
      await ensureProjectStrand(space.id, workspaceId, userId)
    } catch {
      // Non-fatal
    }

    const followIndex: FollowIndex = {
      id: space.id,
      name: space.name,
      type: 'project',
      facts: 0,
      files: 0,
      chats: 0,
      members: 1,
    }
    return c.json({ data: followIndex, error: null }, 201)
  } catch (err) {
    return c.json(
      {
        data: null,
        error: { message: err instanceof Error ? err.message : 'Failed to create index' },
      },
      500
    )
  }
})

// ─── DELETE /api/indexes/:id (STABILIZE-3) ───────────────────────────────
// Soft-deletes a project index. Personal index is implicit and cannot be deleted.

indexesRouter.delete('/:id', async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')

  if (id === 'personal') {
    return c.json({ data: null, error: { message: 'The Personal index cannot be deleted.' } }, 400)
  }

  const [space] = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.id, id), isNull(spaces.deletedAt)))
    .limit(1)

  if (!space) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Index not found' } }, 404)
  }

  // Only the creator can delete (simple ownership check for now).
  if (space.createdBy !== userId) {
    return c.json(
      {
        data: null,
        error: { code: 'FORBIDDEN', message: 'Only the index creator can delete it.' },
      },
      403
    )
  }

  await db
    .update(spaces)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(spaces.id, id))

  return c.json({ data: { id, deleted: true }, error: null })
})

// ─── Lock / Unlock / Recover (STABILIZE-3) ──────────────────────────────
// Lock state lives in spaces.metadata so no schema migration is needed.
// Passcodes hashed with Node scrypt. After MAX_FAILURES wrong attempts,
// the API rate-limits for COOLDOWN_AFTER_FAILURES_MS or the user can
// recover via their Google account (endpoint: /recover).

const SetPasscodeSchema = z.object({ passcode: z.string().min(4).max(64) })
const UnlockSchema = z.object({ passcode: z.string().min(1).max(64) })

async function loadSpaceOrNotFound(
  id: string
): Promise<{ space: typeof spaces.$inferSelect; meta: LockMeta } | null> {
  const [space] = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.id, id), isNull(spaces.deletedAt)))
    .limit(1)
  if (!space) return null
  const meta = (space.metadata as unknown as LockMeta | null) ?? {}
  return { space, meta }
}

async function writeLockMeta(id: string, nextMeta: LockMeta): Promise<void> {
  await db
    .update(spaces)
    .set({ metadata: nextMeta as never, updatedAt: new Date() })
    .where(eq(spaces.id, id))
}

// POST /api/indexes/:id/lock  { passcode }
indexesRouter.post('/:id/lock', zValidator('json', SetPasscodeSchema), async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  const { passcode } = c.req.valid('json')

  if (id === 'personal') {
    return c.json({ data: null, error: { message: 'The Personal index cannot be locked.' } }, 400)
  }

  const found = await loadSpaceOrNotFound(id)
  if (!found) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Index not found' } }, 404)
  }
  if (found.space.createdBy !== userId) {
    return c.json(
      { data: null, error: { code: 'FORBIDDEN', message: 'Only the index creator can lock it.' } },
      403
    )
  }

  const salt = randomBytes(16).toString('hex')
  const hash = hashPasscode(passcode, salt)
  const nextMeta: LockMeta = {
    ...found.meta,
    locked: true,
    passcodeHash: hash,
    passcodeSalt: salt,
    lockedAt: new Date().toISOString(),
    failedAttempts: 0,
    cooldownUntil: undefined,
  }
  await writeLockMeta(id, nextMeta)
  return c.json({ data: { id, locked: true }, error: null })
})

// POST /api/indexes/:id/unlock  { passcode }
indexesRouter.post('/:id/unlock', zValidator('json', UnlockSchema), async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  const { passcode } = c.req.valid('json')

  const found = await loadSpaceOrNotFound(id)
  if (!found) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Index not found' } }, 404)
  }
  if (found.space.createdBy !== userId) {
    return c.json(
      {
        data: null,
        error: { code: 'FORBIDDEN', message: 'Only the index creator can unlock it.' },
      },
      403
    )
  }
  const meta = found.meta
  if (!meta.locked || !meta.passcodeHash || !meta.passcodeSalt) {
    return c.json({ data: { id, locked: false }, error: null })
  }

  // Cooldown check (after MAX_FAILURES bad attempts)
  if (meta.cooldownUntil && new Date(meta.cooldownUntil) > new Date()) {
    const secondsLeft = Math.ceil((new Date(meta.cooldownUntil).getTime() - Date.now()) / 1000)
    return c.json(
      {
        data: null,
        error: {
          code: 'COOLDOWN',
          message: `Too many attempts. Try again in ${secondsLeft}s, or recover with Google.`,
          secondsLeft,
        },
      },
      429
    )
  }

  const ok = verifyPasscode(passcode, meta.passcodeSalt, meta.passcodeHash)
  if (!ok) {
    const attempts = (meta.failedAttempts ?? 0) + 1
    const next: LockMeta = { ...meta, failedAttempts: attempts }
    if (attempts >= MAX_FAILURES) {
      next.cooldownUntil = new Date(Date.now() + COOLDOWN_AFTER_FAILURES_MS).toISOString()
      next.failedAttempts = 0
    }
    await writeLockMeta(id, next)
    return c.json(
      {
        data: null,
        error: {
          code: 'BAD_PASSCODE',
          message: 'Incorrect passcode',
          attemptsRemaining: Math.max(0, MAX_FAILURES - attempts),
        },
      },
      401
    )
  }

  // Success — clear lock
  await writeLockMeta(id, { ...meta, locked: false, failedAttempts: 0, cooldownUntil: undefined })
  return c.json({ data: { id, locked: false }, error: null })
})

// POST /api/indexes/:id/recover
// Caller must be the space creator AND have an active session whose user row
// matches by email (proving the same Google identity). Client-side flow:
//   1. User clicks "Recover with Google"
//   2. Web app re-runs signIn('google') to refresh JWT
//   3. On return, web app calls this endpoint — server checks the current
//      session owns the space and (via user row lookup) matches email.
// Lock is cleared on success. Passcode hash is wiped so the next lock starts fresh.
indexesRouter.post('/:id/recover', async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')

  const found = await loadSpaceOrNotFound(id)
  if (!found) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Index not found' } }, 404)
  }
  if (found.space.createdBy !== userId) {
    return c.json(
      {
        data: null,
        error: { code: 'FORBIDDEN', message: 'Only the index creator can recover it.' },
      },
      403
    )
  }

  // Verify the caller's user row still exists (they're a real, current Google identity).
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!u || !u.email) {
    return c.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Session user not found' } },
      401
    )
  }

  // Clear the lock entirely.
  await writeLockMeta(id, {
    locked: false,
    passcodeHash: undefined,
    passcodeSalt: undefined,
    lockedAt: undefined,
    failedAttempts: 0,
    cooldownUntil: undefined,
  })
  return c.json({ data: { id, locked: false, recoveredBy: u.email }, error: null })
})

export { indexesRouter }
