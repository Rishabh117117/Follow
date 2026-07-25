/**
 * Dev User Seed
 *
 * Idempotent seed function that ensures the dev user, workspace, membership,
 * and user profile exist in the database when DEV_BYPASS_AUTH=true.
 *
 * Uses Drizzle ORM with onConflictDoNothing() so it's safe to run on every
 * server startup — existing rows are left untouched.
 */

import { db } from './index'
import { users, userProfiles } from './schema/users'
import { workspaces, workspaceMembers } from './schema/workspaces'
import { and, eq } from 'drizzle-orm'
import { DEV_USER, DEV_WORKSPACE, DEV_USER_PROFILE_ID } from '@workspace/shared/constants'

export async function seedDevUser(): Promise<void> {
  try {
    // 1. User
    await db
      .insert(users)
      .values({
        id: DEV_USER.id,
        email: DEV_USER.email,
        name: DEV_USER.name,
      })
      .onConflictDoNothing()

    // 2. Workspace
    await db
      .insert(workspaces)
      .values({
        id: DEV_WORKSPACE.id,
        name: DEV_WORKSPACE.name,
        slug: DEV_WORKSPACE.slug,
        ownerId: DEV_USER.id,
      })
      .onConflictDoNothing()

    // 3. Workspace membership (owner role) — check first since there's no unique constraint on (workspaceId, userId)
    const existingMembership = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, DEV_WORKSPACE.id),
          eq(workspaceMembers.userId, DEV_USER.id)
        )
      )
      .limit(1)

    if (existingMembership.length === 0) {
      await db.insert(workspaceMembers).values({
        workspaceId: DEV_WORKSPACE.id,
        userId: DEV_USER.id,
        role: 'owner',
      })
    }

    // 4. User profile
    await db
      .insert(userProfiles)
      .values({
        id: DEV_USER_PROFILE_ID,
        workspaceId: DEV_WORKSPACE.id,
        userId: DEV_USER.id,
      })
      .onConflictDoNothing()

    console.info('[Seed] Dev user "user1dev" seeded successfully')
  } catch (err) {
    // Non-fatal — PGlite may have already seeded via raw SQL
    console.warn('[Seed] Dev user seed encountered an issue (non-fatal):', (err as Error).message)
  }
}
