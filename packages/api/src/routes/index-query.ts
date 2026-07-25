/**
 * Semantic Index Query API (Sprint IX-1 + IX-2)
 *
 * POST /api/index/query — Single retrieval endpoint for the semantic index.
 *
 * Supports 6 query types via weight profiles:
 *   history, focused, realtime, ai_usage, proactive, evidence
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth'
import { executeIndexQuery } from '../services/semantic-index/query-executor'
import { assertWorkspaceAccess } from '../services/workspace-access'

// ─── Validation ──────────────────────────────────────────────────────────────

const QuerySchema = z.object({
  query: z.string().min(1).max(2000).optional(),
  workspaceId: z.string().uuid(),
  weightProfile: z
    .enum(['history', 'focused', 'realtime', 'ai_usage', 'proactive', 'evidence'])
    .optional()
    .default('history'),
  documentId: z.string().uuid().optional(),
  targetSection: z.string().optional(),
  threadTypes: z.array(z.string()).optional(),
  strandId: z.string().uuid().optional(),
  episodeId: z.string().uuid().optional(),
  timeRangeMinutes: z.number().positive().optional(),
  magnitudeMin: z.enum(['small', 'medium', 'large']).optional(),
  aiOnly: z.boolean().optional(),
  includeEvidence: z.boolean().optional().default(false),
  includeEpisodes: z.boolean().optional().default(false),
  includeSummary: z.boolean().optional().default(false),
  includeHidden: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(200).optional().default(50),
})

// ─── Route ───────────────────────────────────────────────────────────────────

export const indexQueryRouter = new Hono()
indexQueryRouter.use('*', authMiddleware)

indexQueryRouter.post('/query', zValidator('json', QuerySchema), async (c) => {
  const body = c.req.valid('json')
  const userId = c.get('userId') as string

  const denied = await assertWorkspaceAccess(c, body.workspaceId)
  if (denied) return denied

  const result = await executeIndexQuery({
    ...body,
    userId,
  })

  return c.json({ data: result, error: null })
})
