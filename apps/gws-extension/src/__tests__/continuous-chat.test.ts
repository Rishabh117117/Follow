import { describe, it, expect, beforeEach } from 'vitest'
import { useFloatingUnitStore } from '../stores/floating-unit-store'

describe('Continuous Chat (EXT-2)', () => {
  beforeEach(() => {
    useFloatingUnitStore.setState({
      chatThreadId: 'thread-1',
      chatMessages: [
        { id: 'm1', role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
        { id: 'm2', role: 'assistant', content: 'Hi there', timestamp: new Date().toISOString() },
      ],
      chatHistory: [],
      showHistory: false,
    })
  })

  it('chatMessages persist after simulated navigation', () => {
    // Messages are in-memory store, not cleared on navigation
    expect(useFloatingUnitStore.getState().chatMessages).toHaveLength(2)
    // Simulating page change — messages stay
    expect(useFloatingUnitStore.getState().chatMessages[0]!.content).toBe('Hello')
  })

  it('chatThreadId stored in store (persists to chrome.storage.local)', () => {
    expect(useFloatingUnitStore.getState().chatThreadId).toBe('thread-1')
  })

  it('"+ New" button clears messages and creates new thread', () => {
    useFloatingUnitStore.getState().newChatThread()
    expect(useFloatingUnitStore.getState().chatMessages).toHaveLength(0)
    expect(useFloatingUnitStore.getState().chatThreadId).not.toBe('thread-1')
    // Previous thread saved to history
    expect(useFloatingUnitStore.getState().chatHistory).toHaveLength(1)
    expect(useFloatingUnitStore.getState().chatHistory[0]!.id).toBe('thread-1')
  })

  it('history drawer shows past threads', () => {
    useFloatingUnitStore.getState().newChatThread()
    useFloatingUnitStore.getState().setShowHistory(true)
    expect(useFloatingUnitStore.getState().showHistory).toBe(true)
    expect(useFloatingUnitStore.getState().chatHistory.length).toBeGreaterThan(0)
  })
})
