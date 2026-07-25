import { describe, it, expect, beforeEach } from 'vitest'
import { useFollowNotesStore, looseClips, pinnedClips } from '../follow-notes-store'

describe('FollowNotesStore hybrid notes (UI-4)', () => {
  beforeEach(() => {
    useFollowNotesStore.getState().reset()
    // Add test clips
    useFollowNotesStore.setState({
      clips: [
        {
          id: 'clip-1',
          quote: 'Test clip 1',
          sourceType: 'web',
          sourceLabel: 'test.com',
          interpretation: '',
          tags: [],
          createdAt: new Date().toISOString(),
          isPinned: false,
          notebookId: null,
          pinnedToChatId: null,
        },
        {
          id: 'clip-2',
          quote: 'Test clip 2',
          sourceType: 'document',
          sourceLabel: 'doc.md',
          interpretation: '',
          tags: [],
          createdAt: new Date().toISOString(),
          isPinned: false,
          notebookId: 'nb-1',
          pinnedToChatId: null,
        },
      ],
    })
  })

  it('moveToNotebook sets notebookId on note', () => {
    useFollowNotesStore.getState().moveToNotebook('clip-1', 'nb-2')
    const clip = useFollowNotesStore.getState().clips.find((c) => c.id === 'clip-1')
    expect(clip!.notebookId).toBe('nb-2')
  })

  it('pinToChat sets pinnedToChatId', () => {
    useFollowNotesStore.getState().pinToChat('clip-1', 'chat-1')
    const clip = useFollowNotesStore.getState().clips.find((c) => c.id === 'clip-1')
    expect(clip!.pinnedToChatId).toBe('chat-1')
  })

  it('unpinFromChat clears pinnedToChatId', () => {
    useFollowNotesStore.getState().pinToChat('clip-1', 'chat-1')
    useFollowNotesStore.getState().unpinFromChat('clip-1')
    const clip = useFollowNotesStore.getState().clips.find((c) => c.id === 'clip-1')
    expect(clip!.pinnedToChatId).toBeNull()
  })

  it('createClipFromPage adds new note with null notebookId', () => {
    useFollowNotesStore.getState().createClipFromPage('New page clip', 'example.com')
    const { clips } = useFollowNotesStore.getState()
    expect(clips.length).toBe(3)
    const newest = clips[0]!
    expect(newest.quote).toBe('New page clip')
    expect(newest.notebookId).toBeNull()
  })

  it('looseClips selector returns only unassigned notes', () => {
    const { clips } = useFollowNotesStore.getState()
    const loose = looseClips(clips)
    expect(loose).toHaveLength(1)
    expect(loose[0]!.id).toBe('clip-1')
  })

  it('pinnedClips selector filters by chatId', () => {
    useFollowNotesStore.getState().pinToChat('clip-1', 'chat-1')
    const { clips } = useFollowNotesStore.getState()
    const pinned = pinnedClips(clips, 'chat-1')
    expect(pinned).toHaveLength(1)
    expect(pinned[0]!.id).toBe('clip-1')
  })
})
