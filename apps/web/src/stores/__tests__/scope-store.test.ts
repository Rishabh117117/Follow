import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useScopeStore, type Boundary } from '../scope-store'

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

describe('useScopeStore', () => {
  beforeEach(() => {
    useScopeStore.getState().reset()
  })

  it('opens and closes the editor', () => {
    useScopeStore.getState().openEditor()
    expect(useScopeStore.getState().editorOpen).toBe(true)
    useScopeStore.getState().closeEditor()
    expect(useScopeStore.getState().editorOpen).toBe(false)
  })

  it('seeds draft boundaries from active scope when opening without args', () => {
    const b: Boundary = { dimension: 'confidence', op: 'gte', value: 0.8 }
    useScopeStore.setState({
      activeScope: {
        scope_id: 's_x',
        name: 'x',
        mode: 'static',
        persists_until: 'session_end',
        boundaries: [b],
        ownerId: 'u',
        workspaceId: 'w',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    })
    useScopeStore.getState().openEditor()
    expect(useScopeStore.getState().draftBoundaries).toEqual([b])
  })

  it('manages draft boundaries', () => {
    const b: Boundary = { dimension: 'confidence', op: 'gte', value: 0.8 }
    useScopeStore.getState().addDraftBoundary(b)
    expect(useScopeStore.getState().draftBoundaries).toHaveLength(1)

    const updated: Boundary = { ...b, value: 0.9 }
    useScopeStore.getState().updateDraftBoundary(0, updated)
    expect(useScopeStore.getState().draftBoundaries[0]!.value).toBe(0.9)

    useScopeStore.getState().removeDraftBoundary(0)
    expect(useScopeStore.getState().draftBoundaries).toHaveLength(0)
  })

  it('reset clears state', () => {
    useScopeStore.getState().addDraftBoundary({
      dimension: 'confidence',
      op: 'gte',
      value: 0.8,
    })
    useScopeStore.getState().openEditor()
    useScopeStore.getState().reset()
    expect(useScopeStore.getState().draftBoundaries).toEqual([])
    expect(useScopeStore.getState().editorOpen).toBe(false)
    expect(useScopeStore.getState().activeScope).toBeNull()
  })
})
