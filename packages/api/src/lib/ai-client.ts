/**
 * Unified AI client — all calls route through OpenRouter using the OpenAI SDK.
 *
 * The `openai` npm package is wire-compatible with OpenRouter's
 * /api/v1/chat/completions endpoint.
 */

import OpenAI from 'openai'
import { OPENROUTER_BASE } from '../config/models'

// Lazy-init so env vars are available after dotenv
let _client: OpenAI | null = null

export function getOpenRouterClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: OPENROUTER_BASE,
      apiKey: process.env['OPENROUTER_API_KEY'] ?? 'missing-key',
      defaultHeaders: {
        'HTTP-Referer': 'https://follow.app',
        'X-Title': 'Follow Workspace',
      },
    })
  }
  return _client
}

/** Convenience alias */
export const openrouterClient = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    return Reflect.get(getOpenRouterClient(), prop, receiver)
  },
})

/**
 * Whether we have any AI API key configured.
 */
export function hasAiKey(): boolean {
  return !!(process.env['OPENROUTER_API_KEY'] ?? '')
}

/**
 * Get the default model name.
 */
export function getDefaultModel(): string {
  return process.env['AI_MODEL'] ?? 'deepseek/deepseek-chat-v3-0324'
}
