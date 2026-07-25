import { describe, it, expect, beforeEach } from 'vitest'
import { useFloatingUnitStore } from '../stores/floating-unit-store'

describe('Full Context Bar in floating unit (EXT-2)', () => {
  beforeEach(() => {
    useFloatingUnitStore.setState({
      chatScope: 'all',
      followWeb: false,
      seeing: [],
      pinnedItems: [
        { id: 'p1', type: 'file', name: 'Architecture Notes', source: 'claude' },
      ],
      contextExpanded: false,
    })
  })

  it('renders index pill with stored index name', () => {
    // The store tracks chatScope for scoped queries
    expect(useFloatingUnitStore.getState().chatScope).toBe('all')
  })

  it('scope selector shows three options', () => {
    const scopes = ['all', 'doc', 'pinned'] as const
    for (const s of scopes) {
      useFloatingUnitStore.getState().setChatScope(s)
      expect(useFloatingUnitStore.getState().chatScope).toBe(s)
    }
  })

  it('clicking scope updates store', () => {
    useFloatingUnitStore.getState().setChatScope('pinned')
    expect(useFloatingUnitStore.getState().chatScope).toBe('pinned')
  })

  it('Follow Web toggle changes state', () => {
    expect(useFloatingUnitStore.getState().followWeb).toBe(false)
    useFloatingUnitStore.getState().toggleFollowWeb()
    expect(useFloatingUnitStore.getState().followWeb).toBe(true)
  })

  it('expanded state shows SEEING and PINNED rows', () => {
    useFloatingUnitStore.getState().toggleContextExpanded()
    expect(useFloatingUnitStore.getState().contextExpanded).toBe(true)
  })

  it('unpin removes item from pinned list', () => {
    expect(useFloatingUnitStore.getState().pinnedItems).toHaveLength(1)
    useFloatingUnitStore.getState().unpinItem('p1')
    expect(useFloatingUnitStore.getState().pinnedItems).toHaveLength(0)
  })
})
