import { broadcast } from '../../ws'
import { db } from '../../db'
import { strandCollaborators, strands } from '../../db/schema/threads'
import { eq } from 'drizzle-orm'
import { updateStateSession, getOrCreateSharedState } from './state-manager'
import type { DocumentSharedState } from '@workspace/shared/types'

// Debounce shared state pushes
const pendingPushes = new Map<
  string,
  { documentId: string; workspaceId: string; timer: NodeJS.Timeout }
>()

const DEBOUNCE_MS = 30_000 // 30 seconds for normal updates
const CRITICAL_DEBOUNCE_MS = 2_000 // 2 seconds for high-severity tensions

/**
 * Schedule a push of shared state updates to collaborators.
 * Debounced: batches rapid updates into a single push.
 */
export function scheduleSharedStatePush(
  documentId: string,
  workspaceId: string,
  isCritical: boolean = false
): void {
  const key = `${documentId}:${workspaceId}`
  const debounceTime = isCritical ? CRITICAL_DEBOUNCE_MS : DEBOUNCE_MS

  const existing = pendingPushes.get(key)
  if (existing) {
    clearTimeout(existing.timer)
  }

  const timer = setTimeout(() => {
    pushSharedStateToCollaborators(documentId, workspaceId).catch((err) =>
      console.warn('[Propagator] Push failed:', err)
    )
    pendingPushes.delete(key)
  }, debounceTime)

  pendingPushes.set(key, { documentId, workspaceId, timer })
}

/**
 * Push shared state summary to all collaborators' personal states.
 */
async function pushSharedStateToCollaborators(
  documentId: string,
  workspaceId: string
): Promise<void> {
  const { state: sharedState } = await getOrCreateSharedState(documentId, workspaceId)

  const collaboratorIds = await getDocumentCollaboratorIds(workspaceId)
  if (collaboratorIds.length === 0) return

  const summary = buildSharedStateSummary(sharedState)

  for (const collabUserId of collaboratorIds) {
    try {
      await updateStateSession(collabUserId, workspaceId, (current) => {
        const updated = { ...current, newFromTeam: [...current.newFromTeam] }

        for (const item of summary) {
          const isDuplicate = updated.newFromTeam.some(
            (m: { memory: string; fromUserId: string }) =>
              m.memory === item.memory && m.fromUserId === item.fromUserId
          )
          if (!isDuplicate) {
            updated.newFromTeam.unshift(item)
          }
        }

        if (updated.newFromTeam.length > 10) {
          updated.newFromTeam = updated.newFromTeam.slice(0, 10)
        }

        return updated
      })
    } catch (err) {
      console.warn(`[Propagator] Failed to update state for user ${collabUserId}:`, err)
    }
  }

  // Broadcast via WebSocket for real-time UI updates
  try {
    broadcast(`workspace:${workspaceId}`, {
      type: 'shared_state_update',
      payload: {
        documentId,
        summary: summary.slice(0, 3),
        timestamp: new Date().toISOString(),
      },
    })
  } catch {
    // WebSocket broadcast failure is non-critical
  }
}

export function buildSharedStateSummary(state: DocumentSharedState): Array<{
  fromUserId: string
  fromUserName: string
  memory: string
  relevantSection: string | null
  receivedAt: string
  surfaced: boolean
}> {
  const items: Array<{
    fromUserId: string
    fromUserName: string
    memory: string
    relevantSection: string | null
    receivedAt: string
    surfaced: boolean
  }> = []

  // Recent intentional knowledge shares
  const recentKnowledge = state.knowledge
    .filter((k: { method: string; status: string }) => k.method === 'intentional' && k.status === 'active')
    .sort(
      (a: { sharedAt: string }, b: { sharedAt: string }) =>
        new Date(b.sharedAt).getTime() - new Date(a.sharedAt).getTime()
    )
    .slice(0, 3)

  for (const k of recentKnowledge) {
    items.push({
      fromUserId: k.contributedBy,
      fromUserName: k.contributedByName,
      memory: `Shared finding: ${k.fact}`,
      relevantSection: k.linkedSection,
      receivedAt: k.sharedAt,
      surfaced: false,
    })
  }

  // Recent high-severity tensions
  const recentTensions = state.tensions
    .filter((t: { severity: string; resolvedAt: string | null }) => t.severity === 'high' && !t.resolvedAt)
    .sort(
      (a: { detectedAt: string }, b: { detectedAt: string }) =>
        new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
    )
    .slice(0, 2)

  for (const t of recentTensions) {
    items.push({
      fromUserId: t.involvedUsers[0] || 'system',
      fromUserName: 'System',
      memory: `Tension detected: ${t.description}`,
      relevantSection: t.involvedSections[0] || null,
      receivedAt: t.detectedAt,
      surfaced: false,
    })
  }

  // Last major change
  if (state.dynamics.lastMajorChange) {
    const change = state.dynamics.lastMajorChange
    items.push({
      fromUserId: change.userId,
      fromUserName: change.userName,
      memory: `Key change: ${change.description}`,
      relevantSection: change.section,
      receivedAt: change.timestamp,
      surfaced: false,
    })
  }

  return items
}

async function getDocumentCollaboratorIds(workspaceId: string): Promise<string[]> {
  const collabs = await db
    .selectDistinct({ userId: strandCollaborators.userId })
    .from(strandCollaborators)
    .innerJoin(strands, eq(strandCollaborators.strandId, strands.id))
    .where(eq(strands.workspaceId, workspaceId))
    .limit(50)

  return collabs.map((c) => c.userId)
}
