/**
 * Embedding Service
 *
 * Generates text embeddings using OpenAI's text-embedding-3-small model
 * via OpenRouter. Returns 1536-dimensional vectors for semantic search.
 */

import { getOpenRouterClient } from '../lib/ai-client'

const EMBEDDING_MODEL = 'openai/text-embedding-3-small'
const EMBEDDING_DIMS = 1536
const MAX_TOKENS = 8191
const MAX_BATCH_SIZE = 100
const MAX_RETRIES = 3

/**
 * Estimate token count using simple heuristic (4 chars ≈ 1 token).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Truncate text to fit within token limit.
 */
function truncateToTokenLimit(text: string, maxTokens: number = MAX_TOKENS): string {
  const estimatedTokens = estimateTokens(text)
  if (estimatedTokens <= maxTokens) return text
  // Truncate at approximate character position
  const maxChars = maxTokens * 4
  return text.slice(0, maxChars)
}

/**
 * Generate embedding for a single text string.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const results = await generateEmbeddings([text])
  return results[0]!
}

/**
 * Generate embeddings for multiple text strings in batch.
 * Handles batching, truncation, and retries.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const client = getOpenRouterClient()
  const results: number[][] = []

  // Process in batches
  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE)
    const truncated = batch.map((t) => truncateToTokenLimit(t))

    let lastError: Error | null = null

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await client.embeddings.create({
          model: EMBEDDING_MODEL,
          input: truncated,
        })

        // OpenRouter occasionally returns a 200 with no `data` array (e.g. when
        // the upstream provider hiccups). Without this guard `.sort()` throws
        // "Cannot read properties of undefined" and the chunk silently lands
        // with a null embedding — breaking semantic search downstream.
        if (!response || !Array.isArray((response as { data?: unknown }).data)) {
          throw new Error('embedding response missing data array')
        }

        // Sort by index to maintain order
        const sorted = response.data.slice().sort((a, b) => a.index - b.index)
        results.push(...sorted.map((d) => d.embedding))
        lastError = null
        break
      } catch (error) {
        lastError = error as Error
        const backoff = Math.pow(2, attempt) * 1000 // 1s, 2s, 4s
        console.warn(
          `[Embedding] Retry ${attempt + 1}/${MAX_RETRIES} after ${backoff}ms:`,
          (error as Error).message
        )
        await new Promise((resolve) => setTimeout(resolve, backoff))
      }
    }

    if (lastError) {
      throw new Error(`Embedding generation failed after ${MAX_RETRIES} retries: ${lastError.message}`)
    }
  }

  return results
}

/**
 * Check if embeddings are available (API key configured).
 */
export function hasEmbeddingSupport(): boolean {
  return !!(process.env['OPENROUTER_API_KEY'] ?? '')
}

export { EMBEDDING_DIMS, EMBEDDING_MODEL }
