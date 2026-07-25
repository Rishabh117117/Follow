/**
 * Reference Agent — Query Classifier (Sprint RA-1)
 *
 * Detects whether a user query needs the full agentic recall pipeline
 * or can bypass to the existing `buildContextParagraph` fast path.
 *
 * Two-stage classification:
 *   1. `preClassify()` — cheap regex pre-filter. Catches obvious edit
 *      commands (rewrite/shorten/fix/continue/…) with zero LLM calls.
 *   2. `classifyQuery()` — deepseek-v4-pro (REFERENCE_CLASSIFY tier) LLM
 *      classifier for nuanced intents. A reasoning model: trades the old
 *      ~300-500ms Gemini latency for stronger intent accuracy.
 *
 * Fail-open: any error falls back to `simple` → bypass agent → fast path.
 * This sprint is zero-regression: classification is logged but RA-2 is
 * the sprint that actually executes the plan and modifies context.
 */

import { getOpenRouterClient } from '../../lib/ai-client'
import { MODEL_TIERS } from '../../config/models'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Query intents the classifier can detect.
 * `simple` means bypass the agent — use the existing fast path.
 */
export type QueryIntent =
  | 'simple' // rewrite, grammar, continue, general knowledge
  | 'temporal' // "what did it say when...", "back in March..."
  | 'cross_version' // "why did we change...", "compare old vs new..."
  | 'contradiction' // "X says A but Y says B", conflicting facts
  | 'provenance' // "where did this come from", "what sources informed..."
  | 'multi_layer' // "everything about topic X", comprehensive recall
  | 'longitudinal' // "how has my thinking evolved", patterns over time

export interface ClassificationResult {
  intent: QueryIntent
  confidence: number // 0-1
  reasoning: string // one-line explanation for debugging
  temporalHint?: string // extracted time reference ("March", "last week")
  versionHint?: number // extracted version number if mentioned
  topicHint?: string // extracted topic for scoped retrieval
  entityHint?: string // extracted person/doc name
  bypassAgent: boolean // true = skip agent, use fast path
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const CLASSIFIER_PROMPT = `You are a query classifier for an AI workspace with versioned documents and a multi-layer memory system. Classify the user's query into exactly one intent type.

Intent types:
- simple: editing requests (rewrite, shorten, grammar, continue), general knowledge questions, anything that only needs the current document state
- temporal: references a past point in time ("when Sam added...", "back in March", "what did it say before...")
- cross_version: comparing current state to a past state, asking why something changed
- contradiction: user identifies conflicting information between sources or collaborators
- provenance: asking where content came from, what sources informed a claim, audit trail
- multi_layer: broad recall across topics, "everything we know about X", synthesis requests
- longitudinal: asking about evolution of understanding over time, patterns, how thinking changed

Respond with ONLY a JSON object, no markdown, no backticks:
{"intent":"<type>","confidence":<0-1>,"reasoning":"<one line>","temporalHint":"<or null>","versionHint":<number or null>,"topicHint":"<or null>","entityHint":"<or null>"}`

const VALID_INTENTS: QueryIntent[] = [
  'simple',
  'temporal',
  'cross_version',
  'contradiction',
  'provenance',
  'multi_layer',
  'longitudinal',
]

// ─── LLM Classifier ──────────────────────────────────────────────────────────

/**
 * Classify a user query to determine if the reference agent should activate.
 *
 * Uses deepseek-v4-pro (REFERENCE_CLASSIFY tier) — the strongest reasoner — for
 * accurate intent detection. A reasoning model, so it needs a generous token
 * budget (see max_tokens below). Any error falls back to `simple` (bypass agent).
 */
export async function classifyQuery(params: {
  query: string
  currentDocumentId?: string
  currentDocumentTitle?: string
  workspaceId: string
  hasCollaborators?: boolean
  userId?: string
}): Promise<ClassificationResult> {
  try {
    const userMessage = [
      `Query: "${params.query}"`,
      params.currentDocumentTitle ? `Current document: "${params.currentDocumentTitle}"` : null,
      params.hasCollaborators ? `This is a shared workspace with collaborators.` : null,
    ]
      .filter(Boolean)
      .join('\n')

    const client = getOpenRouterClient()
    const response = await client.chat.completions.create({
      model: MODEL_TIERS.REFERENCE_CLASSIFY,
      messages: [
        { role: 'system', content: CLASSIFIER_PROMPT },
        { role: 'user', content: userMessage },
      ],
      // REFERENCE_CLASSIFY is deepseek-v4-pro, a *reasoning* model: it spends
      // completion tokens on a reasoning preamble before the JSON. At 200 the
      // reasoning starved the JSON (empty content → fail-open to `simple` every
      // time). 1500 matches the ANALYST tier and leaves room for reasoning + the
      // small classification JSON. (CONTRADICT-1 gotcha.)
      max_tokens: 1500,
      temperature: 0,
    })

    const text = response.choices[0]?.message?.content ?? ''

    // WIRE-1: log LLM usage (non-blocking)
    if (params.userId && response.usage) {
      import('../../lib/llm-logger')
        .then(({ logLLMUsage }) =>
          logLLMUsage({
            userId: params.userId!,
            model: MODEL_TIERS.REFERENCE_CLASSIFY,
            modelTier: 'REFERENCE_CLASSIFY',
            inputTokens: response.usage?.prompt_tokens ?? 0,
            outputTokens: response.usage?.completion_tokens ?? 0,
            source: 'reference-agent',
          })
        )
        .catch(() => {})
    }

    // Strip any markdown fencing the model might add
    const cleaned = text.replace(/```json\s*|```\s*/g, '').trim()
    // Extract first JSON object — defensive against extra prose
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No JSON object in classifier response')
    }
    const parsed = JSON.parse(jsonMatch[0]) as {
      intent?: string
      confidence?: number
      reasoning?: string
      temporalHint?: string | null
      versionHint?: number | null
      topicHint?: string | null
      entityHint?: string | null
    }

    const intent: QueryIntent = VALID_INTENTS.includes(parsed.intent as QueryIntent)
      ? (parsed.intent as QueryIntent)
      : 'simple'

    return {
      intent,
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
      reasoning: parsed.reasoning ?? 'no reasoning provided',
      temporalHint: parsed.temporalHint ?? undefined,
      versionHint: parsed.versionHint ?? undefined,
      topicHint: parsed.topicHint ?? undefined,
      entityHint: parsed.entityHint ?? undefined,
      bypassAgent: intent === 'simple',
    }
  } catch (err) {
    // Fail-open: any classification error → treat as simple → fast path
    console.warn('[ReferenceAgent] Classifier failed, falling back to simple:', err)
    return {
      intent: 'simple',
      confidence: 0,
      reasoning: 'classifier error — fallback to simple',
      bypassAgent: true,
    }
  }
}

// ─── Rule-Based Pre-Classifier ───────────────────────────────────────────────

/**
 * Rule-based pre-filter: catch obvious simple queries without an LLM call.
 * Returns a `ClassificationResult` if the query is confidently simple,
 * else `null` (meaning: caller should invoke the LLM classifier).
 *
 * Saves ~300-500ms on the most common edit commands.
 */
export function preClassify(query: string): ClassificationResult | null {
  const q = query.toLowerCase().trim()

  // Editing commands — always simple
  const editPatterns = [
    /^(rewrite|rephrase|shorten|lengthen|simplify|expand|summarize|fix|correct|improve|polish|tighten)/,
    /^(make it|make this|can you make)/,
    /^(continue|keep going|go on|write more|finish)/,
    /^(translate|convert|format|restructure)/,
    /grammar|spelling|typo|punctuation/,
  ]

  for (const pattern of editPatterns) {
    if (pattern.test(q)) {
      return {
        intent: 'simple',
        confidence: 0.95,
        reasoning: 'edit command detected by rule',
        bypassAgent: true,
      }
    }
  }

  // Temporal signals — let LLM classify for nuance
  const temporalPatterns = [
    /when (we|i|he|she|they|sam|the team)\s+(added|wrote|changed|edited|removed|created)/,
    /what did (it|the doc|this|that) (say|look like|contain)\s+(when|before|back|in \w+)/,
    /(back in|last|previous|earlier|originally|at that time|at the time)/,
    /version\s+\d+/i,
    /\bv\d+\b/,
  ]
  for (const pattern of temporalPatterns) {
    if (pattern.test(q)) return null
  }

  // Provenance signals — let LLM classify
  if (
    /where did (this|that|it) come from|what sources|who (wrote|added|contributed)|source of this/i.test(
      q
    )
  ) {
    return null
  }

  // Contradiction signals — let LLM classify
  if (/but (i|we|my|sam|the) (say|said|found|have|think)|conflict|contradict|disagree/i.test(q)) {
    return null
  }

  // Uncertain — let LLM classify
  return null
}
