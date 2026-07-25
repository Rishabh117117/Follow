import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AIStateImmediate } from '@workspace/shared/types'

// In-memory Redis mock
let redisStore: Record<string, { value: string; ttl: number }> = {}

vi.mock('../../../redis', () => ({
  redis: {
    get: vi.fn(async (key: string) => redisStore[key]?.value ?? null),
    setex: vi.fn(async (key: string, ttl: number, value: string) => {
      redisStore[key] = { value, ttl }
      return 'OK'
    }),
  },
}))

import {
  getImmediateState,
  updateFromHeartbeat,
  updateFromSignal,
  updateChatState,
} from '../immediate-updater'

beforeEach(() => {
  redisStore = {}
})

describe('getImmediateState', () => {
  it('returns default state when no Redis key exists', async () => {
    const state = await getImmediateState('user-1', 'ws-1')
    expect(state.focus.surface).toBe('idle')
    expect(state.focus.documentId).toBeNull()
    expect(state.presence.isIdle).toBe(true)
    expect(state.chat.isActive).toBe(false)
    expect(state.chat.turnCountThisSession).toBe(0)
  })

  it('returns stored state from Redis', async () => {
    const stored: AIStateImmediate = {
      focus: {
        documentId: 'doc-1',
        documentTitle: 'Test Doc',
        sectionRef: 'Introduction',
        sectionViewStartedAt: '2024-01-01T00:00:00Z',
        surface: 'doc',
        activeUrl: null,
        updatedAt: '2024-01-01T00:00:00Z',
      },
      presence: { isIdle: false, idleSince: null, collaborators: [], activeSince: '2024-01-01T00:00:00Z' },
      chat: { isActive: false, lastTurnAt: null, activeConversationId: null, turnCountThisSession: 0 },
    }
    redisStore['ai_state_immediate:ws-1:user-1'] = { value: JSON.stringify(stored), ttl: 600 }

    const state = await getImmediateState('user-1', 'ws-1')
    expect(state.focus.documentId).toBe('doc-1')
    expect(state.focus.surface).toBe('doc')
  })

  it('returns defaults for corrupted Redis data', async () => {
    redisStore['ai_state_immediate:ws-1:user-1'] = { value: 'not-json', ttl: 600 }
    const state = await getImmediateState('user-1', 'ws-1')
    expect(state.focus.surface).toBe('idle')
  })
})

describe('updateFromHeartbeat', () => {
  it('updates focus from heartbeat', async () => {
    await updateFromHeartbeat('user-1', 'ws-1', {
      activeDocumentId: 'doc-1',
      activeDocumentName: 'My Doc',
      isIdle: false,
    })

    const state = await getImmediateState('user-1', 'ws-1')
    expect(state.focus.documentId).toBe('doc-1')
    expect(state.focus.documentTitle).toBe('My Doc')
    expect(state.focus.surface).toBe('doc')
    expect(state.presence.isIdle).toBe(false)
  })

  it('parses cursor_context JSON for section info', async () => {
    await updateFromHeartbeat('user-1', 'ws-1', {
      activeDocumentId: 'doc-1',
      cursorContext: JSON.stringify({ sectionTitle: 'Methods', paragraphIndex: 3 }),
    })

    const state = await getImmediateState('user-1', 'ws-1')
    expect(state.focus.sectionRef).toBe('Methods')
    expect(state.focus.sectionViewStartedAt).toBeTruthy()
  })

  it('handles malformed cursor_context as plain string', async () => {
    await updateFromHeartbeat('user-1', 'ws-1', {
      activeDocumentId: 'doc-1',
      cursorContext: 'paragraph 5',
    })

    const state = await getImmediateState('user-1', 'ws-1')
    expect(state.focus.sectionRef).toBe('paragraph 5')
  })

  it('sets idle when transitioning from active to idle', async () => {
    // First: not idle
    await updateFromHeartbeat('user-1', 'ws-1', { isIdle: false })
    let state = await getImmediateState('user-1', 'ws-1')
    expect(state.presence.isIdle).toBe(false)

    // Then: idle
    await updateFromHeartbeat('user-1', 'ws-1', { isIdle: true })
    state = await getImmediateState('user-1', 'ws-1')
    expect(state.presence.isIdle).toBe(true)
    expect(state.presence.idleSince).toBeTruthy()
    expect(state.focus.surface).toBe('idle')
  })
})

describe('updateFromSignal', () => {
  it('detects browser surface from web_navigate signal', async () => {
    await updateFromSignal('user-1', 'ws-1', {
      signalType: 'web_navigate',
      metadata: { url: 'https://example.com' },
    })

    const state = await getImmediateState('user-1', 'ws-1')
    expect(state.focus.surface).toBe('browser')
    expect(state.focus.activeUrl).toBe('https://example.com')
  })

  it('tracks AI chat turns', async () => {
    await updateFromSignal('user-1', 'ws-1', { signalType: 'ai_turn_native' })
    await updateFromSignal('user-1', 'ws-1', { signalType: 'ai_turn_native' })

    const state = await getImmediateState('user-1', 'ws-1')
    expect(state.chat.isActive).toBe(true)
    expect(state.chat.turnCountThisSession).toBe(2)
    expect(state.focus.surface).toBe('chat')
  })

  it('tracks collaborator join/leave', async () => {
    await updateFromSignal('user-1', 'ws-1', {
      signalType: 'gws_collaborator_join',
      metadata: { collaboratorName: 'Alice', collaboratorId: 'user-2' },
    })

    let state = await getImmediateState('user-1', 'ws-1')
    expect(state.presence.collaborators).toHaveLength(1)
    expect(state.presence.collaborators[0]?.name).toBe('Alice')

    await updateFromSignal('user-1', 'ws-1', {
      signalType: 'gws_collaborator_leave',
      metadata: { collaboratorName: 'Alice' },
    })

    state = await getImmediateState('user-1', 'ws-1')
    expect(state.presence.collaborators).toHaveLength(0)
  })

  it('sets idle from idle_state signal', async () => {
    await updateFromSignal('user-1', 'ws-1', {
      signalType: 'idle_state',
      metadata: { state: 'idle' },
    })

    const state = await getImmediateState('user-1', 'ws-1')
    expect(state.presence.isIdle).toBe(true)
    expect(state.focus.surface).toBe('idle')
  })

  it('marks doc surface for doc edits', async () => {
    await updateFromSignal('user-1', 'ws-1', { signalType: 'doc_edit' })

    const state = await getImmediateState('user-1', 'ws-1')
    expect(state.focus.surface).toBe('doc')
    expect(state.presence.isIdle).toBe(false)
  })
})

describe('updateChatState', () => {
  it('marks chat active with conversation ID', async () => {
    await updateChatState('user-1', 'ws-1', 'conv-1', true)

    const state = await getImmediateState('user-1', 'ws-1')
    expect(state.chat.isActive).toBe(true)
    expect(state.chat.activeConversationId).toBe('conv-1')
    expect(state.chat.lastTurnAt).toBeTruthy()
    expect(state.focus.surface).toBe('chat')
  })

  it('marks chat inactive', async () => {
    await updateChatState('user-1', 'ws-1', 'conv-1', true)
    await updateChatState('user-1', 'ws-1', null, false)

    const state = await getImmediateState('user-1', 'ws-1')
    expect(state.chat.isActive).toBe(false)
    expect(state.chat.activeConversationId).toBeNull()
  })
})
