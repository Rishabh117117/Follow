/**
 * Model Overrides
 *
 * Runtime-configurable overrides for the MODEL_TIERS map. The dashboard
 * (GET/PUT /api/models/overrides) writes to this file, and any call site
 * that reads `MODEL_TIERS[tier]` sees the new model immediately via a
 * Proxy installed in config/models.ts.
 *
 * Storage: data/model-overrides.json (gitignored).
 * Shape:   { "CHAT_AGENT": "anthropic/claude-sonnet-4-5", "INDEX_AGENT": "..." }
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs'
import { resolve, dirname } from 'path'

const OVERRIDES_PATH = resolve(process.cwd(), 'data', 'model-overrides.json')
const CACHE_TTL_MS = 2000 // re-read at most every 2s

let cache: { overrides: Record<string, string>; mtimeMs: number; readAtMs: number } | null = null

function ensureDataDir(): void {
  const dir = dirname(OVERRIDES_PATH)
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      /* non-fatal */
    }
  }
}

function readFromDisk(): Record<string, string> {
  if (!existsSync(OVERRIDES_PATH)) return {}
  try {
    const raw = readFileSync(OVERRIDES_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v.trim()) out[k] = v.trim()
      }
      return out
    }
    return {}
  } catch {
    return {}
  }
}

/**
 * Return the current overrides map. Re-reads the file at most every CACHE_TTL_MS
 * or when the file mtime changes.
 */
export function loadOverrides(): Record<string, string> {
  const now = Date.now()
  if (cache && now - cache.readAtMs < CACHE_TTL_MS) return cache.overrides

  let mtimeMs = 0
  try {
    mtimeMs = existsSync(OVERRIDES_PATH) ? statSync(OVERRIDES_PATH).mtimeMs : 0
  } catch {
    /* ignore */
  }

  if (cache && cache.mtimeMs === mtimeMs) {
    cache = { ...cache, readAtMs: now }
    return cache.overrides
  }

  const overrides = readFromDisk()
  cache = { overrides, mtimeMs, readAtMs: now }
  return overrides
}

/**
 * Write a new overrides map. Keys not present are treated as "use default".
 */
export function saveOverrides(next: Record<string, string>): void {
  ensureDataDir()
  const cleaned: Record<string, string> = {}
  for (const [k, v] of Object.entries(next)) {
    if (typeof v === 'string' && v.trim()) cleaned[k] = v.trim()
  }
  writeFileSync(OVERRIDES_PATH, JSON.stringify(cleaned, null, 2) + '\n', 'utf-8')
  cache = null // invalidate
}

/**
 * Resolve a tier to its effective model string. Called by the MODEL_TIERS proxy.
 */
export function resolveModel(tier: string, fallback: string): string {
  const over = loadOverrides()
  return over[tier] ?? fallback
}

export const MODEL_OVERRIDES_PATH = OVERRIDES_PATH
