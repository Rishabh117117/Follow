/**
 * Models Router — dev dashboard model tier management.
 *
 * GET  /api/models              → list tiers with default + current model + usage
 * GET  /api/models/overrides    → current overrides map
 * PUT  /api/models/overrides    → replace overrides map (requires dashboard token)
 * POST /api/models/reset/:tier  → clear one tier's override
 */
import { Hono } from 'hono'
import { listTiers, DEFAULT_MODEL_TIERS, type ModelTier } from '../config/models'
import { getTierPrompt, PIPELINE_ROLES } from '../config/model-tier-prompts'
import { loadOverrides, saveOverrides } from '../config/model-overrides'
import { dashboardTokenMiddleware } from '../middleware/dashboard-token'
import { sql } from 'drizzle-orm'
import { db } from '../db/index'
import { llmUsage } from '../db/schema/llm-usage'
import { startOfMonth } from '../lib/llm-logger'
import { gte } from 'drizzle-orm'

export const modelsRouter = new Hono()

// Read-only: list tiers with per-tier usage-this-month (no token required).
modelsRouter.get('/', async (c) => {
  const tiers = listTiers()

  // Usage per tier this month
  let usageByTier = new Map<string, { cost: number; calls: number; tokens: number }>()
  try {
    const rows = await db
      .select({
        tier: llmUsage.modelTier,
        cost: sql<number>`COALESCE(SUM(${llmUsage.costUsd}), 0)`,
        calls: sql<number>`COUNT(*)`,
        tokens: sql<number>`COALESCE(SUM(${llmUsage.inputTokens} + ${llmUsage.outputTokens}), 0)`,
      })
      .from(llmUsage)
      .where(gte(llmUsage.createdAt, startOfMonth()))
      .groupBy(llmUsage.modelTier)
    for (const r of rows) {
      usageByTier.set(String(r.tier), {
        cost: Number(r.cost ?? 0),
        calls: Number(r.calls ?? 0),
        tokens: Number(r.tokens ?? 0),
      })
    }
  } catch {
    /* table may not exist yet */
  }

  const overrides = loadOverrides()

  const data = tiers.map((t) => {
    const prompt = getTierPrompt(t.tier)
    return {
      tier: t.tier,
      defaultModel: t.defaultModel,
      currentModel: t.currentModel,
      isOverridden: !!overrides[t.tier],
      active: t.active,
      usageThisMonth: usageByTier.get(t.tier) ?? { cost: 0, calls: 0, tokens: 0 },
      // Static system-prompt registry; absent for unused tiers.
      promptPurpose: prompt?.purpose ?? null,
      promptVariants: prompt?.variants ?? [],
    }
  })

  return c.json({ data, error: null })
})

// Pipeline view — 7 stages, 5 LLM roles. Joins each role's prompt(s) with
// the tier's live usage so the dashboard can show "Reporter: X calls this
// month" without the consumer having to merge two payloads.
modelsRouter.get('/pipeline', async (c) => {
  let usageByTier = new Map<string, { cost: number; calls: number; tokens: number }>()
  try {
    const rows = await db
      .select({
        tier: llmUsage.modelTier,
        cost: sql<number>`COALESCE(SUM(${llmUsage.costUsd}), 0)`,
        calls: sql<number>`COUNT(*)`,
        tokens: sql<number>`COALESCE(SUM(${llmUsage.inputTokens} + ${llmUsage.outputTokens}), 0)`,
      })
      .from(llmUsage)
      .where(gte(llmUsage.createdAt, startOfMonth()))
      .groupBy(llmUsage.modelTier)
    for (const r of rows) {
      usageByTier.set(String(r.tier), {
        cost: Number(r.cost ?? 0),
        calls: Number(r.calls ?? 0),
        tokens: Number(r.tokens ?? 0),
      })
    }
  } catch {
    /* table may not exist yet */
  }

  const data = PIPELINE_ROLES.map((stage) => {
    // Aggregate calls/cost across every tier this stage's prompts route through
    const tiers = Array.from(new Set(stage.prompts.map((p) => p.tier)))
    const usage = tiers.reduce(
      (acc, t) => {
        const u = usageByTier.get(t)
        if (u) {
          acc.cost += u.cost
          acc.calls += u.calls
          acc.tokens += u.tokens
        }
        return acc
      },
      { cost: 0, calls: 0, tokens: 0 }
    )
    return { ...stage, tiers, usageThisMonth: usage }
  })

  return c.json({ data, error: null })
})

modelsRouter.get('/overrides', async (c) => {
  return c.json({ data: loadOverrides(), error: null })
})

// Mutating endpoints require the dashboard token.
modelsRouter.put('/overrides', dashboardTokenMiddleware, async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'JSON body required' } },
      400
    )
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'Object of tier→model required' } },
      400
    )
  }

  const next: Record<string, string> = {}
  const validTiers = new Set(Object.keys(DEFAULT_MODEL_TIERS))
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!validTiers.has(k)) continue
    if (typeof v !== 'string') continue
    const trimmed = v.trim()
    if (!trimmed) continue
    // Skip if it equals the default — no need to persist it
    if (trimmed === DEFAULT_MODEL_TIERS[k as ModelTier]) continue
    next[k] = trimmed
  }
  saveOverrides(next)
  return c.json({ data: { overrides: next, count: Object.keys(next).length }, error: null })
})

modelsRouter.post('/reset/:tier', dashboardTokenMiddleware, async (c) => {
  const tier = c.req.param('tier')
  if (!(tier in DEFAULT_MODEL_TIERS)) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: `Unknown tier: ${tier}` } },
      404
    )
  }
  const current = loadOverrides()
  delete current[tier]
  saveOverrides(current)
  return c.json({
    data: { tier, resetTo: DEFAULT_MODEL_TIERS[tier as ModelTier] },
    error: null,
  })
})

modelsRouter.post('/reset-all', dashboardTokenMiddleware, async (c) => {
  saveOverrides({})
  return c.json({ data: { ok: true }, error: null })
})
