import { describe, it, expect, beforeEach } from 'vitest'
import { useFloatingUnitStore } from '../stores/floating-unit-store'

describe('Hybrid Notes (EXT-2)', () => {
  beforeEach(() => {
    useFloatingUnitStore.setState({
      noteClips: [
        { id: 'clip-1', text: 'Important finding', source: 'google-doc', time: new Date().toISOString(), notebookId: null, pinnedToChatId: null },
        { id: 'clip-2', text: 'From web research', source: 'web', time: new Date().toISOString(), notebookId: null, pinnedToChatId: null },
      ],
      pinnedItems: [],
    })
  })

  it('loose clips show in notes list', () => {
    const { noteClips } = useFloatingUnitStore.getState()
    const loose = noteClips.filter((c) => c.notebookId === null)
    expect(loose).toHaveLength(2)
  })

  it('"→ notebook" moves clip to notebook', () => {
    useFloatingUnitStore.getState().moveClipToNotebook('clip-1', 'nb-1')
    const clip = useFloatingUnitStore.getState().noteClips.find((c) => c.id === 'clip-1')
    expect(clip!.notebookId).toBe('nb-1')
  })

  it('"pin" adds clip to pinned items', () => {
    useFloatingUnitStore.getState().pinItem({
      id: 'clip-1',
      type: 'fact',
      name: 'Important finding',
      source: 'google-doc',
    })
    expect(useFloatingUnitStore.getState().pinnedItems).toHaveLength(1)
  })

  it('"+ Clip from doc" creates new clip with null notebookId', () => {
    useFloatingUnitStore.getState().addNoteClip({
      id: 'clip-3',
      text: 'New clip from page',
      source: 'extension',
      time: new Date().toISOString(),
      notebookId: null,
      pinnedToChatId: null,
    })
    expect(useFloatingUnitStore.getState().noteClips).toHaveLength(3)
    const newest = useFloatingUnitStore.getState().noteClips[0]!
    expect(newest.notebookId).toBeNull()
  })
})
