import { getOpenRouterClient } from '../../lib/ai-client'
import { MODEL_TIERS } from '../../config/models'
import { getImmediateState } from './immediate-updater'
import { getOrCreateState } from './state-manager'
import type { AIStateEvent } from '@workspace/shared/types'

export interface ReflectionInput {
  event: {
    eventId: string
    label: string
    type: string
    section: string | null
    threadType: string
    timestamp: string
    isKeyChange: boolean
    isAIInvolved: boolean
    contextNotes: string | null
    magnitude: string
  }
  userId: string
  workspaceId: string
  documentId: string | null
  documentTitle: string | null
}

export interface ReflectionOutput {
  tension: { description: string; severity: 'low' | 'medium' | 'high'; sections: string[] } | null
  connection: { description: string; linkedEventId: string | null } | null
  shift: { description: string; from: string; to: string } | null
  gap: { description: string; confidence: number } | null
  knowledge: { fact: string; source: string; confidence: number } | null
  overallConfidence: number
}

/**
 * Run the reflection LLM on a newly distilled event.
 * Reads the current AI state for context, produces reasoned annotations.
 *
 * Target latency: ~300ms (LLM call)
 * Target cost: ~$0.0003 per call
 */
export async function reflectOnEvent(input: ReflectionInput): Promise<ReflectionOutput | null> {
  const { event, userId, workspaceId, documentTitle } = input

  // Skip reflection for low-magnitude events (save cost)
  if (event.magnitude === 'tiny') {
    return null
  }

  try {
    // Gather context from current state
    const [immediate, pgState] = await Promise.all([
      getImmediateState(userId, workspaceId),
      getOrCreateState(userId, workspaceId),
    ])

    const stateEvent = pgState.stateEvent as AIStateEvent

    // Build compact context for the LLM
    const recentLabels = stateEvent.recentEvents
      .slice(0, 8)
      .map(
        (e: { threadType: string; label: string; isKeyChange: boolean }) =>
          `[${e.threadType}] ${e.label}${e.isKeyChange ? ' (KEY)' : ''}`
      )
      .join('\n')

    const currentTensions = stateEvent.activeTensions
      .filter((t: { resolvedAt: string | null }) => !t.resolvedAt)
      .slice(0, 3)
      .map((t: { severity: string; description: string }) => `- [${t.severity}] ${t.description}`)
      .join('\n')

    const currentKnowledge = stateEvent.activeKnowledge
      .slice(0, 5)
      .map((k: { fact: string; source: string }) => `- ${k.fact} (${k.source})`)
      .join('\n')

    const focusSection = immediate.focus.sectionRef || 'unknown section'
    const focusDuration = immediate.focus.sectionViewStartedAt
      ? Math.round(
          (Date.now() - new Date(immediate.focus.sectionViewStartedAt).getTime()) / 1000
        )
      : 0

    const collaborators =
      immediate.presence.collaborators
        .map((c: { name: string }) => c.name)
        .join(', ') || 'none'

    // Build the reflection prompt
    const prompt = buildReflectionPrompt({
      event,
      documentTitle,
      focusSection,
      focusDuration,
      collaborators,
      recentLabels,
      currentTensions,
      currentKnowledge,
    })

    // Call the LLM
    const client = getOpenRouterClient()
    const response = await client.chat.completions.create({
      model: MODEL_TIERS.INDEX_AGENT,
      messages: [
        { role: 'system', content: REFLECTION_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: 300,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    })

    const content = response.choices[0]?.message?.content
    if (!content) return null

    // Parse the response
    const parsed = JSON.parse(content)

    return {
      tension: parsed.tension || null,
      connection: parsed.connection || null,
      shift: parsed.shift || null,
      gap: parsed.gap
        ? { ...parsed.gap, confidence: Math.min(parsed.gap.confidence || 0.5, 0.8) }
        : null,
      knowledge: parsed.knowledge
        ? {
            ...parsed.knowledge,
            confidence: Math.min(parsed.knowledge.confidence || 0.5, 0.8),
          }
        : null,
      overallConfidence: parsed.confidence || 0.5,
    }
  } catch (err) {
    console.warn('[Reflector] Reflection failed (non-blocking):', (err as Error).message)
    return null
  }
}

const REFLECTION_SYSTEM_PROMPT = `You are a reflection engine for Follow, an AI-native document intelligence system.
Your job: analyze a new event in the context of the user's current work and produce short, precise annotations.

RULES:
- Return ONLY a JSON object with these fields: tension, connection, shift, gap, knowledge, confidence
- Each field is null if nothing relevant was detected — do NOT force findings
- Do NOT reinforce previous tentative observations. Evaluate the new event INDEPENDENTLY
- Confidence is 0.0-1.0. Never exceed 0.8 for inferred connections (only evidence-backed facts reach higher)
- Descriptions must be ONE sentence, max 150 characters
- Be conservative: only flag genuine tensions, not stylistic preferences
- "gap" should only flag things the user likely doesn't realize — NOT things they might be deferring intentionally

OUTPUT FORMAT:
{
  "tension": { "description": "string", "severity": "low|medium|high", "sections": ["Section X"] } | null,
  "connection": { "description": "string", "linkedEventId": "uuid" | null } | null,
  "shift": { "description": "string", "from": "researching", "to": "writing" } | null,
  "gap": { "description": "string", "confidence": 0.0-0.8 } | null,
  "knowledge": { "fact": "string", "source": "string", "confidence": 0.0-0.8 } | null,
  "confidence": 0.0-1.0
}`

interface ReflectionPromptInput {
  event: ReflectionInput['event']
  documentTitle: string | null
  focusSection: string
  focusDuration: number
  collaborators: string
  recentLabels: string
  currentTensions: string
  currentKnowledge: string
}

function buildReflectionPrompt(input: ReflectionPromptInput): string {
  const {
    event,
    documentTitle,
    focusSection,
    focusDuration,
    collaborators,
    recentLabels,
    currentTensions,
    currentKnowledge,
  } = input

  let prompt = `NEW EVENT:
[${event.threadType.toUpperCase()}] ${event.label}
Type: ${event.type}, Magnitude: ${event.magnitude}${event.isKeyChange ? ', KEY CHANGE' : ''}${event.isAIInvolved ? ', AI INVOLVED' : ''}
${event.contextNotes ? `Context: ${event.contextNotes}` : ''}
${event.section ? `Section: ${event.section}` : ''}
${documentTitle ? `Document: ${documentTitle}` : ''}

CURRENT FOCUS: ${focusSection} (${focusDuration}s), collaborators: ${collaborators}
`

  if (recentLabels) {
    prompt += `\nRECENT EVENTS (newest first):\n${recentLabels}\n`
  }

  if (currentTensions) {
    prompt += `\nACTIVE TENSIONS:\n${currentTensions}\n`
  }

  if (currentKnowledge) {
    prompt += `\nKNOWN FACTS:\n${currentKnowledge}\n`
  }

  prompt += `\nAnalyze this event. What changed? Return JSON.`

  return prompt
}
