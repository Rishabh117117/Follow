import { db } from '../../db'
import { aiState, documentSharedState } from '../../db/schema/ai-state'
import { eq, and } from 'drizzle-orm'
import type {
  AIStateEvent,
  AIStateSession,
  AIStatePersistent,
  DocumentSharedState,
} from '@workspace/shared/types'

// ─── Default state factories ───

export function defaultEventState(): AIStateEvent {
  return {
    recentEvents: [],
    activeTensions: [],
    activeKnowledge: [],
  }
}

export function defaultSessionState(): AIStateSession {
  return {
    currentSession: {
      startedAt: null,
      eventCount: 0,
      sectionsVisited: [],
      episodeIds: [],
      aiInteractionCount: 0,
      aiAcceptedCount: 0,
      aiRejectedCount: 0,
      documentsWorkedOn: [],
    },
    sessionSummary: null,
    newFromTeam: [],
  }
}

export function defaultPersistentState(): AIStatePersistent {
  return {
    patterns: {
      workStyle: null,
      productiveHours: null,
      avgSessionMinutes: null,
      aiPreferences: {
        grammarAcceptRate: null,
        structureAcceptRate: null,
        toneAcceptRate: null,
        prefersOptions: null,
      },
      collaborationStyle: null,
      stuckSignals: [],
    },
    longTermKnowledge: [],
    relationships: {
      frequentCollaborators: [],
      documentRoles: [],
    },
  }
}

export function defaultSharedState(): DocumentSharedState {
  return {
    contributions: [],
    knowledge: [],
    tensions: [],
    dynamics: {
      documentPhase: null,
      activeContributors: 0,
      editVelocity: 'steady',
      lastMajorChange: null,
      openQuestions: [],
    },
    aiUsage: {
      totalInteractions: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      acceptanceRate: 0,
      sectionsWithAIContent: [],
      byUser: [],
    },
  }
}

// ─── Read ───

export async function getOrCreateState(
  userId: string,
  workspaceId: string
): Promise<{
  stateEvent: AIStateEvent
  stateSession: AIStateSession
  statePersistent: AIStatePersistent
  version: number
}> {
  const existing = await db
    .select()
    .from(aiState)
    .where(and(eq(aiState.userId, userId), eq(aiState.workspaceId, workspaceId)))
    .limit(1)

  if (existing[0]) {
    return {
      stateEvent: (existing[0].stateEvent as AIStateEvent) || defaultEventState(),
      stateSession: (existing[0].stateSession as AIStateSession) || defaultSessionState(),
      statePersistent:
        (existing[0].statePersistent as AIStatePersistent) || defaultPersistentState(),
      version: existing[0].version,
    }
  }

  // Create new state
  const newState = {
    userId,
    workspaceId,
    stateEvent: defaultEventState() as unknown as Record<string, unknown>,
    stateSession: defaultSessionState() as unknown as Record<string, unknown>,
    statePersistent: defaultPersistentState() as unknown as Record<string, unknown>,
    version: 1,
  }

  await db.insert(aiState).values(newState).onConflictDoNothing()

  return {
    stateEvent: defaultEventState(),
    stateSession: defaultSessionState(),
    statePersistent: defaultPersistentState(),
    version: 1,
  }
}

// ─── Write with optimistic concurrency ───

export async function updateStateEvent(
  userId: string,
  workspaceId: string,
  updater: (current: AIStateEvent) => AIStateEvent,
  maxRetries: number = 3
): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { stateEvent, version } = await getOrCreateState(userId, workspaceId)
    const updated = updater(stateEvent)

    await db
      .update(aiState)
      .set({
        stateEvent: updated as unknown as Record<string, unknown>,
        version: version + 1,
        lastEventUpdate: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiState.userId, userId),
          eq(aiState.workspaceId, workspaceId),
          eq(aiState.version, version)
        )
      )

    // Verify update succeeded
    const check = await db
      .select({ version: aiState.version })
      .from(aiState)
      .where(and(eq(aiState.userId, userId), eq(aiState.workspaceId, workspaceId)))
      .limit(1)

    if (check[0]?.version === version + 1) return true // success

    // Version conflict — retry after short delay
    await new Promise((r) => setTimeout(r, 50 * (attempt + 1)))
  }

  console.warn(`[AIState] Failed to update event state after ${maxRetries} retries for user ${userId}`)
  return false
}

export async function updateStateSession(
  userId: string,
  workspaceId: string,
  updater: (current: AIStateSession) => AIStateSession,
  maxRetries: number = 3
): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { stateSession, version } = await getOrCreateState(userId, workspaceId)
    const updated = updater(stateSession)

    await db
      .update(aiState)
      .set({
        stateSession: updated as unknown as Record<string, unknown>,
        version: version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiState.userId, userId),
          eq(aiState.workspaceId, workspaceId),
          eq(aiState.version, version)
        )
      )

    const check = await db
      .select({ version: aiState.version })
      .from(aiState)
      .where(and(eq(aiState.userId, userId), eq(aiState.workspaceId, workspaceId)))
      .limit(1)

    if (check[0]?.version === version + 1) return true
    await new Promise((r) => setTimeout(r, 50 * (attempt + 1)))
  }
  return false
}

export async function updateStatePersistent(
  userId: string,
  workspaceId: string,
  updater: (current: AIStatePersistent) => AIStatePersistent
): Promise<boolean> {
  // Persistent layer changes rarely — single attempt is usually fine
  const { statePersistent, version } = await getOrCreateState(userId, workspaceId)
  const updated = updater(statePersistent)

  await db
    .update(aiState)
    .set({
      statePersistent: updated as unknown as Record<string, unknown>,
      version: version + 1,
      lastPatternDetection: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiState.userId, userId),
        eq(aiState.workspaceId, workspaceId),
        eq(aiState.version, version)
      )
    )

  return true
}

// ─── Shared state ───

export async function getOrCreateSharedState(
  documentId: string,
  workspaceId: string
): Promise<{ state: DocumentSharedState; version: number }> {
  const existing = await db
    .select()
    .from(documentSharedState)
    .where(eq(documentSharedState.documentId, documentId))
    .limit(1)

  if (existing[0]) {
    return {
      state: (existing[0].state as DocumentSharedState) || defaultSharedState(),
      version: existing[0].version,
    }
  }

  const state = defaultSharedState()
  await db
    .insert(documentSharedState)
    .values({
      documentId,
      workspaceId,
      state: state as unknown as Record<string, unknown>,
      version: 1,
    })
    .onConflictDoNothing()

  return { state, version: 1 }
}

export async function updateSharedState(
  documentId: string,
  workspaceId: string,
  updater: (current: DocumentSharedState) => DocumentSharedState,
  maxRetries: number = 3
): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { state, version } = await getOrCreateSharedState(documentId, workspaceId)
    const updated = updater(state)

    await db
      .update(documentSharedState)
      .set({
        state: updated as unknown as Record<string, unknown>,
        version: version + 1,
        lastUpdated: new Date(),
      })
      .where(
        and(
          eq(documentSharedState.documentId, documentId),
          eq(documentSharedState.version, version)
        )
      )

    const check = await db
      .select({ version: documentSharedState.version })
      .from(documentSharedState)
      .where(eq(documentSharedState.documentId, documentId))
      .limit(1)

    if (check[0]?.version === version + 1) return true
    await new Promise((r) => setTimeout(r, 50 * (attempt + 1)))
  }
  return false
}
