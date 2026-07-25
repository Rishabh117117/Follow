/**
 * Discover seed (Sprint V41-DISCOVER-1)
 *
 * Opts 2 seeded spaces into discoverable=true and creates a third
 * "Design Research" space for the dev user to give the similarity
 * algorithm something to compare against. Idempotent.
 *
 * Usage:
 *   pnpm --filter @workspace/api tsx src/scripts/seed-discover.ts
 */

import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
config({ path: resolve(__dir, '.env.local') })
config({ path: resolve(__dir, '.env') })

import { and, eq, ne, sql } from 'drizzle-orm'
import { db } from '../db/index'
import { spaces } from '../db/schema/spaces'
import { DEV_USER, DEV_WORKSPACE } from '@workspace/shared/constants'

async function main() {
  const userId = DEV_USER.id
  const workspaceId = DEV_WORKSPACE.id

  // ─── Ensure the "Design Research" seed space exists ─────────────────────
  const existing = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.name, 'Design Research')))
    .limit(1)

  if (!existing[0]) {
    await db.insert(spaces).values({
      workspaceId,
      name: 'Design Research',
      description: 'Seeded by V41-DISCOVER-1. Discoverable at workspace scope.',
      isProject: true,
      discoverable: true,
      discoverableAt: new Date(),
      discoverableScope: 'workspace',
      createdBy: userId,
    })
  } else {
    await db
      .update(spaces)
      .set({
        discoverable: true,
        discoverableAt: new Date(),
        discoverableScope: 'workspace',
      })
      .where(eq(spaces.id, existing[0].id))
  }

  // ─── Opt any 2 other existing project spaces into discoverable=true ─────
  const others = await db
    .select({ id: spaces.id, name: spaces.name })
    .from(spaces)
    .where(
      and(
        eq(spaces.workspaceId, workspaceId),
        eq(spaces.isProject, true),
        ne(spaces.name, 'Design Research'),
        sql`${spaces.deletedAt} IS NULL`
      )
    )
    .limit(2)

  for (const s of others) {
    await db
      .update(spaces)
      .set({
        discoverable: true,
        discoverableAt: new Date(),
        discoverableScope: 'workspace',
      })
      .where(eq(spaces.id, s.id))
  }

  console.info(
    `[seed-discover] Made "Design Research" + ${others.length} additional space(s) discoverable for dev user.`
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-discover] failed:', err)
    process.exit(1)
  })
