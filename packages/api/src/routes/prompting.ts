import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth'
import {
  getPendingCards,
  handleCardResponse,
  dismissAllCards,
} from '../services/prompting/pipeline'
import { getProfile, updatePreferences } from '../services/prompting/user-profiler'
import { getRecentTriggers } from '../services/prompting/trigger-monitor'
import { assertWorkspaceAccess } from '../services/workspace-access'

const promptingRouter = new Hono()
promptingRouter.use('*', authMiddleware)

// ─── Schemas ────────────────────────────────────────────────────────

const CardResponseSchema = z.object({
  cardId: z.string(),
  optionId: z.string(),
  responseTimeMs: z.number().min(0),
})

const PreferencesSchema = z.object({
  maxPromptsPerHour: z.number().min(0).max(10).optional(),
  preferredDetailLevel: z.enum(['minimal', 'standard', 'detailed']).optional(),
  quietHoursStart: z.number().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.number().min(0).max(23).nullable().optional(),
  disabledTriggers: z.array(z.string()).optional(),
})

// ─── Routes ─────────────────────────────────────────────────────────

// Get pending prompt cards (polling fallback)
promptingRouter.get('/cards', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'MISSING_PARAM', message: 'workspaceId required' } },
      400
    )
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const cards = getPendingCards(workspaceId, userId)
  return c.json({ data: cards, error: null })
})

// Respond to a prompt card
promptingRouter.post('/cards/respond', zValidator('json', CardResponseSchema), async (c) => {
  const userId = c.get('userId')
  const body = c.req.valid('json')
  const workspaceId = c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'MISSING_PARAM', message: 'workspaceId required' } },
      400
    )
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const result = handleCardResponse(
    workspaceId,
    userId,
    body.cardId,
    body.optionId,
    body.responseTimeMs
  )
  return c.json({ data: result, error: null })
})

// Dismiss all cards
promptingRouter.post('/cards/dismiss-all', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'MISSING_PARAM', message: 'workspaceId required' } },
      400
    )
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  dismissAllCards(workspaceId, userId)
  return c.json({ data: { dismissed: true }, error: null })
})

// Get user prompt profile
promptingRouter.get('/profile', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'MISSING_PARAM', message: 'workspaceId required' } },
      400
    )
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const profile = getProfile(workspaceId, userId)
  return c.json({ data: profile, error: null })
})

// Update prompt preferences
promptingRouter.patch('/profile/preferences', zValidator('json', PreferencesSchema), async (c) => {
  const userId = c.get('userId')
  const body = c.req.valid('json')
  const workspaceId = c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'MISSING_PARAM', message: 'workspaceId required' } },
      400
    )
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  updatePreferences(workspaceId, userId, body)
  const profile = getProfile(workspaceId, userId)
  return c.json({ data: profile, error: null })
})

// Get recent triggers (debug/admin)
promptingRouter.get('/triggers', async (c) => {
  const userId = c.get('userId')
  const workspaceId = c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json(
      { data: null, error: { code: 'MISSING_PARAM', message: 'workspaceId required' } },
      400
    )
  }

  const denied = await assertWorkspaceAccess(c, workspaceId)
  if (denied) return denied

  const triggers = getRecentTriggers(workspaceId, userId)
  return c.json({ data: triggers, error: null })
})

export { promptingRouter }
