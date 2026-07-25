import { describe, it, expect, beforeEach } from 'vitest'
import { useChatContextStore } from '../chat-context-store'

describe('ChatContextStore (UI-3)', () => {
  beforeEach(() => {
    useChatContextStore.setState({
      scope: 'all',
      followWeb: false,
      seeing: [],
      pinnedItems: [],
      contextExpanded: false,
    })
  })

  it('initializes with scope all and empty pins', () => {
    const s = useChatContextStore.getState()
    expect(s.scope).toBe('all')
    expect(s.pinnedItems).toHaveLength(0)
    expect(s.followWeb).toBe(false)
  })

  it('setScope changes scope', () => {
    useChatContextStore.getState().setScope('pinned')
    expect(useChatContextStore.getState().scope).toBe('pinned')
  })

  it('pinItem adds to pinnedItems', () => {
    useChatContextStore.getState().pinItem({
      id: 'item-1',
      type: 'file',
      name: 'Test File',
      source: 'claude',
    })
    expect(useChatContextStore.getState().pinnedItems).toHaveLength(1)
    expect(useChatContextStore.getState().pinnedItems[0]!.name).toBe('Test File')
  })

  it('unpinItem removes by id', () => {
    useChatContextStore.getState().pinItem({
      id: 'item-1',
      type: 'file',
      name: 'Test File',
      source: 'claude',
    })
    useChatContextStore.getState().unpinItem('item-1')
    expect(useChatContextStore.getState().pinnedItems).toHaveLength(0)
  })

  it('toggleFollowWeb flips state', () => {
    expect(useChatContextStore.getState().followWeb).toBe(false)
    useChatContextStore.getState().toggleFollowWeb()
    expect(useChatContextStore.getState().followWeb).toBe(true)
  })
})
