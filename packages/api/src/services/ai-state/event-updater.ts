import { updateStateEvent, updateStateSession } from './state-manager'
import type { AIStateEvent, AIStateSession } from '@workspace/shared/types'
import type { ReflectionOutput } from './reflector'

const MAX_RECENT_EVENTS = 20
const MAX_ACTIVE_TENSIONS = 5
const MAX_ACTIVE_KNOWLEDGE = 10
const MAX_DOCUMENTS_WORKED_ON = 10

export interface IndexedEvent {
  eventId: string
  label: string
  type: string
  section: string | null
  threadType: string
  timestamp: string
  isKeyChange: boolean
  isAIInvolved: boolean
  documentId: string | null
  documentTitle: string | null
  episodeId: string | null
}

export async function updateStateFromEvents(
  userId: string,
  workspaceId: string,
  events: IndexedEvent[]
): Promise<void> {
  if (events.length === 0) return

  // Update event layer
  await updateStateEvent(userId, workspaceId, (current) => {
    const updated: AIStateEvent = {
      recentEvents: [...current.recentEvents],
      activeTensions: [...current.activeTensions],
      activeKnowledge: [...current.activeKnowledge],
    }

    // Add new events to ring buffer (newest first)
    for (const event of events) {
      updated.recentEvents.unshift({
        eventId: event.eventId,
        label: event.label,
        type: event.type,
        section: event.section,
        threadType: event.threadType,
        timestamp: event.timestamp,
        isKeyChange: event.isKeyChange,
        isAIInvolved: event.isAIInvolved,
        tentative: false,
        reflection: null, // populated by IX-5 reflection LLM
      })
    }

    // Trim ring buffer — remove oldest
    while (updated.recentEvents.length > MAX_RECENT_EVENTS) {
      updated.recentEvents.pop()
    }

    return updated
  })

  // Update session layer
  await updateStateSession(userId, workspaceId, (current) => {
    const updated: AIStateSession = {
      currentSession: { ...current.currentSession },
      sessionSummary: current.sessionSummary,
      newFromTeam: [...current.newFromTeam],
    }

    // Initialize session if needed
    if (!updated.currentSession.startedAt) {
      updated.currentSession.startedAt = new Date().toISOString()
    }

    updated.currentSession.eventCount += events.length

    // Deep-copy arrays to avoid mutating the original
    updated.currentSession.sectionsVisited = [...current.currentSession.sectionsVisited]
    updated.currentSession.episodeIds = [...current.currentSession.episodeIds]
    updated.currentSession.documentsWorkedOn = current.currentSession.documentsWorkedOn.map(
      (d: { documentId: string; title: string; eventCount: number }) => ({ ...d })
    )

    for (const event of events) {
      // Track sections visited
      if (event.section && !updated.currentSession.sectionsVisited.includes(event.section)) {
        updated.currentSession.sectionsVisited.push(event.section)
      }

      // Track episodes
      if (event.episodeId && !updated.currentSession.episodeIds.includes(event.episodeId)) {
        updated.currentSession.episodeIds.push(event.episodeId)
      }

      // Track AI interactions
      if (event.isAIInvolved) {
        updated.currentSession.aiInteractionCount++
      }

      // Track documents worked on
      if (event.documentId) {
        const existing = updated.currentSession.documentsWorkedOn.find(
          (d: { documentId: string }) => d.documentId === event.documentId
        )
        if (existing) {
          existing.eventCount++
        } else if (updated.currentSession.documentsWorkedOn.length < MAX_DOCUMENTS_WORKED_ON) {
          updated.currentSession.documentsWorkedOn.push({
            documentId: event.documentId,
            title: event.documentTitle || 'Untitled',
            eventCount: 1,
          })
        }
      }
    }

    return updated
  })
}

// ─── Reflection-aware event updater (Sprint IX-5) ───

export interface IndexedEventWithReflection extends IndexedEvent {
  reflection: ReflectionOutput | null
}

export async function updateStateFromEventsWithReflections(
  userId: string,
  workspaceId: string,
  events: IndexedEventWithReflection[]
): Promise<void> {
  if (events.length === 0) return

  // Update event layer with reflections
  await updateStateEvent(userId, workspaceId, (current) => {
    const updated: AIStateEvent = {
      recentEvents: [...current.recentEvents],
      activeTensions: [...current.activeTensions],
      activeKnowledge: [...current.activeKnowledge],
    }

    for (const event of events) {
      // Add event with reflection to ring buffer
      updated.recentEvents.unshift({
        eventId: event.eventId,
        label: event.label,
        type: event.type,
        section: event.section,
        threadType: event.threadType,
        timestamp: event.timestamp,
        isKeyChange: event.isKeyChange,
        isAIInvolved: event.isAIInvolved,
        tentative: event.reflection !== null,
        reflection: event.reflection
          ? {
              tension: event.reflection.tension?.description || null,
              connection: event.reflection.connection?.description || null,
              shift: event.reflection.shift?.description || null,
              gap: event.reflection.gap?.description || null,
              knowledge: event.reflection.knowledge?.fact || null,
              confidence: event.reflection.overallConfidence,
            }
          : null,
      })

      // Process tension from reflection
      if (event.reflection?.tension) {
        const t = event.reflection.tension
        // Check for duplicate tensions (same sections)
        const isDuplicate = updated.activeTensions.some(
          (existing: { sections: string[]; resolvedAt: string | null }) =>
            existing.sections.some((s: string) => t.sections.includes(s)) && !existing.resolvedAt
        )

        if (!isDuplicate) {
          updated.activeTensions.unshift({
            id: `tension-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            description: t.description,
            severity: t.severity,
            sections: t.sections,
            confidence: event.reflection.overallConfidence,
            detectedAt: event.timestamp,
            tentative: true,
            resolvedAt: null,
            sourceEventIds: [event.eventId],
          })
        }

        // Cap tensions — remove oldest tentative first
        while (updated.activeTensions.length > MAX_ACTIVE_TENSIONS) {
          const tentativeIdx = [...updated.activeTensions]
            .reverse()
            .findIndex((t: { tentative: boolean }) => t.tentative)
          if (tentativeIdx >= 0) {
            updated.activeTensions.splice(
              updated.activeTensions.length - 1 - tentativeIdx,
              1
            )
          } else {
            updated.activeTensions.pop()
          }
        }
      }

      // Process knowledge from reflection
      if (event.reflection?.knowledge) {
        const k = event.reflection.knowledge
        // Check for duplicate knowledge
        const isDuplicate = updated.activeKnowledge.some(
          (existing: { fact: string }) =>
            existing.fact.toLowerCase().includes(k.fact.toLowerCase().slice(0, 30))
        )

        if (!isDuplicate) {
          updated.activeKnowledge.unshift({
            fact: k.fact,
            source: k.source,
            confidence: k.confidence,
            linkedSection: event.section,
            extractedAt: event.timestamp,
            fromUserId: userId,
            shared: false,
          })
        }

        // Cap knowledge — remove lowest confidence
        while (updated.activeKnowledge.length > MAX_ACTIVE_KNOWLEDGE) {
          const minIdx = updated.activeKnowledge.reduce(
            (minI: number, item: { confidence: number }, i: number, arr: Array<{ confidence: number }>) =>
              item.confidence < arr[minI]!.confidence ? i : minI,
            0
          )
          updated.activeKnowledge.splice(minIdx, 1)
        }
      }
    }

    // Trim ring buffer
    while (updated.recentEvents.length > MAX_RECENT_EVENTS) {
      updated.recentEvents.pop()
    }

    return updated
  })

  // Update session layer (same logic as updateStateFromEvents)
  await updateStateSession(userId, workspaceId, (current) => {
    const updated: AIStateSession = {
      currentSession: { ...current.currentSession },
      sessionSummary: current.sessionSummary,
      newFromTeam: [...current.newFromTeam],
    }

    if (!updated.currentSession.startedAt) {
      updated.currentSession.startedAt = new Date().toISOString()
    }

    updated.currentSession.eventCount += events.length
    updated.currentSession.sectionsVisited = [...current.currentSession.sectionsVisited]
    updated.currentSession.episodeIds = [...current.currentSession.episodeIds]
    updated.currentSession.documentsWorkedOn = current.currentSession.documentsWorkedOn.map(
      (d: { documentId: string; title: string; eventCount: number }) => ({ ...d })
    )

    for (const event of events) {
      if (event.section && !updated.currentSession.sectionsVisited.includes(event.section)) {
        updated.currentSession.sectionsVisited.push(event.section)
      }
      if (event.episodeId && !updated.currentSession.episodeIds.includes(event.episodeId)) {
        updated.currentSession.episodeIds.push(event.episodeId)
      }
      if (event.isAIInvolved) {
        updated.currentSession.aiInteractionCount++
      }
      if (event.documentId) {
        const existing = updated.currentSession.documentsWorkedOn.find(
          (d: { documentId: string }) => d.documentId === event.documentId
        )
        if (existing) {
          existing.eventCount++
        } else if (updated.currentSession.documentsWorkedOn.length < MAX_DOCUMENTS_WORKED_ON) {
          updated.currentSession.documentsWorkedOn.push({
            documentId: event.documentId,
            title: event.documentTitle || 'Untitled',
            eventCount: 1,
          })
        }
      }
    }

    return updated
  })
}
