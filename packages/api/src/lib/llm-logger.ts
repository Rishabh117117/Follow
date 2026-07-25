/**
 * LLM Usage Logger (Sprint WIRE-1)
 *
 * Non-blocking utility to record every LLM call with token counts + cost.
 * Wire into chat/completion, embedding, and reference-agent services.
 *
 * Usage:
 *   logLLMUsage({
 *     userId, model: 'gemini-2.5-flash', modelTier: 'CHAT_AGENT',
 *     inputTokens: 1000, outputTokens: 500, source: 'chat',
 *   }).catch(console.error)
 */

import { db } from '../db/index'
import { llmUsage } from '../db/schema/llm-usage'
import { sql, gte, desc } from 'drizzle-orm'

// Per-million token pricing (USD). Values mirror OpenRouter's catalogue
// (see services/openrouter-stats.ts for the live source). Used as a fallback
// when the live catalogue isn't reachable at call time.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Gemini (OpenRouter)
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.0-flash-exp': { input: 0.15, output: 0.6 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  // DeepSeek
  // CONTRADICT-1: the ANALYST tier (deepseek/deepseek-v4-pro) had no entry →
  // calculateCost returned 0, so llm_usage.cost_usd under-reported ANALYST spend.
  // Pricing per OpenRouter ($0.435 / $0.870 per Mtok).
  'deepseek-v4-pro': { input: 0.435, output: 0.87 },
  'deepseek-v3': { input: 0.27, output: 1.1 },
  'deepseek-chat': { input: 0.2, output: 0.77 },
  'deepseek-chat-v3-0324': { input: 0.2, output: 0.77 },
  'deepseek-r1': { input: 0.55, output: 2.19 },
  'deepseek-r1-distill-qwen-32b': { input: 0, output: 0 }, // :free tier
  // Llama free
  'llama-3.3-70b-instruct': { input: 0, output: 0 }, // :free tier
  // OpenAI
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
  o3: { input: 10, output: 40 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'o4-mini': { input: 1.1, output: 4.4 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  // Anthropic
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  'claude-opus-4-5': { input: 15, output: 75 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
}

/** Calculate cost in USD for a given model + token counts. */
export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const needle = model.toLowerCase()
  // Strip OpenRouter provider prefix (e.g. "google/gemini-2.5-flash" → "gemini-2.5-flash")
  // and any :free / :beta suffix so the lookup works regardless of how the caller names it.
  const stripped = needle.split('/').pop()!.split(':')[0]!

  // Exact match first (against either the full id or the stripped id)
  let pricing = MODEL_PRICING[model] ?? MODEL_PRICING[stripped]
  // Fuzzy match: any key that's a prefix of the stripped model name
  if (!pricing) {
    const match = Object.keys(MODEL_PRICING).find((k) => stripped.startsWith(k.toLowerCase()))
    if (match) pricing = MODEL_PRICING[match]
  }
  if (!pricing) return 0

  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  return Number((inputCost + outputCost).toFixed(6))
}

export interface LogLLMUsageParams {
  userId: string
  model: string
  modelTier: string
  inputTokens: number
  outputTokens: number
  source: string
}

export async function logLLMUsage(params: LogLLMUsageParams): Promise<void> {
  const costUsd = calculateCost(params.model, params.inputTokens, params.outputTokens)
  try {
    await db.insert(llmUsage).values({
      userId: params.userId,
      model: params.model,
      modelTier: params.modelTier,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      costUsd,
      source: params.source,
    })
  } catch (err) {
    // Never block on logging failures
    console.warn('[LLMLogger] Failed to log usage:', err instanceof Error ? err.message : err)
  }
}

// ─── Aggregation helpers (for /api/health) ────────────────────────────

export async function sumCostsSince(since: Date): Promise<number> {
  try {
    const [row] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${llmUsage.costUsd}), 0)`,
      })
      .from(llmUsage)
      .where(gte(llmUsage.createdAt, since))
    return Number(row?.total ?? 0)
  } catch {
    return 0
  }
}

export interface CostByModel {
  model: string
  cost: number
  calls: number
  tokens: number
}

export async function groupCostsByModel(since: Date): Promise<CostByModel[]> {
  try {
    const rows = await db
      .select({
        model: llmUsage.model,
        cost: sql<number>`COALESCE(SUM(${llmUsage.costUsd}), 0)`,
        calls: sql<number>`COUNT(*)`,
        tokens: sql<number>`COALESCE(SUM(${llmUsage.inputTokens} + ${llmUsage.outputTokens}), 0)`,
      })
      .from(llmUsage)
      .where(gte(llmUsage.createdAt, since))
      .groupBy(llmUsage.model)
    return rows.map((r) => ({
      model: String(r.model),
      cost: Number(r.cost ?? 0),
      calls: Number(r.calls ?? 0),
      tokens: Number(r.tokens ?? 0),
    }))
  } catch {
    return []
  }
}

export function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function startOfMonth(): Date {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

// ─── Extended aggregations (dashboard Usage tab) ───────────────────────

export interface CostByTier {
  tier: string
  cost: number
  calls: number
  tokens: number
}

export async function groupCostsByTier(since: Date): Promise<CostByTier[]> {
  try {
    const rows = await db
      .select({
        tier: llmUsage.modelTier,
        cost: sql<number>`COALESCE(SUM(${llmUsage.costUsd}), 0)`,
        calls: sql<number>`COUNT(*)`,
        tokens: sql<number>`COALESCE(SUM(${llmUsage.inputTokens} + ${llmUsage.outputTokens}), 0)`,
      })
      .from(llmUsage)
      .where(gte(llmUsage.createdAt, since))
      .groupBy(llmUsage.modelTier)
    return rows.map((r) => ({
      tier: String(r.tier ?? 'unknown'),
      cost: Number(r.cost ?? 0),
      calls: Number(r.calls ?? 0),
      tokens: Number(r.tokens ?? 0),
    }))
  } catch {
    return []
  }
}

export interface CostBySource {
  source: string
  cost: number
  calls: number
  tokens: number
}

export async function groupCostsBySource(since: Date): Promise<CostBySource[]> {
  try {
    const rows = await db
      .select({
        source: llmUsage.source,
        cost: sql<number>`COALESCE(SUM(${llmUsage.costUsd}), 0)`,
        calls: sql<number>`COUNT(*)`,
        tokens: sql<number>`COALESCE(SUM(${llmUsage.inputTokens} + ${llmUsage.outputTokens}), 0)`,
      })
      .from(llmUsage)
      .where(gte(llmUsage.createdAt, since))
      .groupBy(llmUsage.source)
    return rows.map((r) => ({
      source: String(r.source ?? 'unknown'),
      cost: Number(r.cost ?? 0),
      calls: Number(r.calls ?? 0),
      tokens: Number(r.tokens ?? 0),
    }))
  } catch {
    return []
  }
}

export interface RecentCall {
  id: string
  model: string
  modelTier: string
  source: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  createdAt: string
}

export async function getRecentCalls(limit = 25): Promise<RecentCall[]> {
  try {
    const rows = await db
      .select()
      .from(llmUsage)
      .orderBy(desc(llmUsage.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100))
    return rows.map((r) => ({
      id: String(r.id),
      model: String(r.model),
      modelTier: String(r.modelTier),
      source: String(r.source),
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      costUsd: Number(r.costUsd),
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }))
  } catch {
    return []
  }
}

/** Bucketed hourly totals over the last `hours` hours for sparkline rendering. */
export async function getHourlyCostSeries(
  hours = 24
): Promise<Array<{ hour: string; cost: number }>> {
  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000)
    const rows = await db
      .select({
        hour: sql<string>`DATE_TRUNC('hour', ${llmUsage.createdAt})::text`,
        cost: sql<number>`COALESCE(SUM(${llmUsage.costUsd}), 0)`,
      })
      .from(llmUsage)
      .where(gte(llmUsage.createdAt, since))
      .groupBy(sql`DATE_TRUNC('hour', ${llmUsage.createdAt})`)
      .orderBy(sql`DATE_TRUNC('hour', ${llmUsage.createdAt})`)
    return rows.map((r) => ({ hour: String(r.hour), cost: Number(r.cost ?? 0) }))
  } catch {
    return []
  }
}
