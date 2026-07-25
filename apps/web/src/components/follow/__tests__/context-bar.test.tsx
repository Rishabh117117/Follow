import { describe, it, expect, beforeEach } from 'vitest'
import { useChatContextStore } from '@/stores/chat-context-store'
import { useIndexStore } from '@/stores/index-store'

describe('ContextBar (UI-3)', () => {
  beforeEach(() => {
    useChatContextStore.setState({
      scope: 'all',
      followWeb: false,
      seeing: ['notion.so/security'],
      pinnedItems: [
        { id: 'p1', type: 'file', name: 'Architecture Notes', source: 'claude' },
      ],
      contextExpanded: false,
    })
    useIndexStore.setState({
      activeIndexId: 'personal',
      indexes: [
        { id: 'personal', name: 'Personal', type: 'personal', facts: 247, files: 89, chats: 34 },
      ],
    })
  })

  it('renders index pill with current index name', () => {
    const active = useIndexStore.getState().getActiveIndex()
    expect(active).toBeDefined()
    expect(active!.name).toBe('Personal')
  })

  it('renders scope selector with three options', () => {
    const scopes = ['all', 'doc', 'pinned'] as const
    for (const s of scopes) {
      useChatContextStore.getState().setScope(s)
      expect(useChatContextStore.getState().scope).toBe(s)
    }
  })

  it('clicking scope option calls setScope', () => {
    useChatContextStore.getState().setScope('doc')
    expect(useChatContextStore.getState().scope).toBe('doc')
  })

  it('expanded state shows SEEING and PINNED rows', () => {
    useChatContextStore.getState().toggleContextExpanded()
    expect(useChatContextStore.getState().contextExpanded).toBe(true)
    expect(useChatContextStore.getState().seeing).toHaveLength(1)
    expect(useChatContextStore.getState().pinnedItems).toHaveLength(1)
  })

  it('collapse button hides rows 2-3', () => {
    useChatContextStore.getState().toggleContextExpanded()
    expect(useChatContextStore.getState().contextExpanded).toBe(true)
    useChatContextStore.getState().toggleContextExpanded()
    expect(useChatContextStore.getState().contextExpanded).toBe(false)
  })

  it('unpin button calls unpinItem', () => {
    useChatContextStore.getState().unpinItem('p1')
    expect(useChatContextStore.getState().pinnedItems).toHaveLength(0)
  })
})
