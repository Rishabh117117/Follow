import { describe, it, expect, beforeEach } from 'vitest'
import {
  useGroupThreadStore,
  hasMention,
  extractMentions,
  stripMentions,
  getMemberColor,
  getInitials,
  AI_MENTION,
  type GroupMessage,
  type GroupMember,
} from '@/stores/group-thread-store'

/**
 * Group Threads — tests for group thread store, @Follow mention detection,
 * member management, and utility functions.
 */

function makeMessage(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    threadId: 'thread-1',
    senderId: 'user-1',
    senderName: 'Test User',
    content: 'Hello everyone',
    isAI: false,
    mentionTrigger: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeMember(overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    id: `member-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Member',
    avatar: 'TM',
    color: '#7C3AED',
    isOnline: true,
    ...overrides,
  }
}

describe('GroupThreadStore', () => {
  beforeEach(() => {
    useGroupThreadStore.getState().reset()
  })

  it('should initialize with empty state', () => {
    const state = useGroupThreadStore.getState()
    expect(state.messages).toEqual([])
    expect(state.members).toEqual([])
    expect(state.activeGroupThreadId).toBeNull()
    expect(state.isConnected).toBe(false)
    expect(state.aiResponding).toBe(false)
  })

  it('should add messages', () => {
    const msg1 = makeMessage({ id: 'msg-1', content: 'Hello' })
    const msg2 = makeMessage({ id: 'msg-2', content: 'World' })

    useGroupThreadStore.getState().addMessage(msg1)
    useGroupThreadStore.getState().addMessage(msg2)

    expect(useGroupThreadStore.getState().messages).toHaveLength(2)
    expect(useGroupThreadStore.getState().messages[0]!.content).toBe('Hello')
    expect(useGroupThreadStore.getState().messages[1]!.content).toBe('World')
  })

  it('should set and clear messages', () => {
    const msgs = [makeMessage({ id: 'msg-1' }), makeMessage({ id: 'msg-2' })]
    useGroupThreadStore.getState().setMessages(msgs)
    expect(useGroupThreadStore.getState().messages).toHaveLength(2)

    useGroupThreadStore.getState().clearMessages()
    expect(useGroupThreadStore.getState().messages).toHaveLength(0)
  })

  it('should manage members', () => {
    const member = makeMember({ id: 'u1', name: 'Alice' })

    useGroupThreadStore.getState().addMember(member)
    expect(useGroupThreadStore.getState().members).toHaveLength(1)

    // Duplicate add should be ignored
    useGroupThreadStore.getState().addMember(member)
    expect(useGroupThreadStore.getState().members).toHaveLength(1)

    useGroupThreadStore.getState().removeMember('u1')
    expect(useGroupThreadStore.getState().members).toHaveLength(0)
  })

  it('should update member online status', () => {
    const member = makeMember({ id: 'u1', isOnline: true })
    useGroupThreadStore.getState().addMember(member)

    useGroupThreadStore.getState().updateMemberOnline('u1', false)
    expect(useGroupThreadStore.getState().members[0]!.isOnline).toBe(false)

    useGroupThreadStore.getState().updateMemberOnline('u1', true)
    expect(useGroupThreadStore.getState().members[0]!.isOnline).toBe(true)
  })

  it('should set active group thread and clear state', () => {
    useGroupThreadStore.getState().addMessage(makeMessage())
    useGroupThreadStore.getState().setMembers([makeMember()])

    useGroupThreadStore.getState().setActiveGroupThread('new-thread')
    const state = useGroupThreadStore.getState()
    expect(state.activeGroupThreadId).toBe('new-thread')
    expect(state.messages).toHaveLength(0) // cleared on switch
    expect(state.members).toHaveLength(0) // cleared on switch
  })

  it('should track AI responding state', () => {
    useGroupThreadStore.getState().setAIResponding(true)
    expect(useGroupThreadStore.getState().aiResponding).toBe(true)

    useGroupThreadStore.getState().setAIResponding(false)
    expect(useGroupThreadStore.getState().aiResponding).toBe(false)
  })
})

describe('Mention detection', () => {
  it('should detect @Follow mention', () => {
    expect(hasMention('Hey @Follow can you help?')).toBe(true)
    expect(hasMention('Hello world')).toBe(false)
  })

  it('should detect case-insensitive mentions', () => {
    expect(hasMention('@follow help')).toBe(true)
    expect(hasMention('@FOLLOW help')).toBe(true)
  })

  it('should extract mention positions', () => {
    const mentions = extractMentions('Hey @Follow, what do you think @Follow?')
    expect(mentions).toHaveLength(2)
    expect(mentions[0]!.start).toBe(4)
    expect(mentions[0]!.end).toBe(11)
    expect(mentions[1]!.start).toBe(31)
  })

  it('should strip mentions from text', () => {
    expect(stripMentions('@Follow what is this?')).toBe('what is this?')
    expect(stripMentions('Hey @Follow, help me @Follow')).toBe('Hey , help me')
  })

  it('should export AI_MENTION constant', () => {
    expect(AI_MENTION).toBe('@Follow')
  })
})

describe('Utility functions', () => {
  it('should generate deterministic member colors', () => {
    const color1 = getMemberColor('user-1')
    const color2 = getMemberColor('user-1')

    expect(color1).toBe(color2) // Same ID → same color
    expect(typeof color1).toBe('string')
    expect(color1.startsWith('#')).toBe(true)
    // Different IDs may or may not produce different colors (hash collisions)
  })

  it('should generate initials from names', () => {
    expect(getInitials('John Doe')).toBe('JD')
    expect(getInitials('Alice')).toBe('AL')
    expect(getInitials('Bob Smith Jr')).toBe('BS')
    expect(getInitials('')).toBe('??')
  })
})
