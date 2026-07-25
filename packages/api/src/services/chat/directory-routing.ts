/**
 * Directory Routing Helpers (Sprint CTX-2)
 *
 * Detects when a user message is better served by the directory_query tool
 * (people/sources) than the index query (facts). Also auto-upgrades to the
 * directory path when the topic has known contradictions.
 */

import type { DirectoryQueryResult, ContributorEntry } from '../directory/directory-query'

const DIRECTORY_PATTERNS: RegExp[] = [
  /who (?:worked|knows|contributed|wrote|researched|analyzed)/i,
  /which team member/i,
  /who should I (?:ask|talk to|consult)/i,
  /what did (\w+) (?:work on|contribute|write|research)/i,
  /contributors? (?:to|on|for)/i,
  /who (?:has|have) (?:worked|contributed)/i,
  /expertise on/i,
  /route me to/i,
]

export function isDirectoryQuery(query: string): boolean {
  if (!query) return false
  return DIRECTORY_PATTERNS.some((p) => p.test(query))
}

export interface ContradictionHint {
  topic?: string
  userIds?: string[]
}

export function shouldUpgradeForContradictions(
  query: string,
  activeContradictions: ContradictionHint[]
): boolean {
  if (activeContradictions.length === 0) return false
  const q = query.toLowerCase()
  return activeContradictions.some((c) => {
    if (!c.topic) return false
    return q.includes(c.topic.toLowerCase())
  })
}

export function formatDirectoryForPrompt(result: DirectoryQueryResult): string {
  const lines: string[] = []
  lines.push(`Directory query for topic: "${result.topic}"`)
  lines.push(`Routing reason: ${result.routingReason}`)
  lines.push(`Recommendation: ${result.recommendation}`)
  lines.push(`\nContributors (${result.contributors.length}):`)
  for (const c of result.contributors) {
    lines.push(
      `- ${c.name} <${c.email}> — ${c.totalFacts} facts, ${c.totalFiles} files, ${c.sessionCount} sessions, avg engagement ${c.avgEngagement}. Sources: ${c.sources.join(', ') || 'n/a'}. Topics: ${c.topicsCovered.join(', ') || 'n/a'}.`
    )
  }
  if (result.contradictions.length > 0) {
    lines.push(`\nContradictions (${result.contradictions.length}):`)
    for (const ct of result.contradictions) {
      lines.push(
        `- ${ct.status}: "${truncate(ct.factA.text, 80)}" vs "${truncate(ct.factB.text, 80)}"`
      )
    }
  }
  return lines.join('\n')
}

export interface DirectoryMetadata {
  queryType: 'index' | 'directory'
  routingReason?: string
  contributors?: ContributorEntry[]
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}
