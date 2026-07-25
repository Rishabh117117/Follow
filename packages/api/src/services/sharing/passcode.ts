/**
 * Passcode Service (Sprint SH-1)
 *
 * Gates access to a user's index with a passcode. The passcode is
 * sha256-hashed with a per-user salt; the salt is generated with
 * `crypto.randomBytes(16)` on first setup.
 *
 * Unlocking creates a session token (32 random bytes hex) that
 * expires after `SESSION_DURATION_MS` (30 min). The token is stored
 * on the `index_access` row and must match on every subsequent
 * validateSession() call. Expired sessions auto-lock.
 *
 * This sprint is the "Otto opens his notebook" foundation. SH-2 will
 * require a valid session token before any content can flow out of
 * the index via shared slices.
 *
 * Uses the project's standard `db.select()/insert()/update()` pattern
 * (the codebase does NOT use Drizzle's relational `db.query.*` API).
 */

import { createHash, randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index'
import { indexAccess } from '../../db/schema/sharing'

const SESSION_DURATION_MS = 30 * 60 * 1000 // 30 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashPasscode(passcode: string, salt: string): string {
  return createHash('sha256').update(passcode + salt).digest('hex')
}

async function findAccess(userId: string) {
  const [row] = await db
    .select()
    .from(indexAccess)
    .where(eq(indexAccess.userId, userId))
    .limit(1)
  return row ?? null
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Set or update the passcode for a user's index.
 * First-time setup creates the `index_access` row. Subsequent calls
 * update the hash + salt + `updatedAt`. Session state (token/expiry)
 * is NOT reset — caller should lockIndex() after changing if that's
 * the desired behavior.
 */
export async function setPasscode(params: {
  userId: string
  workspaceId: string
  passcode: string
}): Promise<{ success: boolean }> {
  const salt = randomBytes(16).toString('hex')
  const hash = hashPasscode(params.passcode, salt)

  const existing = await findAccess(params.userId)

  if (existing) {
    await db
      .update(indexAccess)
      .set({
        passcodeHash: hash,
        passcodeSalt: salt,
        updatedAt: new Date(),
      })
      .where(eq(indexAccess.id, existing.id))
  } else {
    await db.insert(indexAccess).values({
      userId: params.userId,
      workspaceId: params.workspaceId,
      passcodeHash: hash,
      passcodeSalt: salt,
      isLocked: true,
    })
  }

  return { success: true }
}

/**
 * Unlock the index with a passcode. Returns a session token on success.
 */
export async function unlockIndex(params: {
  userId: string
  passcode: string
}): Promise<{ success: boolean; sessionToken?: string; expiresAt?: Date }> {
  const access = await findAccess(params.userId)
  if (!access || !access.passcodeHash || !access.passcodeSalt) {
    return { success: false }
  }

  const hash = hashPasscode(params.passcode, access.passcodeSalt)
  if (hash !== access.passcodeHash) {
    return { success: false }
  }

  const sessionToken = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)

  await db
    .update(indexAccess)
    .set({
      sessionToken,
      sessionExpiresAt: expiresAt,
      isLocked: false,
      updatedAt: new Date(),
    })
    .where(eq(indexAccess.id, access.id))

  return { success: true, sessionToken, expiresAt }
}

/**
 * Lock the index explicitly. Clears the session token.
 */
export async function lockIndex(userId: string): Promise<void> {
  await db
    .update(indexAccess)
    .set({
      sessionToken: null,
      sessionExpiresAt: null,
      isLocked: true,
      updatedAt: new Date(),
    })
    .where(eq(indexAccess.userId, userId))
}

/**
 * Validate a session token. Returns true iff the index is unlocked,
 * the token matches, and the session hasn't expired. Expired sessions
 * auto-lock as a side effect.
 */
export async function validateSession(params: {
  userId: string
  sessionToken: string
}): Promise<boolean> {
  const access = await findAccess(params.userId)
  if (!access || access.isLocked) return false
  if (!access.sessionToken || access.sessionToken !== params.sessionToken) return false
  if (!access.sessionExpiresAt || access.sessionExpiresAt < new Date()) {
    await lockIndex(params.userId)
    return false
  }
  return true
}

/**
 * Extend the session on activity. Pushes `sessionExpiresAt` forward
 * by `SESSION_DURATION_MS` if the index is unlocked and has a token.
 */
export async function extendSession(userId: string): Promise<void> {
  const access = await findAccess(userId)
  if (access && !access.isLocked && access.sessionToken) {
    await db
      .update(indexAccess)
      .set({
        sessionExpiresAt: new Date(Date.now() + SESSION_DURATION_MS),
        updatedAt: new Date(),
      })
      .where(eq(indexAccess.id, access.id))
  }
}

/**
 * Check if a user has set up a passcode (for onboarding flow).
 */
export async function hasPasscode(userId: string): Promise<boolean> {
  const access = await findAccess(userId)
  return !!access?.passcodeHash
}

/**
 * Get the current lock state (for UI display).
 * Returns a default state (locked, no passcode, balanced preset) for
 * users who have no `index_access` row yet.
 */
export async function getIndexLockState(userId: string): Promise<{
  hasPasscode: boolean
  isLocked: boolean
  lockPolicy: string
  activePreset: string
  sessionExpiresAt: Date | null
}> {
  const access = await findAccess(userId)

  if (!access) {
    return {
      hasPasscode: false,
      isLocked: true,
      lockPolicy: 'on_idle',
      activePreset: 'balanced',
      sessionExpiresAt: null,
    }
  }

  return {
    hasPasscode: !!access.passcodeHash,
    isLocked: access.isLocked,
    lockPolicy: access.lockPolicy,
    activePreset: access.activePreset,
    sessionExpiresAt: access.sessionExpiresAt,
  }
}
