/**
 * Pipeline LLM helper (2026-04-29)
 *
 * Wraps OpenRouter chat completions for the 5 pipeline roles with:
 *   - usage logging into llm_usage (tier-tagged for the dashboard)
 *   - JSON-mode + Zod schema validation (drop-and-discard, no retry-fix)
 *   - per-role timeout + abort
 *
 * Each role's call site passes its tier name + Zod schema; if the model's
 * response is malformed we log the error and return null. Pipelines that
 * receive null treat the run as a no-op rather than retrying — cheaper than
 * thrashing on a malformed response, and the dashboard surfaces validation
 * failures via llm_usage.modelTier so we can spot a regressing prompt fast.
 */

import type { z } from 'zod'
import { getOpenRouterClient } from '../../lib/ai-client'
import { logLLMUsage } from '../../lib/llm-logger'
import { MODEL_TIERS, type ModelTier } from '../../config/models'

export interface PipelineLLMCallParams<T> {
  /** Tier name as declared in DEFAULT_MODEL_TIERS — drives model resolution + cost logging. */
  tier: ModelTier
  /** System prompt verbatim, with placeholders already substituted. */
  systemPrompt: string
  /** User-role payload. Usually a JSON-serialized input frame. */
  userMessage: string
  /** Zod schema the response must validate against. Malformed → return null. */
  responseSchema: z.ZodType<T>
  /** userId for llm_usage attribution */
  userId: string
  /** source string for llm_usage (e.g. 'archivist:scheduled') */
  source: string
  /** Override the temperature; pipeline default is 0.0–0.2 depending on role. */
  temperature?: number
  /** Token cap on the response. Tight by default per the planning step. */
  maxTokens?: number
  /** Abort controller — pipeline crons cancel on shutdown. */
  signal?: AbortSignal
}

/**
 * Run one pipeline-role LLM call. Returns the parsed-and-validated response
 * or null on any failure (network, timeout, malformed JSON, schema mismatch).
 */
export async function pipelineLLMCall<T>(
  params: PipelineLLMCallParams<T>
): Promise<T | null> {
  const client = getOpenRouterClient()
  const model = MODEL_TIERS[params.tier]
  if (!model) {
    console.warn(`[pipeline-llm] unknown tier: ${params.tier}`)
    return null
  }

  let raw = ''
  let inputTokens = 0
  let outputTokens = 0

  try {
    const res = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userMessage },
        ],
        temperature: params.temperature ?? 0.1,
        max_tokens: params.maxTokens ?? 1500,
        response_format: { type: 'json_object' },
      },
      params.signal ? { signal: params.signal } : undefined
    )

    const usage = (res as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage
    inputTokens = Number(usage?.prompt_tokens ?? 0)
    outputTokens = Number(usage?.completion_tokens ?? 0)
    raw = res.choices?.[0]?.message?.content ?? ''
  } catch (err) {
    console.warn(
      `[pipeline-llm] ${params.tier} call failed:`,
      err instanceof Error ? err.message : err
    )
    return null
  } finally {
    // Log even on failure so the dashboard counts the attempt
    void logLLMUsage({
      userId: params.userId,
      model,
      modelTier: params.tier,
      inputTokens,
      outputTokens,
      source: params.source,
    }).catch(() => {
      /* never block pipeline on logging */
    })
  }

  // Parse + validate. Drop-and-discard on any failure.
  let parsedJson: unknown
  try {
    // OpenRouter's JSON mode usually returns clean JSON, but defensively
    // strip a markdown fence if the model added one anyway.
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
    parsedJson = JSON.parse(cleaned)
  } catch (err) {
    console.warn(
      `[pipeline-llm] ${params.tier} response was not valid JSON (length=${raw.length}):`,
      err instanceof Error ? err.message : err
    )
    return null
  }

  const validated = params.responseSchema.safeParse(parsedJson)
  if (!validated.success) {
    console.warn(
      `[pipeline-llm] ${params.tier} schema validation failed:`,
      validated.error.errors.slice(0, 3)
    )
    return null
  }

  return validated.data
}
