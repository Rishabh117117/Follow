'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api-client'

// ─── Types ───

export interface Episode {
  id: string
  title: string
  startTime: string
  endTime: string
  eventIds: string[]
  userIds: string[]
  userNames: string[]
  surfaces: string[]
  primarySection: string | null
  outcome: string | null
  hasKeyChange: boolean
  events?: ProvenanceEvent[]
}

export interface ProvenanceEvent {
  id: string
  eventId: string
  label: string
  type: string
  threadType: string
  timestamp: string
  sectionRef: string | null
  userId: string
  userName: string
  isKeyChange: boolean
  isAIInvolved: boolean
  hasEvidence: boolean
  relevanceScore: number
  evidence?: EvidenceRecord | null
}

export interface EvidenceRecord {
  id: string
  evidenceType: string
  contentBefore: string | null
  contentAfter: string | null
  chatExchange: { question: string; response: string; model: string } | null
  sourceSnapshot: { url: string; title: string; snippet: string; browseDuration: number } | null
  recordHash: string
}

export interface DocumentSharedState {
  contributions: Array<{
    userId: string
    userName: string
    sections: Array<{
      sectionRef: string
      editCount: number
      lastEditAt: string
      wordsDelta: number
      isAIAssisted: boolean
    }>
    totalEvents: number
    lastActiveAt: string
    role: string
  }>
  knowledge: Array<{
    id: string
    fact: string
    source: string
    confidence: number
    contributedBy: string
    contributedByName: string
    method: string
    linkedSection: string | null
    conflictsWith: string | null
    status: string
  }>
  tensions: Array<{
    id: string
    description: string
    severity: string
    type: string
    involvedUsers: string[]
    involvedSections: string[]
    resolvedAt: string | null
    confidence: number
  }>
  dynamics: {
    documentPhase: string | null
    activeContributors: number
    editVelocity: string
    lastMajorChange: {
      description: string
      userId: string
      userName: string
      timestamp: string
      section: string
    } | null
    openQuestions?: Array<{ question: string }>
  }
  aiUsage: {
    totalInteractions: number
    acceptedCount: number
    rejectedCount: number
    acceptanceRate: number
    sectionsWithAIContent: string[]
    byUser: Array<{ userId: string; userName: string; interactions: number; acceptRate: number }>
  }
}

export interface ProvenanceData {
  episodes: Episode[]
  events: ProvenanceEvent[]
  totalEvents: number
  sharedState: DocumentSharedState | null
  isLoading: boolean
  error: string | null
}

// ─── Hook ───

export interface ContextToggles {
  documentHistory?: boolean
  aiUsageTrail?: boolean
  generalChats?: boolean
  evidenceNotes?: boolean
  attachedSources?: boolean
}

export function useProvenanceData(
  workspaceId: string | undefined,
  documentId: string | undefined,
  options?: {
    sectionFilter?: string | null
    userFilter?: string | null
    autoRefreshMs?: number
  }
): ProvenanceData & { contextToggles: ContextToggles | null } {
  const [data, setData] = useState<ProvenanceData>({
    episodes: [],
    events: [],
    totalEvents: 0,
    sharedState: null,
    isLoading: true,
    error: null,
  })
  const [contextToggles, setContextToggles] = useState<ContextToggles | null>(null)

  // Fetch the caller's per-share contextToggles (only meaningful when a non-owner views a shared doc)
  useEffect(() => {
    if (!documentId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await api.get<{ metadata?: { contextToggles?: ContextToggles } } | null>(
          `/api/sharing/files/${documentId}/my-share`
        )
        if (cancelled) return
        const toggles = res.data?.metadata?.contextToggles ?? null
        setContextToggles(toggles)
      } catch {
        // owner views the doc → no share record → no filtering
      }
    })()
    return () => {
      cancelled = true
    }
  }, [documentId])

  const fetchData = useCallback(async () => {
    if (!workspaceId || !documentId) return

    try {
      const [indexResult, sharedResult] = await Promise.all([
        api.post<{
          results: any[]
          episodes: Record<string, any>
          totalCandidates: number
        }>('/api/index/query', {
          workspaceId,
          documentId,
          weightProfile: 'history',
          limit: 100,
          includeEpisodes: true,
          includeEvidence: false,
          targetSection: options?.sectionFilter || undefined,
          userFilter: options?.userFilter ? [options.userFilter] : undefined,
        }),

        api.get<DocumentSharedState>(`/api/shared-state/${documentId}`).catch(() => ({
          data: null,
          error: null,
        })),
      ])

      const results = indexResult.data?.results || []
      const episodeMap = indexResult.data?.episodes || {}
      let episodes = processEpisodes(results, episodeMap)
      let events = results.map(mapToProvenanceEvent)

      // Apply context-toggle filtering when the viewer is a non-owner
      // collaborator with restricted visibility.
      if (contextToggles) {
        if (contextToggles.documentHistory === false) {
          episodes = []
        }
        if (contextToggles.aiUsageTrail === false) {
          events = events.filter((e: any) => e.type !== 'ai_interaction')
        }
        if (contextToggles.generalChats === false) {
          events = events.filter((e: any) => e.type !== 'chat')
        }
      }

      setData({
        episodes,
        events,
        totalEvents: indexResult.data?.totalCandidates || 0,
        sharedState: sharedResult.data || null,
        isLoading: false,
        error: null,
      })
    } catch (err) {
      setData((prev) => ({
        ...prev,
        isLoading: false,
        error: (err as Error).message,
      }))
    }
  }, [workspaceId, documentId, options?.sectionFilter, options?.userFilter, contextToggles])

  useEffect(() => {
    fetchData()

    const interval = options?.autoRefreshMs
      ? setInterval(fetchData, options.autoRefreshMs)
      : null

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [fetchData, options?.autoRefreshMs])

  return { ...data, contextToggles }
}

// ─── Helpers (exported for testing) ───

export function processEpisodes(
  results: any[],
  episodeMap: Record<string, any>
): Episode[] {
  const grouped = new Map<string, any[]>()
  for (const result of results) {
    const epId = result.episodeId
    if (!epId) continue
    const list = grouped.get(epId) || []
    list.push(result)
    grouped.set(epId, list)
  }

  const episodes: Episode[] = []
  for (const [epId, events] of grouped) {
    const epData = episodeMap[epId]
    const sortedEvents = events.sort(
      (a: any, b: any) =>
        new Date(a.timestamp || a.eventTime).getTime() -
        new Date(b.timestamp || b.eventTime).getTime()
    )

    const userIds = [...new Set(events.map((e: any) => e.userId))] as string[]
    const userNames = [...new Set(events.map((e: any) => e.userName).filter(Boolean))] as string[]
    const surfaces = [...new Set(events.map((e: any) => e.threadType))] as string[]

    episodes.push({
      id: epId,
      title: epData?.title || 'Untitled episode',
      startTime: sortedEvents[0]?.timestamp || sortedEvents[0]?.eventTime || '',
      endTime:
        sortedEvents[sortedEvents.length - 1]?.timestamp ||
        sortedEvents[sortedEvents.length - 1]?.eventTime ||
        '',
      eventIds: events.map((e: any) => e.eventId),
      userIds,
      userNames,
      surfaces,
      primarySection: epData?.primarySection || sortedEvents[0]?.sectionRef || null,
      outcome: epData?.outcome || null,
      hasKeyChange: events.some((e: any) => e.isKeyChange),
    })
  }

  return episodes.sort(
    (a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime()
  )
}

export function mapToProvenanceEvent(result: any): ProvenanceEvent {
  return {
    id: result.id,
    eventId: result.eventId,
    label: result.label || result.embeddingText?.slice(0, 100) || 'Unknown event',
    type: result.type || 'unknown',
    threadType: result.threadType,
    timestamp: result.timestamp || result.eventTime,
    sectionRef: result.sectionRef
      ? typeof result.sectionRef === 'string'
        ? result.sectionRef
        : result.sectionRef?.heading
      : null,
    userId: result.userId,
    userName: result.userName || 'Unknown',
    isKeyChange: result.isKeyChange || false,
    isAIInvolved: result.isAIInvolved || false,
    hasEvidence: result.hasEvidence || false,
    relevanceScore: result.relevanceScore || 0,
  }
}

// ─── On-demand fetchers ───

export async function fetchEventEvidence(
  workspaceId: string,
  documentId: string,
  eventId: string
): Promise<EvidenceRecord | null> {
  try {
    const result = await api.post<{ results: any[] }>('/api/index/query', {
      workspaceId,
      documentId,
      weightProfile: 'evidence',
      includeEvidence: true,
      limit: 20,
    })

    const events = result.data?.results || []
    const match = events.find((e: any) => e.eventId === eventId)
    return match?.evidence || null
  } catch {
    return null
  }
}

export async function fetchParagraphProvenance(
  workspaceId: string,
  documentId: string,
  sectionRef: string
): Promise<{
  lastEditor: { name: string; timestamp: string } | null
  source: { title: string; url?: string; browseDuration?: number } | null
  aiInvolvement: { type: string; detail: string } | null
  evidenceVerified: boolean
}> {
  try {
    const result = await api.post<{ results: any[] }>('/api/index/query', {
      workspaceId,
      documentId,
      targetSection: sectionRef,
      weightProfile: 'focused',
      includeEvidence: true,
      limit: 10,
      aiOnly: false,
    })

    const events = result.data?.results || []
    if (events.length === 0) {
      return { lastEditor: null, source: null, aiInvolvement: null, evidenceVerified: false }
    }

    const lastEdit = events.find((e: any) => e.threadType === 'doc')
    const lastEditor = lastEdit
      ? { name: lastEdit.userName, timestamp: lastEdit.timestamp || lastEdit.eventTime }
      : null

    const sourceEvidence = events.find(
      (e: any) => e.evidence?.evidenceType === 'source_introduced'
    )
    const source = sourceEvidence?.evidence?.sourceSnapshot
      ? {
          title: sourceEvidence.evidence.sourceSnapshot.title,
          url: sourceEvidence.evidence.sourceSnapshot.url,
          browseDuration: sourceEvidence.evidence.sourceSnapshot.browseDuration,
        }
      : null

    const aiEvent = events.find((e: any) => e.isAIInvolved)
    const aiInvolvement = aiEvent
      ? {
          type: aiEvent.evidence?.evidenceType === 'ai_accepted' ? 'accepted' : 'involved',
          detail: aiEvent.evidence?.chatExchange ? 'content assist' : 'grammar assist',
        }
      : null

    const hasEvidence = events.some((e: any) => e.hasEvidence)

    return { lastEditor, source, aiInvolvement, evidenceVerified: hasEvidence }
  } catch {
    return { lastEditor: null, source: null, aiInvolvement: null, evidenceVerified: false }
  }
}
