import { updateSharedState } from './state-manager'
import { db } from '../../db'
import { strandCollaborators, strands, strandThreadRefs } from '../../db/schema/threads'
import { eq } from 'drizzle-orm'
import type { DocumentSharedState } from '@workspace/shared/types'

export interface SharedStateEventInput {
  eventId: string
  label: string
  type: string
  section: string | null
  threadType: string
  timestamp: string
  isKeyChange: boolean
  isAIInvolved: boolean
  magnitude: string
  userId: string
  userName: string
  documentId: string
  documentTitle: string | null
  wordsDelta: number
  reflection: {
    tension: { description: string; severity: string; sections: string[] } | null
    knowledge: { fact: string; source: string; confidence: number } | null
  } | null
}

/**
 * Update the document shared state from newly indexed events.
 * Called for events on documents that have collaborators.
 */
export async function updateSharedStateFromEvents(
  documentId: string,
  workspaceId: string,
  events: SharedStateEventInput[]
): Promise<void> {
  if (events.length === 0) return

  await updateSharedState(documentId, workspaceId, (current) => {
    const updated: DocumentSharedState = {
      contributions: [...current.contributions],
      knowledge: [...current.knowledge],
      tensions: [...current.tensions],
      dynamics: { ...current.dynamics },
      aiUsage: { ...current.aiUsage },
    }

    for (const event of events) {
      updateContributions(updated, event)

      // Edit conflict detection
      const conflict = detectEditConflict(updated, event)
      if (conflict.hasConflict && conflict.otherUserId) {
        const otherUser = updated.contributions.find(
          (c: { userId: string }) => c.userId === conflict.otherUserId
        )
        const existingConflict = updated.tensions.find(
          (t: { type: string; involvedSections: string[]; resolvedAt: string | null }) =>
            t.type === 'dependency' &&
            t.involvedSections.includes(event.section!) &&
            !t.resolvedAt
        )
        if (!existingConflict) {
          updated.tensions.push({
            id: `edit-conflict-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            description: `${event.userName} and ${otherUser?.userName || 'another user'} edited ${event.section} within seconds of each other`,
            severity: 'medium',
            type: 'dependency',
            involvedUsers: [event.userId, conflict.otherUserId],
            involvedSections: [event.section!],
            detectedAt: event.timestamp,
            resolvedAt: null,
            resolution: null,
            confidence: 0.9,
          })
        }
      }

      if (event.isAIInvolved) {
        updateAIUsage(updated, event)
      }

      updateDynamics(updated, event)

      if (event.reflection?.knowledge && event.isKeyChange) {
        addAutoKnowledge(updated, event)
      }

      if (event.reflection?.tension) {
        addCrossUserTension(updated, event)
      }
    }

    // Cap tensions
    while (updated.tensions.length > 10) {
      const resolvedIdx = updated.tensions.findIndex(
        (t: { resolvedAt: string | null }) => t.resolvedAt
      )
      if (resolvedIdx >= 0) {
        updated.tensions.splice(resolvedIdx, 1)
      } else {
        updated.tensions.pop()
      }
    }

    return updated
  })

  // Schedule propagation to collaborators
  try {
    const { scheduleSharedStatePush } = await import('./shared-state-propagator')
    const hasCritical = events.some(
      (e) => e.reflection?.tension?.severity === 'high' || e.isKeyChange
    )
    scheduleSharedStatePush(documentId, workspaceId, hasCritical)
  } catch (err) {
    console.warn('[SharedState] Propagation scheduling failed:', err)
  }
}

function updateContributions(state: DocumentSharedState, event: SharedStateEventInput): void {
  let contributor = state.contributions.find(
    (c: { userId: string }) => c.userId === event.userId
  )

  if (!contributor) {
    const newContributor = {
      userId: event.userId,
      userName: event.userName,
      sections: [] as Array<{ sectionRef: string; editCount: number; lastEditAt: string; wordsDelta: number; isAIAssisted: boolean }>,
      totalEvents: 0,
      lastActiveAt: event.timestamp,
      role: 'light_editor' as const,
    }
    state.contributions.push(newContributor)
    contributor = newContributor
  }

  contributor.totalEvents++
  contributor.lastActiveAt = event.timestamp

  if (
    event.section &&
    (event.type === 'edit' ||
      event.type === 'structural_change' ||
      event.type === 'ai_interaction')
  ) {
    let section = contributor.sections.find(
      (s: { sectionRef: string }) => s.sectionRef === event.section
    )
    if (!section) {
      section = {
        sectionRef: event.section,
        editCount: 0,
        lastEditAt: event.timestamp,
        wordsDelta: 0,
        isAIAssisted: false,
      }
      contributor.sections.push(section)
    }
    section.editCount++
    section.lastEditAt = event.timestamp
    section.wordsDelta += event.wordsDelta || 0
    if (event.isAIInvolved) section.isAIAssisted = true
  }

  // Compute roles
  const totalEdits = state.contributions.reduce(
    (sum: number, c: { totalEvents: number }) => sum + c.totalEvents,
    0
  )
  for (const c of state.contributions) {
    const share = c.totalEvents / Math.max(totalEdits, 1)
    if (share > 0.4) c.role = 'heavy_editor'
    else if (share > 0.1) c.role = 'light_editor'
    else if (c.sections.length === 0) c.role = 'viewer'
    else c.role = 'reviewer'
  }
}

function updateAIUsage(state: DocumentSharedState, event: SharedStateEventInput): void {
  state.aiUsage.totalInteractions++

  if (event.section && !state.aiUsage.sectionsWithAIContent.includes(event.section)) {
    state.aiUsage.sectionsWithAIContent.push(event.section)
  }

  let userUsage = state.aiUsage.byUser.find(
    (u: { userId: string }) => u.userId === event.userId
  )
  if (!userUsage) {
    userUsage = {
      userId: event.userId,
      userName: event.userName,
      interactions: 0,
      acceptRate: 0,
    }
    state.aiUsage.byUser.push(userUsage)
  }
  userUsage.interactions++

  state.aiUsage.acceptanceRate =
    state.aiUsage.acceptedCount / Math.max(state.aiUsage.totalInteractions, 1)
}

function updateDynamics(state: DocumentSharedState, event: SharedStateEventInput): void {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000
  state.dynamics.activeContributors = state.contributions.filter(
    (c: { lastActiveAt: string }) => new Date(c.lastActiveAt).getTime() > dayAgo
  ).length

  if (event.isKeyChange) {
    state.dynamics.lastMajorChange = {
      description: event.label,
      userId: event.userId,
      userName: event.userName,
      timestamp: event.timestamp,
      section: event.section || 'unknown',
    }
  }

  const now = Date.now()
  const lastHourEvents = state.contributions.reduce(
    (sum: number, c: { sections: Array<{ lastEditAt: string; editCount: number }> }) => {
      return (
        sum +
        c.sections
          .filter((s) => now - new Date(s.lastEditAt).getTime() < 60 * 60 * 1000)
          .reduce((s2: number, sec) => s2 + sec.editCount, 0)
      )
    },
    0
  )

  if (lastHourEvents > 10) state.dynamics.editVelocity = 'accelerating'
  else if (lastHourEvents > 3) state.dynamics.editVelocity = 'steady'
  else if (lastHourEvents > 0) state.dynamics.editVelocity = 'slowing'
  else state.dynamics.editVelocity = 'stalled'
}

function addAutoKnowledge(state: DocumentSharedState, event: SharedStateEventInput): void {
  if (!event.reflection?.knowledge) return

  const k = event.reflection.knowledge
  const isDuplicate = state.knowledge.some(
    (existing: { fact: string }) =>
      existing.fact.toLowerCase().includes(k.fact.toLowerCase().slice(0, 30)) ||
      k.fact.toLowerCase().includes(existing.fact.toLowerCase().slice(0, 30))
  )
  if (isDuplicate) return

  state.knowledge.push({
    id: `knowledge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fact: k.fact,
    source: k.source,
    confidence: k.confidence,
    contributedBy: event.userId,
    contributedByName: event.userName,
    sharedAt: event.timestamp,
    method: 'extracted',
    linkedSection: event.section,
    conflictsWith: null,
    status: 'active',
  })

  if (state.knowledge.length > 30) {
    state.knowledge.sort(
      (a: { confidence: number }, b: { confidence: number }) => b.confidence - a.confidence
    )
    state.knowledge = state.knowledge.slice(0, 30)
  }
}

function addCrossUserTension(state: DocumentSharedState, event: SharedStateEventInput): void {
  if (!event.reflection?.tension) return

  const t = event.reflection.tension
  const otherContributors = state.contributions.filter(
    (c: { userId: string; sections: Array<{ sectionRef: string }> }) =>
      c.userId !== event.userId &&
      c.sections.some((s) => t.sections.includes(s.sectionRef))
  )

  if (otherContributors.length === 0) return

  const isDuplicate = state.tensions.some(
    (existing: { involvedSections: string[]; resolvedAt: string | null }) =>
      existing.involvedSections.some((s: string) => t.sections.includes(s)) && !existing.resolvedAt
  )
  if (isDuplicate) return

  state.tensions.push({
    id: `tension-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: t.description,
    severity: t.severity as 'low' | 'medium' | 'high',
    type: 'gap',
    involvedUsers: [event.userId, ...otherContributors.map((c: { userId: string }) => c.userId)],
    involvedSections: t.sections,
    detectedAt: event.timestamp,
    resolvedAt: null,
    resolution: null,
    confidence: event.reflection?.knowledge?.confidence || 0.5,
  })
}

/**
 * Detect concurrent edits: two users editing the same section within 60 seconds.
 */
function detectEditConflict(
  state: DocumentSharedState,
  newEvent: SharedStateEventInput
): { hasConflict: boolean; otherUserId: string | null } {
  if (newEvent.type !== 'edit' && newEvent.type !== 'structural_change') {
    return { hasConflict: false, otherUserId: null }
  }
  if (!newEvent.section) return { hasConflict: false, otherUserId: null }

  const sixtySecondsAgo = new Date(
    new Date(newEvent.timestamp).getTime() - 60_000
  ).toISOString()

  for (const contributor of state.contributions) {
    if (contributor.userId === newEvent.userId) continue

    for (const section of contributor.sections) {
      if (section.sectionRef === newEvent.section && section.lastEditAt > sixtySecondsAgo) {
        return { hasConflict: true, otherUserId: contributor.userId }
      }
    }
  }

  return { hasConflict: false, otherUserId: null }
}

/**
 * Check if a document has collaborators (any strand with collaborators).
 */
export async function isSharedDocument(
  documentId: string,
  workspaceId: string
): Promise<boolean> {
  const strandRefs = await db
    .select({ strandId: strandThreadRefs.strandId })
    .from(strandThreadRefs)
    .innerJoin(strands, eq(strandThreadRefs.strandId, strands.id))
    .where(eq(strands.workspaceId, workspaceId))
    .limit(10)

  if (strandRefs.length === 0) return false

  for (const ref of strandRefs) {
    const collabs = await db
      .select({ id: strandCollaborators.id })
      .from(strandCollaborators)
      .where(eq(strandCollaborators.strandId, ref.strandId))
      .limit(1)
    if (collabs.length > 0) return true
  }

  return false
}
