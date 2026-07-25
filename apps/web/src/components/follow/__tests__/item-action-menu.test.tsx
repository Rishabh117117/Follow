import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ItemActionMenu } from '@/components/follow/items/item-action-menu'
import { useItemManageStore } from '@/stores/item-manage-store'

beforeEach(() => {
  useItemManageStore.setState({
    selectMode: false,
    selectedIds: [],
    showHidden: false,
    addPanelOpen: false,
    addStep: 'choose',
    confirmDialog: null,
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) as ReturnType<typeof vi.fn>
  )
})

describe('ItemActionMenu (Sprint CTX-1)', () => {
  it('renders all 5 action items', () => {
    render(<ItemActionMenu item={{ id: '1', name: 'My File', hidden: false }} onClose={() => {}} />)
    expect(screen.getByTestId('item-action-hide-toggle')).toBeTruthy()
    expect(screen.getByTestId('item-action-pin')).toBeTruthy()
    expect(screen.getByTestId('item-action-contribute')).toBeTruthy()
    expect(screen.getByTestId('item-action-send')).toBeTruthy()
    expect(screen.getByTestId('item-action-remove')).toBeTruthy()
  })

  it('shows "Unhide" instead of "Hide" for hidden items', () => {
    render(<ItemActionMenu item={{ id: '1', name: 'My File', hidden: true }} onClose={() => {}} />)
    expect(screen.getByTestId('item-action-hide-toggle').textContent).toBe('Unhide')
  })

  it('clicking "Hide from index" calls the hide API', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchSpy as ReturnType<typeof vi.fn>)
    const onClose = vi.fn()
    render(
      <ItemActionMenu item={{ id: 'rec-1', name: 'My File', hidden: false }} onClose={onClose} />
    )
    fireEvent.click(screen.getByTestId('item-action-hide-toggle'))
    await new Promise((r) => setTimeout(r, 10))
    expect(fetchSpy).toHaveBeenCalled()
    const calls = fetchSpy.mock.calls as unknown as [string][]
    const firstCall = String(calls[0]?.[0] ?? '')
    expect(firstCall).toContain('/api/index/items/rec-1/hide')
  })

  it('clicking "Remove from index" opens the confirm dialog', () => {
    render(
      <ItemActionMenu item={{ id: 'rec-1', name: 'My File', hidden: false }} onClose={() => {}} />
    )
    fireEvent.click(screen.getByTestId('item-action-remove'))
    expect(useItemManageStore.getState().confirmDialog).toEqual({ id: 'rec-1', name: 'My File' })
  })
})
