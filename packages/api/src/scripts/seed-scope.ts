/**
 * Scope seed (Sprint SCOPE-LIVECTX-1)
 *
 * Creates 2 reusable scope presets and 1 active scope session for the dev
 * user. Idempotent — re-running the script cleans up prior rows first so
 * local dev doesn't accumulate duplicate presets.
 *
 * Usage:
 *   pnpm --filter @workspace/api tsx src/scripts/seed-scope.ts
 */

import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
config({ path: resolve(__dir, '.env.local') })
config({ path: resolve(__dir, '.env') })

import { and, eq } from 'drizzle-orm'
import { db } from '../db/index'
import { scopeDefinitions, scopeSessions } from '../db/schema/scope'
import { DEV_USER, DEV_WORKSPACE } from '@workspace/shared/constants'
import type { Boundary } from '../services/scope/types'

async function main() {
  const userId = DEV_USER.id
  const workspaceId = DEV_WORKSPACE.id

  // Clean up any previous SCOPE-LIVECTX-1 seed artifacts.
  await db
    .delete(scopeDefinitions)
    .where(and(eq(scopeDefinitions.userId, userId), eq(scopeDefinitions.workspaceId, workspaceId)))
  await db
    .delete(scopeSessions)
    .where(and(eq(scopeSessions.userId, userId), eq(scopeSessions.workspaceId, workspaceId)))

  const capstoneBoundaries: Boundary[] = [
    { dimension: 'confidence', op: 'gte', value: 0.8 },
    { dimension: 'time', op: 'within', window: { type: 'relative', days: 14 } },
    { dimension: 'topic', op: 'include', values: ['capstone'] },
  ]

  const unrestrictedBoundaries: Boundary[] = []

  const capstone = await db
    .insert(scopeDefinitions)
    .values({
      userId,
      workspaceId,
      name: 'Capstone · high-confidence · last 2 weeks',
      description:
        'High-confidence facts tagged "capstone" from the last 14 days. Good starting scope for capstone thread work.',
      boundaries: capstoneBoundaries,
      isPreset: true,
    })
    .returning({ id: scopeDefinitions.id })

  await db.insert(scopeDefinitions).values({
    userId,
    workspaceId,
    name: 'All indexes · unrestricted',
    description: 'No boundaries. Widest possible scope — use with intent.',
    boundaries: unrestrictedBoundaries,
    isPreset: true,
  })

  // One active session pointing at the capstone preset.
  if (capstone[0]) {
    await db.insert(scopeSessions).values({
      userId,
      workspaceId,
      sessionToken: `mcp:${userId}:${workspaceId}`,
      scopeId: capstone[0].id,
      inlineBoundaries: null,
      mode: 'static',
      paused: false,
    })
  }

  console.info('[seed-scope] Created 2 presets + 1 active session for dev user.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-scope] failed:', err)
    process.exit(1)
  })
