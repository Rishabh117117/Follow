import { describe, it, expect, beforeEach } from 'vitest'
import {
  useDocThreadsStore,
  getFilteredThreads,
  conversationToThread,
  type DocThread,
} from '../doc-threads-store'

/**
 * DocThreadsStore — unit tests for thread types, filtering, and sorting.
 */

function makeThread(overrides: Partial<DocThread> = {}): DocThread {
  return {
    id: `thread-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test Thread',
    type: 'chat',
    preview: 'Some preview text',
    messageCount: 3,
    isPinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('DocThreadsStore', () => {
  beforeEach(() => {
    useDocThreadsStore.getState().reset()
  })

  it('should initialize with empty state', () => {
    const { threads, activeThreadId, typeFilter } = useDocThreadsStore.getState()
    expect(threads).toEqual([])
    expect(activeThreadId).toBeNull()
    expect(typeFilter).toBeNull()
  })

  it('should add a thread and activate it', () => {
    const thread = makeThread({ id: 'th-1', title: 'Chat about intro' })
    useDocThreadsStore.getState().addThread(thread)

    const state = useDocThreadsStore.getState()
    expect(state.threads.length).toBe(1)
    expect(state.threads[0]!.title).toBe('Chat about intro')
    expect(state.activeThreadId).toBe('th-1')
  })

  it('should remove a thread and clear activeThreadId if it was active', () => {
    const thread = makeThread({ id: 'th-1' })
    useDocThreadsStore.getState().addThread(thread)

    expect(useDocThreadsStore.getState().activeThreadId).toBe('th-1')

    useDocThreadsStore.getState().removeThread('th-1')

    expect(useDocThreadsStore.getState().threads.length).toBe(0)
    expect(useDocThreadsStore.getState().activeThreadId).toBeNull()
  })

  it('should toggle pin on a thread', () => {
    const thread = makeThread({ id: 'th-1', isPinned: false })
    useDocThreadsStore.getState().addThread(thread)

    useDocThreadsStore.getState().togglePin('th-1')
    expect(useDocThreadsStore.getState().threads[0]!.isPinned).toBe(true)

    useDocThreadsStore.getState().togglePin('th-1')
    expect(useDocThreadsStore.getState().threads[0]!.isPinned).toBe(false)
  })

  it('should set type filter', () => {
    useDocThreadsStore.getState().setTypeFilter('edit')
    expect(useDocThreadsStore.getState().typeFilter).toBe('edit')

    useDocThreadsStore.getState().setTypeFilter(null)
    expect(useDocThreadsStore.getState().typeFilter).toBeNull()
  })

  it('should update thread fields', () => {
    const thread = makeThread({ id: 'th-1', title: 'Old title' })
    useDocThreadsStore.getState().addThread(thread)

    useDocThreadsStore.getState().updateThread('th-1', { title: 'New title', messageCount: 10 })

    const updated = useDocThreadsStore.getState().threads[0]!
    expect(updated.title).toBe('New title')
    expect(updated.messageCount).toBe(10)
  })
})

describe('getFilteredThreads', () => {
  const now = Date.now()

  const threads: DocThread[] = [
    makeThread({ id: '1', type: 'chat', isPinned: false, updatedAt: new Date(now - 1000).toISOString() }),
    makeThread({ id: '2', type: 'edit', isPinned: true, updatedAt: new Date(now - 2000).toISOString() }),
    makeThread({ id: '3', type: 'group', isPinned: false, updatedAt: new Date(now - 500).toISOString() }),
    makeThread({ id: '4', type: 'chat', isPinned: false, updatedAt: new Date(now - 3000).toISOString() }),
  ]

  it('should return all threads when no filter', () => {
    const result = getFilteredThreads(threads, null)
    expect(result.length).toBe(4)
  })

  it('should filter by type', () => {
    const chatOnly = getFilteredThreads(threads, 'chat')
    expect(chatOnly.length).toBe(2)
    expect(chatOnly.every((t) => t.type === 'chat')).toBe(true)
  })

  it('should sort pinned first', () => {
    const result = getFilteredThreads(threads, null)
    expect(result[0]!.id).toBe('2') // pinned
  })

  it('should sort non-pinned by updatedAt descending', () => {
    const result = getFilteredThreads(threads, null)
    // After pinned '2', should be '3' (500ms ago), '1' (1000ms ago), '4' (3000ms ago)
    expect(result[1]!.id).toBe('3')
    expect(result[2]!.id).toBe('1')
    expect(result[3]!.id).toBe('4')
  })
})

describe('conversationToThread', () => {
  it('should map a standard conversation to chat thread', () => {
    const conv = {
      id: 'conv-1',
      title: 'Help with intro',
      type: 'standard',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T12:00:00Z',
    }
    const thread = conversationToThread(conv)
    expect(thread.id).toBe('conv-1')
    expect(thread.type).toBe('chat')
    expect(thread.title).toBe('Help with intro')
  })

  it('should map deep_dive conversation to edit thread', () => {
    const conv = {
      id: 'conv-2',
      title: 'Deep analysis',
      type: 'deep_dive',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T12:00:00Z',
    }
    const thread = conversationToThread(conv)
    expect(thread.type).toBe('edit')
  })

  it('should accept explicit threadType override', () => {
    const conv = {
      id: 'conv-3',
      title: 'Team chat',
      type: 'standard',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const thread = conversationToThread(conv, { threadType: 'group', preview: 'Hello team' })
    expect(thread.type).toBe('group')
    expect(thread.preview).toBe('Hello team')
  })

  it('should handle Date objects for timestamps', () => {
    const now = new Date()
    const conv = {
      id: 'conv-4',
      title: 'Test',
      createdAt: now,
      updatedAt: now,
    }
    const thread = conversationToThread(conv)
    expect(thread.createdAt).toBe(now.toISOString())
  })
})
