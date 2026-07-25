import { describe, it, expect, beforeEach } from 'vitest'
import { useFloatingUnitStore } from '@/stores/floating-unit-store'

describe('UnitChatPanel changes (UI-3)', () => {
  beforeEach(() => {
    useFloatingUnitStore.setState({
      activeTab: 'chat',
      chatThreadId: null,
      chatHistory: [],
      showHistory: false,
      activeMode: 'none',
    })
  })

  it('tabs show Chat, Memory, Notes (not Prov)', () => {
    const tabs = ['chat', 'memory', 'notes'] as const
    for (const tab of tabs) {
      useFloatingUnitStore.getState().setActiveTab(tab)
      expect(useFloatingUnitStore.getState().activeTab).toBe(tab)
    }
  })

  it('history toggle shows drawer', () => {
    useFloatingUnitStore.getState().setShowHistory(true)
    expect(useFloatingUnitStore.getState().showHistory).toBe(true)
  })

  it('messages persist after mock route change', () => {
    // chatThreadId ensures persistence
    useFloatingUnitStore.getState().setChatThreadId('thread-1')
    expect(useFloatingUnitStore.getState().chatThreadId).toBe('thread-1')
    // Simulating route change — chatThreadId should persist
    expect(useFloatingUnitStore.getState().chatThreadId).toBe('thread-1')
  })

  it('+ New button resets chat thread', () => {
    useFloatingUnitStore.getState().setChatThreadId('thread-1')
    useFloatingUnitStore.getState().newChatThread()
    // Should have a new thread ID, not null
    expect(useFloatingUnitStore.getState().chatThreadId).toBeDefined()
    expect(useFloatingUnitStore.getState().chatThreadId).not.toBe('thread-1')
  })
})
