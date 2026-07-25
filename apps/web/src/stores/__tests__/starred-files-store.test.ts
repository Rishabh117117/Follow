import { describe, it, expect, beforeEach } from 'vitest'
import { useStarredFilesStore } from '../starred-files-store'

/**
 * StarredFilesStore — unit tests for the Zustand starred files store.
 */

describe('StarredFilesStore', () => {
  beforeEach(() => {
    useStarredFilesStore.getState().clearAll()
  })

  it('should initialize with no starred files', () => {
    const { starredIds } = useStarredFilesStore.getState()
    expect(starredIds.size).toBe(0)
  })

  it('should star a file via toggleStar', () => {
    const { toggleStar } = useStarredFilesStore.getState()

    const result = toggleStar('file-1')

    expect(result).toBe(true)
    expect(useStarredFilesStore.getState().isStarred('file-1')).toBe(true)
    expect(useStarredFilesStore.getState().starredIds.size).toBe(1)
  })

  it('should unstar a file via toggleStar', () => {
    const store = useStarredFilesStore.getState()
    store.toggleStar('file-1') // star it

    const result = useStarredFilesStore.getState().toggleStar('file-1') // unstar it

    expect(result).toBe(false)
    expect(useStarredFilesStore.getState().isStarred('file-1')).toBe(false)
    expect(useStarredFilesStore.getState().starredIds.size).toBe(0)
  })

  it('should clear all starred files', () => {
    const store = useStarredFilesStore.getState()
    store.toggleStar('file-1')
    store.toggleStar('file-2')
    store.toggleStar('file-3')

    expect(useStarredFilesStore.getState().starredIds.size).toBe(3)

    useStarredFilesStore.getState().clearAll()

    expect(useStarredFilesStore.getState().starredIds.size).toBe(0)
  })
})
