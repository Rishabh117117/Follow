import { describe, it, expect, beforeEach } from 'vitest'
import { useItemManageStore } from '@/stores/item-manage-store'

describe('useItemManageStore (Sprint CTX-1)', () => {
  beforeEach(() => {
    useItemManageStore.setState({
      selectMode: false,
      selectedIds: [],
      showHidden: false,
      addPanelOpen: false,
      addStep: 'choose',
      confirmDialog: null,
    })
  })

  it('toggleSelectMode flips selectMode', () => {
    useItemManageStore.getState().toggleSelectMode()
    expect(useItemManageStore.getState().selectMode).toBe(true)
    useItemManageStore.getState().toggleSelectMode()
    expect(useItemManageStore.getState().selectMode).toBe(false)
  })

  it('toggleSelected adds and then removes from selectedIds', () => {
    useItemManageStore.getState().toggleSelected('a')
    expect(useItemManageStore.getState().selectedIds).toEqual(['a'])
    useItemManageStore.getState().toggleSelected('b')
    expect(useItemManageStore.getState().selectedIds).toEqual(['a', 'b'])
    useItemManageStore.getState().toggleSelected('a')
    expect(useItemManageStore.getState().selectedIds).toEqual(['b'])
  })

  it('selectAll sets all IDs', () => {
    useItemManageStore.getState().selectAll(['x', 'y', 'z'])
    expect(useItemManageStore.getState().selectedIds).toEqual(['x', 'y', 'z'])
  })

  it('clearSelection empties selectedIds', () => {
    useItemManageStore.setState({ selectedIds: ['a', 'b'] })
    useItemManageStore.getState().clearSelection()
    expect(useItemManageStore.getState().selectedIds).toEqual([])
  })

  it('toggleShowHidden flips showHidden', () => {
    expect(useItemManageStore.getState().showHidden).toBe(false)
    useItemManageStore.getState().toggleShowHidden()
    expect(useItemManageStore.getState().showHidden).toBe(true)
  })

  it('openAddPanel sets addPanelOpen true and resets step', () => {
    useItemManageStore.setState({ addStep: 'done' })
    useItemManageStore.getState().openAddPanel()
    expect(useItemManageStore.getState().addPanelOpen).toBe(true)
    expect(useItemManageStore.getState().addStep).toBe('choose')
  })

  it('openConfirmDialog / closeConfirmDialog manage dialog state', () => {
    useItemManageStore.getState().openConfirmDialog('id-1', 'My Doc')
    expect(useItemManageStore.getState().confirmDialog).toEqual({ id: 'id-1', name: 'My Doc' })
    useItemManageStore.getState().closeConfirmDialog()
    expect(useItemManageStore.getState().confirmDialog).toBeNull()
  })
})
