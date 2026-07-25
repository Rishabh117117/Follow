/**
 * Interpretation Generator (Sprint IX-2)
 *
 * Generates a DocumentInterpretation from semantic index results via LLM.
 * Output matches the exact shape defined in packages/shared/src/types/doc-memory.ts.
 */

import { MODEL_TIERS } from '../../config/models'
import { getOpenRouterClient } from '../../lib/ai-client'
import type {
  DocumentInterpretation,
  NarrativePhase,
  CognitiveState,
} from '@workspace/shared/types'

interface IndexResult {
  threadType: string
  indexMagnitude: string
  isKeyChange: boolean
  isAIInvolved: boolean
  embeddingText: string
  userName: string | null
  eventTime: Date | string
  sectionAlias: string | null
  evidence?: unknown[]
}

interface EpisodeData {
  title: string | null
  status: string
  summaryText: string | null
  startedAt: Date | string
  endedAt: Date | string | null
  recordCount: number
}

const VALID_PHASES: NarrativePhase[] = ['inception', 'exploration', 'convergence', 'stabilization', 'delivery']
const VALID_STATES: CognitiveState[] = ['exploring', 'comparing', 'deciding', 'synthesizing', 'refining', 'stuck', 'presenting']

/**
 * Generate a DocumentInterpretation from index query results.
 * Returns null on LLM failure or empty input.
 */
export async function generateInterpretation(
  results: IndexResult[],
  episodeData: Record<string, EpisodeData>,
  documentId: string,
  workspaceId: string
): Promise<Omit<DocumentInterpretation, 'id' | 'workspaceId' | 'fileId' | 'strandId' | 'createdAt' | 'updatedAt'> | null> {
  if (results.length === 0) return null

  const eventLines = results.slice(0, 50).map((r) => {
    const time = typeof r.eventTime === 'string' ? r.eventTime : r.eventTime.toISOString()
    const tags = [
      r.threadType.toUpperCase(),
      r.indexMagnitude,
      r.isKeyChange ? 'KEY' : '',
      r.isAIInvolved ? 'AI' : '',
    ].filter(Boolean).join('/')
    return `[${tags}] ${r.embeddingText.split('\n')[0] ?? r.embeddingText} (${r.userName ?? 'unknown'}, ${time})`
  }).join('\n')

  const episodes = Object.values(episodeData)
  const episodeLines = episodes.length > 0
    ? `\nEpisodes:\n${episodes.map((e) => `- ${e.title ?? 'Untitled'}: ${e.summaryText ?? e.status} (${e.recordCount} events)`).join('\n')}`
    : ''

  const keyCount = results.filter((r) => r.isKeyChange).length
  const aiCount = results.filter((r) => r.isAIInvolved).length
  const sections = [...new Set(results.map((r) => r.sectionAlias).filter(Boolean))]

  const prompt = `Analyze these document provenance events and return a JSON object describing the document's current state.

Events (${results.length} total, ${keyCount} key changes, ${aiCount} AI-involved):
${eventLines}
${episodeLines}

Sections touched: ${sections.join(', ') || 'unknown'}

Return ONLY valid JSON matching this exact structure:
{
  "narrativePhase": "inception|exploration|convergence|stabilization|delivery",
  "narrativeConfidence": 0.0-1.0,
  "narrativeSummary": "2-3 sentence narrative of the document's current state and trajectory",
  "workingIntent": "one sentence — what this document is trying to become",
  "intentEvidence": "brief evidence supporting the intent assessment",
  "cognitiveState": "exploring|comparing|deciding|synthesizing|refining|stuck|presenting",
  "activeTensions": [{"name": "short label", "description": "what the tension is", "evidence": "where it shows up"}],
  "sourceInfluence": [{"sourceName": "source name", "weight": 0.0-1.0, "reason": "why influential"}],
  "unresolvedQuestions": [{"question": "the open question", "evidence": "what suggests it's unresolved"}]
}

Rules:
- narrativePhase: inception (<5 events), exploration (diverse types), convergence (patterns forming), stabilization (few key changes), delivery (final edits)
- Keep arrays to 3-5 items max
- Base all claims on the actual events provided
- Return ONLY valid JSON, no markdown fences, no explanation`

  try {
    const client = getOpenRouterClient()
    const response = await client.chat.completions.create({
      model: MODEL_TIERS.INDEX_AGENT,
      messages: [
        { role: 'system', content: 'You are a document analysis engine. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 800,
    })

    const text = response.choices[0]?.message?.content ?? ''
    return parseInterpretationResponse(text)
  } catch (err) {
    console.error('[InterpretationGenerator] LLM call failed:', err)
    return null
  }
}

/**
 * Parse LLM response into DocumentInterpretation fields.
 * Validates and falls back to defaults for malformed data.
 */
function parseInterpretationResponse(
  text: string
): Omit<DocumentInterpretation, 'id' | 'workspaceId' | 'fileId' | 'strandId' | 'createdAt' | 'updatedAt'> | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])

    return {
      narrativePhase: VALID_PHASES.includes(parsed.narrativePhase) ? parsed.narrativePhase : 'exploration',
      narrativeConfidence: typeof parsed.narrativeConfidence === 'number'
        ? Math.max(0, Math.min(1, parsed.narrativeConfidence))
        : 0.5,
      narrativeSummary: String(parsed.narrativeSummary ?? ''),
      workingIntent: String(parsed.workingIntent ?? ''),
      intentEvidence: String(parsed.intentEvidence ?? ''),
      cognitiveState: VALID_STATES.includes(parsed.cognitiveState) ? parsed.cognitiveState : 'exploring',
      activeTensions: Array.isArray(parsed.activeTensions)
        ? parsed.activeTensions.slice(0, 5).map((t: any) => ({
            name: String(t.name ?? ''),
            description: String(t.description ?? ''),
            evidence: String(t.evidence ?? ''),
          }))
        : [],
      sourceInfluence: Array.isArray(parsed.sourceInfluence)
        ? parsed.sourceInfluence.slice(0, 5).map((s: any) => ({
            sourceName: String(s.sourceName ?? ''),
            weight: typeof s.weight === 'number' ? Math.max(0, Math.min(1, s.weight)) : 0.5,
            reason: String(s.reason ?? ''),
          }))
        : [],
      unresolvedQuestions: Array.isArray(parsed.unresolvedQuestions)
        ? parsed.unresolvedQuestions.slice(0, 5).map((q: any) => ({
            question: String(q.question ?? ''),
            evidence: String(q.evidence ?? ''),
          }))
        : [],
    }
  } catch {
    return null
  }
}
