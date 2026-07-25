/**
 * OpenRouter Router — proxies live account + catalogue data for the dev dashboard.
 *
 * GET /api/openrouter/credits            → balance / usage / remaining (60s cache)
 * GET /api/openrouter/models             → catalogue with per-1M prices (10min cache)
 * GET /api/openrouter/models?search=foo  → substring filter on the catalogue
 * POST /api/openrouter/refresh           → force-refresh both caches (dashboard token)
 * GET /api/openrouter/usage              → merged aggregations (local costs + OR credits)
 */
import { Hono } from 'hono'
import { getCredits, getModelCatalogue, refreshAll } from '../services/openrouter-stats'
import { dashboardTokenMiddleware } from '../middleware/dashboard-token'
import {
  sumCostsSince,
  groupCostsByModel,
  groupCostsByTier,
  groupCostsBySource,
  getRecentCalls,
  getHourlyCostSeries,
  startOfToday,
  startOfMonth,
} from '../lib/llm-logger'

export const openrouterRouter = new Hono()

openrouterRouter.get('/credits', async (c) => {
  const creds = await getCredits()
  if (!creds) {
    return c.json(
      {
        data: null,
        error: { code: 'UNAVAILABLE', message: 'OpenRouter credits unavailable (key missing or request failed)' },
      },
      503
    )
  }
  return c.json({ data: creds, error: null })
})

openrouterRouter.get('/models', async (c) => {
  const search = (c.req.query('search') ?? '').trim().toLowerCase()
  const onlyFree = c.req.query('free') === '1'
  const all = await getModelCatalogue()
  const filtered = all.filter((m) => {
    if (onlyFree && !m.isFree) return false
    if (!search) return true
    return m.id.toLowerCase().includes(search) || m.name.toLowerCase().includes(search)
  })
  return c.json({ data: filtered, error: null, total: all.length })
})

openrouterRouter.post('/refresh', dashboardTokenMiddleware, async (c) => {
  await refreshAll()
  return c.json({ data: { ok: true }, error: null })
})

/**
 * Merged usage view: local LLM usage totals (from our llm_usage table)
 * plus live OpenRouter credits. This is the one endpoint the dashboard
 * Usage tab polls.
 */
openrouterRouter.get('/usage', async (c) => {
  const today = startOfToday()
  const month = startOfMonth()

  const [
    credits,
    costToday,
    costMonth,
    byModel,
    byTier,
    bySource,
    recent,
    hourly,
  ] = await Promise.all([
    getCredits(),
    sumCostsSince(today),
    sumCostsSince(month),
    groupCostsByModel(month),
    groupCostsByTier(month),
    groupCostsBySource(month),
    getRecentCalls(25),
    getHourlyCostSeries(24),
  ])

  return c.json({
    data: {
      credits,
      local: {
        today: costToday,
        thisMonth: costMonth,
        byModel,
        byTier,
        bySource,
        hourly,
        recent,
      },
    },
    error: null,
  })
})
