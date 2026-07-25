/**
 * Provenance data service for the GWS Chrome Extension.
 * Mirrors the web app's useProvenanceData/useAIState hooks as imperative functions.
 * Called from extension overlay components via direct import (runs in content script context).
 */

import { sendToBackground } from '@/lib/message-passing'

// ─── Types ───

export interface ExtensionEpisode {
  id: string
  title: string
  startTime: string
  endTime: string
  userNames: string[]
  surfaces: string[]
  hasKeyChange: boolean
  primarySection: string | null
  eventCount: number
  events: Array<{
    label: string
    threadType: string
    timestamp: string
    isKeyChange: boolean
    isAIInvolved: boolean
    hasEvidence: boolean
  }>
}

export interface ExtensionProvenanceData {
  episodes: ExtensionEpisode[]
  sharedState: any | null
  aiState: {
    tensions: Array<{
      id: string
      description: string
      severity: string
      tentative: boolean
      resolvedAt: string | null
    }>
    newFromTeam: Array<{
      fromUserName: string
      memory: string
      relevantSection: string | null
      surfaced: boolean
    }>
  } | null
}

export interface ParagraphProvenanceResult {
  lastEditor: { name: string; timestamp: string } | null
  source: { title: string; browseDuration?: number } | null
  aiInvolvement: { type: string; detail: string } | null
  evidenceVerified: boolean
}

// ─── Fetchers ───

export async function fetchProvenanceData(
  workspaceId: string,
  documentId: string,
  sectionFilter?: string | null
): Promise<ExtensionProvenanceData> {
  try {
    const result = await sendToBackground<ExtensionProvenanceData>({
      type: 'FETCH_PROVENANCE_DATA',
      payload: { workspaceId, documentId, sectionFilter },
    })
    if (result.success && result.data) return result.data
  } catch {
    // fall through
  }
  return { episodes: [], sharedState: null, aiState: null }
}

export async function fetchExtensionParagraphProvenance(
  workspaceId: string,
  documentId: string,
  sectionRef: string
): Promise<ParagraphProvenanceResult> {
  try {
    const result = await sendToBackground<ParagraphProvenanceResult>({
      type: 'FETCH_PARAGRAPH_PROVENANCE',
      payload: { workspaceId, documentId, sectionRef },
    })
    if (result.success && result.data) return result.data
  } catch {
    // fall through
  }
  return { lastEditor: null, source: null, aiInvolvement: null, evidenceVerified: false }
}

export async function fetchAIStateSummary(
  workspaceId: string,
  documentId: string
): Promise<{
  tensions: ExtensionProvenanceData['aiState'] extends null ? never : NonNullable<ExtensionProvenanceData['aiState']>['tensions']
  newFromTeam: ExtensionProvenanceData['aiState'] extends null ? never : NonNullable<ExtensionProvenanceData['aiState']>['newFromTeam']
  activeTensionCount: number
  hasUnsurfacedTeamUpdates: boolean
}> {
  try {
    const result = await sendToBackground<any>({
      type: 'FETCH_AI_STATE_SUMMARY',
      payload: { workspaceId, documentId },
    })
    if (result.success && result.data) {
      const tensions = result.data.tensions || []
      const newFromTeam = result.data.newFromTeam || []
      return {
        tensions: tensions.filter((t: any) => !t.resolvedAt),
        newFromTeam,
        activeTensionCount: tensions.filter(
          (t: any) => !t.resolvedAt && (t.severity === 'medium' || t.severity === 'high')
        ).length,
        hasUnsurfacedTeamUpdates: newFromTeam.some((m: any) => !m.surfaced),
      }
    }
  } catch {
    // fall through
  }
  return { tensions: [], newFromTeam: [], activeTensionCount: 0, hasUnsurfacedTeamUpdates: false }
}

export async function markTeamUpdatesSurfaced(workspaceId: string): Promise<void> {
  try {
    await sendToBackground({ type: 'MARK_TEAM_UPDATES_SURFACED', payload: { workspaceId } })
  } catch {
    // silently fail
  }
}

// ─── Episode processing (exported for testing) ───

export function processExtensionEpisodes(
  results: any[],
  episodeMap: Record<string, any>
): ExtensionEpisode[] {
  const grouped = new Map<string, any[]>()
  for (const result of results) {
    if (!result.episodeId) continue
    const list = grouped.get(result.episodeId) || []
    list.push(result)
    grouped.set(result.episodeId, list)
  }

  const episodes: ExtensionEpisode[] = []
  for (const [epId, events] of grouped) {
    const epData = episodeMap[epId]
    const sorted = events.sort(
      (a: any, b: any) =>
        new Date(a.timestamp || a.eventTime).getTime() -
        new Date(b.timestamp || b.eventTime).getTime()
    )

    episodes.push({
      id: epId,
      title: epData?.title || 'Untitled episode',
      startTime: sorted[0]?.timestamp || '',
      endTime: sorted[sorted.length - 1]?.timestamp || '',
      userNames: [...new Set(events.map((e: any) => e.userName).filter(Boolean))] as string[],
      surfaces: [...new Set(events.map((e: any) => e.threadType))] as string[],
      hasKeyChange: events.some((e: any) => e.isKeyChange),
      primarySection: epData?.primarySection || null,
      eventCount: events.length,
      events: events.map((e: any) => ({
        label: e.label || 'Unknown event',
        threadType: e.threadType,
        timestamp: e.timestamp || e.eventTime,
        isKeyChange: e.isKeyChange || false,
        isAIInvolved: e.isAIInvolved || false,
        hasEvidence: e.hasEvidence || false,
      })),
    })
  }

  return episodes.sort(
    (a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime()
  )
}
