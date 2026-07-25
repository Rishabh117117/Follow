/**
 * Saved Queries seed (Sprint V41-QUERY-1)
 *
 * Creates 3 example saved queries for the dev user. Idempotent —
 * deletes prior dev-user saved queries first to avoid duplication.
 *
 * Usage:
 *   pnpm --filter @workspace/api tsx src/scripts/seed-queries.ts
 */

import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
config({ path: resolve(__dir, '.env.local') })
config({ path: resolve(__dir, '.env') })

import { and, eq } from 'drizzle-orm'
import { db } from '../db/index'
import { savedQueries } from '../db/schema/query'
import { DEV_USER, DEV_WORKSPACE } from '@workspace/shared/constants'
import type { Boundary } from '../services/scope/types'
import type { SelectSpec } from '../services/query/types'

async function main() {
  const userId = DEV_USER.id
  const workspaceId = DEV_WORKSPACE.id

  await db
    .delete(savedQueries)
    .where(and(eq(savedQueries.userId, userId), eq(savedQueries.workspaceId, workspaceId)))

  const baseSelect: SelectSpec = {
    fields: ['id', 'content', 'contributor', 'confidence', 'createdAt'],
    limit: 100,
    orderBy: { field: 'createdAt', direction: 'desc' },
  }

  const queries: Array<{
    name: string
    description: string
    boundaries: Boundary[]
    isPinned: boolean
  }> = [
    {
      name: 'Contested facts in Capstone',
      description: 'Facts with an edge marking them as contradicted, within the capstone topic.',
      boundaries: [
        { dimension: 'edge_type', op: 'include', values: ['contradicts'] },
        { dimension: 'topic', op: 'include', values: ['capstone'] },
      ],
      isPinned: true,
    },
    {
      name: "Priya's high-confidence recent work",
      description: 'Contributor = priya, confidence ≥ 0.9, within the last 14 days.',
      boundaries: [
        { dimension: 'contributor', op: 'include', values: ['priya'] },
        { dimension: 'confidence', op: 'gte', value: 0.9 },
        { dimension: 'time', op: 'within', window: { type: 'relative', days: 14 } },
      ],
      isPinned: false,
    },
    {
      name: 'Superseded team-size versions',
      description: 'Facts about team-size that have been superseded by later versions.',
      boundaries: [
        { dimension: 'topic', op: 'include', values: ['team-size'] },
        { dimension: 'freshness', op: 'include', values: ['include_superseded'] },
      ],
      isPinned: false,
    },
  ]

  for (const q of queries) {
    await db.insert(savedQueries).values({
      userId,
      workspaceId,
      name: q.name,
      description: q.description,
      boundaries: q.boundaries,
      selectSpec: baseSelect,
      aggregations: null,
      isPinned: q.isPinned,
    })
  }

  console.info(`[seed-queries] Created ${queries.length} saved queries for dev user.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-queries] failed:', err)
    process.exit(1)
  })
