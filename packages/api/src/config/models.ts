/**
 * OpenRouter Model Registry
 *
 * All AI calls route through OpenRouter using free or ultra-low-cost models.
 * Model handles use the OpenRouter provider/model format.
 *
 * Runtime overrides: the MODEL_TIERS map below is exported as a Proxy so
 * call sites like `MODEL_TIERS.CHAT_AGENT` automatically pick up whatever is
 * configured in data/model-overrides.json (editable via the dev dashboard).
 * Defaults live in DEFAULT_MODEL_TIERS.
 */

import { resolveModel } from './model-overrides'

// ─── Pipeline-role models (the 5 LLM roles from §06 of the v5.2 doc) ───────
// Verified 2026-04-29 against OpenRouter's /api/v1/models. Each role gets
// the model that fits its volume/quality tradeoff:
//   - REPORTER  — every event, free tier
//   - ANALYST   — the wedge (edge classification), strongest reasoner
//   - EDITOR    — calibrated 0-1 scoring, cheap fast model with low temp
//   - ARCHIVIST — runs every 5 min + session start/end, cheap reasoning
//   - PROFILER  — session start/end + daily 14d slice, larger context
const REPORTER_MODEL = 'google/gemma-4-31b-it:free'
const ANALYST_MODEL = 'deepseek/deepseek-v4-pro'
const EDITOR_MODEL = 'qwen/qwen3.5-flash-02-23'
const ARCHIVIST_MODEL = 'deepseek/deepseek-v4-flash'
const PROFILER_MODEL = 'qwen/qwen3.5-122b-a10b'

// All other (auxiliary) tiers default to a single free model.
const GEMMA_FREE = 'google/gemma-4-31b-it:free'

export const DEFAULT_MODEL_TIERS = {
  // ─── 5 canonical pipeline roles (§06 of product doc) ─────────────────────
  REPORTER: REPORTER_MODEL,
  ANALYST: ANALYST_MODEL,
  EDITOR: EDITOR_MODEL,
  ARCHIVIST: ARCHIVIST_MODEL,
  PROFILER: PROFILER_MODEL,

  // ─── User-facing assistant (separate from the indexing pipeline) ─────────
  CHAT_AGENT: GEMMA_FREE,
  CHAT_AGENT_VISION: GEMMA_FREE,

  // ─── Reference agent (active recall) ─────────────────────────────────────
  // The query classifier that gates the whole recall pipeline. Uses the
  // strongest reasoner (deepseek-v4-pro, same model as ANALYST) for accurate
  // intent detection. It's a reasoning model, so its call site budgets extra
  // completion tokens for the reasoning preamble — see
  // services/reference-agent/classifier.ts.
  REFERENCE_CLASSIFY: ANALYST_MODEL,

  // ─── Auxiliary tools — not in the pipeline ───────────────────────────────
  // MICRO_SUMMARY: chunk enrichment in the indexing agent, memory section
  // generation, and NL parsing (query/nl-parser, scope/scope-builder).
  // INDEX_AGENT: the indexing agent's own summarization calls.
  MICRO_SUMMARY: GEMMA_FREE,
  INDEX_AGENT: GEMMA_FREE,
} as const

/**
 * Tiers actively called by live code paths.
 *
 * The 5 pipeline roles (REPORTER..PROFILER) are listed first and represent
 * the canonical cognitive pipeline. CHAT_AGENT + CHAT_AGENT_VISION are the
 * user-facing assistant. Every registered tier has a live call site; the
 * tiers for removed surfaces (capture, doc-intelligence, browser nav,
 * threads, notebooks, summaries) were pruned in CLEANUP-1 (2026-07-24).
 */
export const ACTIVE_TIERS = [
  // 5 pipeline roles
  'REPORTER',
  'ANALYST',
  'EDITOR',
  'ARCHIVIST',
  'PROFILER',
  // user-facing assistant
  'CHAT_AGENT',
  'CHAT_AGENT_VISION',
  // reference agent (active recall)
  'REFERENCE_CLASSIFY',
  // auxiliary tools
  'MICRO_SUMMARY',
  'INDEX_AGENT',
] as const

export type ModelTier = keyof typeof DEFAULT_MODEL_TIERS

/**
 * MODEL_TIERS is a live view over DEFAULT_MODEL_TIERS + runtime overrides.
 * Reading `MODEL_TIERS.INDEX_AGENT` consults data/model-overrides.json first.
 */
export const MODEL_TIERS = new Proxy(DEFAULT_MODEL_TIERS, {
  get(target, prop: string | symbol): string | undefined {
    if (typeof prop !== 'string') return undefined
    const fallback = (target as Record<string, string>)[prop]
    if (fallback === undefined) return undefined
    return resolveModel(prop, fallback)
  },
  // Make ownKeys / getOwnPropertyDescriptor transparent so Object.keys/entries
  // and for..in still work against the default map.
  ownKeys(target) {
    return Reflect.ownKeys(target)
  },
  getOwnPropertyDescriptor(target, prop) {
    return Reflect.getOwnPropertyDescriptor(target, prop)
  },
}) as unknown as typeof DEFAULT_MODEL_TIERS

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

/**
 * List every tier with its default + currently-effective model (post-override).
 * Used by the dashboard Models tab.
 */
export function listTiers(): Array<{
  tier: ModelTier
  defaultModel: string
  currentModel: string
  active: boolean
}> {
  const activeSet = new Set<string>(ACTIVE_TIERS)
  return (Object.keys(DEFAULT_MODEL_TIERS) as ModelTier[]).map((tier) => ({
    tier,
    defaultModel: DEFAULT_MODEL_TIERS[tier],
    currentModel: MODEL_TIERS[tier],
    active: activeSet.has(tier),
  }))
}
