/**
 * OpenRouter Stats
 *
 * Proxies OpenRouter's account/catalogue endpoints with short-TTL caches
 * so the dev dashboard can show live credit balance + searchable model
 * list without hammering OpenRouter on every poll.
 */
import { OPENROUTER_BASE } from '../config/models'

// ─── Types ────────────────────────────────────────────────────────────────

export interface OpenRouterCredits {
  /** Total credits purchased (USD). */
  total: number
  /** Credits consumed so far (USD). */
  usage: number
  /** Remaining balance (USD). */
  remaining: number
  /** When this snapshot was fetched. */
  fetchedAt: string
}

export interface OpenRouterModelInfo {
  id: string
  name: string
  contextLength: number
  /** Cost per 1M tokens (USD). */
  pricing: { prompt: number; completion: number }
  /** Free-tier marker (id ends in `:free`). */
  isFree: boolean
}

// ─── Cache ────────────────────────────────────────────────────────────────

const CREDITS_TTL_MS = 60_000 // 1 min
const MODELS_TTL_MS = 10 * 60_000 // 10 min

let creditsCache: { at: number; value: OpenRouterCredits | null } = { at: 0, value: null }
let modelsCache: { at: number; value: OpenRouterModelInfo[] } = { at: 0, value: [] }

// ─── Helpers ──────────────────────────────────────────────────────────────

function apiKey(): string | null {
  const k = process.env['OPENROUTER_API_KEY']
  return k && k.trim() ? k.trim() : null
}

async function fetchJson<T>(path: string): Promise<T> {
  const key = apiKey()
  if (!key) throw new Error('OPENROUTER_API_KEY not configured')
  const res = await fetch(`${OPENROUTER_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': 'https://follow.app',
      'X-Title': 'Follow Workspace',
    },
  })
  if (!res.ok) {
    throw new Error(`OpenRouter ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  return (await res.json()) as T
}

// ─── Credits ──────────────────────────────────────────────────────────────

/**
 * Fetch OpenRouter credit balance. Cached for 60s. `force=true` bypasses cache.
 */
export async function getCredits(force = false): Promise<OpenRouterCredits | null> {
  const now = Date.now()
  if (!force && creditsCache.value && now - creditsCache.at < CREDITS_TTL_MS) {
    return creditsCache.value
  }
  try {
    // OpenRouter returns { data: { total_credits: number, total_usage: number } }
    const raw = await fetchJson<{ data?: { total_credits?: number; total_usage?: number } }>(
      '/credits'
    )
    const total = Number(raw?.data?.total_credits ?? 0)
    const usage = Number(raw?.data?.total_usage ?? 0)
    const value: OpenRouterCredits = {
      total,
      usage,
      remaining: Number((total - usage).toFixed(6)),
      fetchedAt: new Date().toISOString(),
    }
    creditsCache = { at: now, value }
    return value
  } catch (err) {
    console.warn('[openrouter-stats] getCredits failed:', (err as Error).message)
    // Return last-known on failure rather than null, so UI doesn't flicker.
    return creditsCache.value
  }
}

// ─── Models Catalogue ─────────────────────────────────────────────────────

interface RawModel {
  id: string
  name?: string
  context_length?: number
  pricing?: { prompt?: string | number; completion?: string | number }
}

/**
 * Fetch the full OpenRouter model catalogue. Cached for 10 min.
 * Prices converted to per-1M-token USD.
 */
export async function getModelCatalogue(force = false): Promise<OpenRouterModelInfo[]> {
  const now = Date.now()
  if (!force && modelsCache.value.length > 0 && now - modelsCache.at < MODELS_TTL_MS) {
    return modelsCache.value
  }
  try {
    const raw = await fetchJson<{ data: RawModel[] }>('/models')
    const list: OpenRouterModelInfo[] = (raw.data ?? []).map((m) => {
      // OpenRouter prices are per-token strings like "0.00000015".
      // We convert to per-1M-token floats for UI consistency with llm-logger.
      const promptPer1M = Number(m.pricing?.prompt ?? 0) * 1_000_000
      const completionPer1M = Number(m.pricing?.completion ?? 0) * 1_000_000
      return {
        id: m.id,
        name: m.name ?? m.id,
        contextLength: Number(m.context_length ?? 0),
        pricing: {
          prompt: Number.isFinite(promptPer1M) ? promptPer1M : 0,
          completion: Number.isFinite(completionPer1M) ? completionPer1M : 0,
        },
        isFree: m.id.endsWith(':free'),
      }
    })
    modelsCache = { at: now, value: list }
    return list
  } catch (err) {
    console.warn('[openrouter-stats] getModelCatalogue failed:', (err as Error).message)
    return modelsCache.value
  }
}

/**
 * Force-refresh both caches. Called by admin endpoint.
 */
export async function refreshAll(): Promise<void> {
  await Promise.allSettled([getCredits(true), getModelCatalogue(true)])
}
