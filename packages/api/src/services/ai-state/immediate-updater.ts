import { redis } from '../../redis'
import type { AIStateImmediate } from '@workspace/shared/types'

const IMMEDIATE_STATE_TTL = 600 // 10 minutes — auto-expires if no signals (user left)
const REDIS_KEY_PREFIX = 'ai_state_immediate'

function redisKey(userId: string, workspaceId: string): string {
  return `${REDIS_KEY_PREFIX}:${workspaceId}:${userId}`
}

// ─── Read ───

export async function getImmediateState(
  userId: string,
  workspaceId: string
): Promise<AIStateImmediate> {
  const raw = await redis.get(redisKey(userId, workspaceId))

  if (raw) {
    try {
      return JSON.parse(raw)
    } catch {
      /* fall through to default */
    }
  }

  return defaultImmediate()
}

function defaultImmediate(): AIStateImmediate {
  return {
    focus: {
      documentId: null,
      documentTitle: null,
      sectionRef: null,
      sectionViewStartedAt: null,
      surface: 'idle',
      activeUrl: null,
      updatedAt: new Date().toISOString(),
    },
    presence: {
      isIdle: true,
      idleSince: new Date().toISOString(),
      collaborators: [],
      activeSince: null,
    },
    chat: {
      isActive: false,
      lastTurnAt: null,
      activeConversationId: null,
      turnCountThisSession: 0,
    },
  }
}

// ─── Write ───

async function writeImmediate(
  userId: string,
  workspaceId: string,
  state: AIStateImmediate
): Promise<void> {
  await redis.setex(redisKey(userId, workspaceId), IMMEDIATE_STATE_TTL, JSON.stringify(state))
}

// ─── Signal-based updates ───

export async function updateFromHeartbeat(
  userId: string,
  workspaceId: string,
  heartbeat: {
    activeDocumentId?: string | null
    activeDocumentName?: string | null
    cursorContext?: string
    isIdle?: boolean
  }
): Promise<void> {
  const state = await getImmediateState(userId, workspaceId)
  const now = new Date().toISOString()

  // Update focus
  if (heartbeat.activeDocumentId) {
    const prevDocId = state.focus.documentId
    state.focus.documentId = heartbeat.activeDocumentId
    state.focus.documentTitle = heartbeat.activeDocumentName || state.focus.documentTitle
    state.focus.updatedAt = now

    // Parse cursor context for section info
    if (heartbeat.cursorContext) {
      try {
        const ctx = JSON.parse(heartbeat.cursorContext)
        const newSection = ctx.sectionTitle || ctx.heading || ctx.section || null
        if (newSection !== state.focus.sectionRef) {
          state.focus.sectionRef = newSection
          state.focus.sectionViewStartedAt = now
        }
      } catch {
        // cursor_context is not JSON — use as-is
        if (heartbeat.cursorContext !== state.focus.sectionRef) {
          state.focus.sectionRef = heartbeat.cursorContext
          state.focus.sectionViewStartedAt = now
        }
      }
    }

    // Detect surface change
    if (prevDocId !== heartbeat.activeDocumentId) {
      state.focus.surface = 'doc'
    }
  }

  // Update idle status
  if (heartbeat.isIdle !== undefined) {
    if (heartbeat.isIdle && !state.presence.isIdle) {
      state.presence.isIdle = true
      state.presence.idleSince = now
      state.focus.surface = 'idle'
    } else if (!heartbeat.isIdle && state.presence.isIdle) {
      state.presence.isIdle = false
      state.presence.idleSince = null
      if (!state.presence.activeSince) {
        state.presence.activeSince = now
      }
    }
  }

  await writeImmediate(userId, workspaceId, state)
}

export async function updateFromSignal(
  userId: string,
  workspaceId: string,
  signal: {
    signalType: string
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  const state = await getImmediateState(userId, workspaceId)
  const now = new Date().toISOString()

  // Surface detection from signal types
  switch (signal.signalType) {
    case 'web_navigate':
    case 'tab_switch':
    case 'page_navigate':
      state.focus.surface = 'browser'
      state.focus.activeUrl = (signal.metadata?.url as string) || null
      break

    case 'ai_turn_native':
      state.chat.isActive = true
      state.chat.lastTurnAt = now
      state.chat.turnCountThisSession++
      state.focus.surface = 'chat'
      break

    case 'doc_edit':
    case 'doc_structural_change':
    case 'gws_doc_edit':
    case 'gws_doc_structural':
      state.focus.surface = 'doc'
      state.presence.isIdle = false
      state.presence.idleSince = null
      break

    case 'idle_state':
      if (
        signal.metadata?.state === 'idle' ||
        signal.metadata?.state === 'locked'
      ) {
        state.presence.isIdle = true
        state.presence.idleSince = now
        state.focus.surface = 'idle'
      }
      break

    case 'gws_collaborator_join':
      if (signal.metadata?.collaboratorName) {
        const existing = state.presence.collaborators.find(
          (c: { name: string }) => c.name === signal.metadata!.collaboratorName
        )
        if (!existing) {
          state.presence.collaborators.push({
            userId: (signal.metadata.collaboratorId as string) || 'unknown',
            name: signal.metadata.collaboratorName as string,
            section: null,
            lastSeen: now,
          })
        }
      }
      break

    case 'gws_collaborator_leave':
      if (signal.metadata?.collaboratorName) {
        state.presence.collaborators = state.presence.collaborators.filter(
          (c: { name: string }) => c.name !== signal.metadata!.collaboratorName
        )
      }
      break
  }

  state.focus.updatedAt = now
  await writeImmediate(userId, workspaceId, state)
}

export async function updateChatState(
  userId: string,
  workspaceId: string,
  conversationId: string | null,
  active: boolean
): Promise<void> {
  const state = await getImmediateState(userId, workspaceId)
  state.chat.isActive = active
  state.chat.activeConversationId = conversationId
  if (active) {
    state.chat.lastTurnAt = new Date().toISOString()
    state.focus.surface = 'chat'
  }
  await writeImmediate(userId, workspaceId, state)
}
