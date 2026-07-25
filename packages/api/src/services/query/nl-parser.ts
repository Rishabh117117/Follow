/**
 * Query NL Parser (Sprint V41-QUERY-1)
 *
 * Translates free-form NL into a StructuredQuery via OpenRouter MICRO_SUMMARY
 * tier (Gemini Flash by default). The output is inspectable JSON — the user
 * can see, edit, and save what the LLM produced.
 *
 * On LLM failure: returns a minimal StructuredQuery with the raw text as a
 * topic match + a warning flag. Never throws. Never silently broadens.
 *
 * If `activeScope` is provided, its boundaries are merged behind the parsed
 * query boundaries (active scope first, query overrides by dimension+op).
 */

import { buildStructuredQuery } from './query-builder'
import type { Boundary } from '../scope/types'
import type { Scope } from '../scope/types'
import type { Aggregation, SelectSpec, StructuredQuery } from './types'

export interface ParseQueryParams {
  text: string
  workspaceId: string
  userId: string
  activeScope?: Scope
}

export interface ParseQueryResult {
  query: StructuredQuery
  warnings: string[]
}

const SYSTEM_PROMPT = [
  'You convert a user request into a JSON object of the form:',
  '{"boundaries": Boundary[], "select": {...}, "aggregations"?: Aggregation[]}',
  '',
  'Valid Boundary dimensions: index, contributor, confidence, time, topic,',
  'edge_type, privacy, freshness, source_tool, provenance, custom.',
  'Valid ops: include, exclude, gte, lte, within, not_within, matches.',
  '',
  'Extraction rules:',
  '- Contributor names ("Priya\'s work", "from X") → {dimension:"contributor", op:"include", values:[names]}',
  '- Time windows ("last week" → 7d, "today" → 1d, "last 2 weeks" → 14d) → {dimension:"time", op:"within", window:{type:"relative", days:N}}',
  '- Confidence thresholds ("high confidence"/"above 0.9") → {dimension:"confidence", op:"gte", value:0.9}',
  '- "contested" or "contradicted" → {dimension:"edge_type", op:"include", values:["contradicts"]}',
  '- "superseded" → {dimension:"edge_type", op:"include", values:["supersedes"]}',
  '- Topic mentions → {dimension:"topic", op:"include", values:[topic strings]}',
  '',
  'Select spec: {"fields":["id","content","contributor","confidence","createdAt"],"limit":100,"orderBy":{"field":"createdAt","direction":"desc"}}',
  '',
  'Return ONLY the JSON object, no prose. Example:',
  '{"boundaries":[{"dimension":"contributor","op":"include","values":["priya"]},{"dimension":"confidence","op":"gte","value":0.9}],"select":{"fields":["id","content","contributor","confidence","createdAt"],"limit":100,"orderBy":{"field":"createdAt","direction":"desc"}}}',
].join('\n')

export async function parseQueryFromNL(
  params: ParseQueryParams
): Promise<ParseQueryResult> {
  const warnings: string[] = []

  const fallback = (warning: string): ParseQueryResult => {
    warnings.push(warning)
    // Minimal safe fallback: topic match on the raw text.
    const boundaries: Boundary[] = params.text.trim()
      ? [{ dimension: 'topic', op: 'matches', value: params.text.trim() }]
      : []
    return {
      query: buildStructuredQuery({
        userId: params.userId,
        workspaceId: params.workspaceId,
        boundaries: mergeWithActiveScope(boundaries, params.activeScope),
        select: defaultSelect(),
      }),
      warnings,
    }
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return fallback('OPENROUTER_API_KEY not set — falling back to raw-text topic match.')
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MICRO_MODEL ?? 'google/gemini-flash-1.5',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: params.text },
        ],
        temperature: 0,
      }),
    })
    if (!response.ok) {
      return fallback(`OpenRouter returned ${response.status}.`)
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = json.choices?.[0]?.message?.content?.trim() ?? ''
    const start = content.indexOf('{')
    const end = content.lastIndexOf('}')
    if (start < 0 || end < 0) {
      return fallback('NL parser returned non-JSON.')
    }
    const parsed = JSON.parse(content.slice(start, end + 1)) as {
      boundaries?: Boundary[]
      select?: SelectSpec
      aggregations?: Aggregation[]
    }

    const boundaries = mergeWithActiveScope(parsed.boundaries ?? [], params.activeScope)
    const select = parsed.select ?? defaultSelect()
    return {
      query: buildStructuredQuery({
        userId: params.userId,
        workspaceId: params.workspaceId,
        boundaries,
        select,
        aggregations: parsed.aggregations,
      }),
      warnings,
    }
  } catch (err) {
    return fallback(`NL parsing failed (${(err as Error).message}).`)
  }
}

function defaultSelect(): SelectSpec {
  return {
    fields: ['id', 'content', 'contributor', 'confidence', 'createdAt'],
    limit: 100,
    orderBy: { field: 'createdAt', direction: 'desc' },
  }
}

function mergeWithActiveScope(queryBoundaries: Boundary[], active?: Scope): Boundary[] {
  if (!active || active.boundaries.length === 0) return queryBoundaries
  const keyOf = (b: Boundary) => `${b.dimension}:${b.op}:${b.name ?? ''}`
  const merged = new Map<string, Boundary>()
  for (const b of active.boundaries) merged.set(keyOf(b), b)
  for (const b of queryBoundaries) merged.set(keyOf(b), b) // query overrides by key
  return [...merged.values()]
}
