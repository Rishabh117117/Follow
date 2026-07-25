import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useQueryStore, type Boundary } from '../query-store'

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

describe('useQueryStore', () => {
  beforeEach(() => {
    useQueryStore.getState().reset()
  })

  it('toggles composer open/close', () => {
    useQueryStore.getState().composerOpen()
    expect(useQueryStore.getState().isComposerOpen).toBe(true)
    useQueryStore.getState().composerClose()
    expect(useQueryStore.getState().isComposerOpen).toBe(false)
  })

  it('manages draft boundaries', () => {
    const b: Boundary = { dimension: 'confidence', op: 'gte', value: 0.8 }
    useQueryStore.getState().addBoundary(b)
    expect(useQueryStore.getState().draftBoundaries).toHaveLength(1)
    useQueryStore.getState().updateBoundary(0, { ...b, value: 0.9 })
    expect(useQueryStore.getState().draftBoundaries[0]!.value).toBe(0.9)
    useQueryStore.getState().removeBoundary(0)
    expect(useQueryStore.getState().draftBoundaries).toHaveLength(0)
  })

  it('setSelect / setName update draft state', () => {
    useQueryStore.getState().setSelect({
      fields: ['id'],
      limit: 50,
    })
    expect(useQueryStore.getState().draftSelect.limit).toBe(50)
    useQueryStore.getState().setName('My Query')
    expect(useQueryStore.getState().draftName).toBe('My Query')
  })

  it('reset clears draft + result + warnings', () => {
    useQueryStore.getState().addBoundary({
      dimension: 'confidence',
      op: 'gte',
      value: 0.8,
    })
    useQueryStore.getState().composerOpen()
    useQueryStore.setState({ parseWarnings: ['x'], lastResult: null })
    useQueryStore.getState().reset()
    expect(useQueryStore.getState().draftBoundaries).toEqual([])
    expect(useQueryStore.getState().isComposerOpen).toBe(false)
    expect(useQueryStore.getState().parseWarnings).toEqual([])
    expect(useQueryStore.getState().draftName).toBe('')
  })
})
