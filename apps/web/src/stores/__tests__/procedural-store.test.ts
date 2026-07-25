import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useProceduralStore } from '../procedural-store'

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

describe('useProceduralStore', () => {
  beforeEach(() => {
    useProceduralStore.getState().reset()
  })

  it('defaults: 14 day window, 0.3 min confidence, no topic filter', () => {
    const s = useProceduralStore.getState()
    expect(s.timeWindowDays).toBe(14)
    expect(s.minConfidence).toBe(0.3)
    expect(s.topicContains).toBeNull()
  })

  it('filter setters persist values', () => {
    useProceduralStore.getState().setTimeWindow(30)
    useProceduralStore.getState().setMinConfidence(0.75)
    useProceduralStore.getState().setTopicContains('capstone')
    const s = useProceduralStore.getState()
    expect(s.timeWindowDays).toBe(30)
    expect(s.minConfidence).toBe(0.75)
    expect(s.topicContains).toBe('capstone')
  })

  it('setTopicContains with empty string clears filter', () => {
    useProceduralStore.getState().setTopicContains('x')
    useProceduralStore.getState().setTopicContains('')
    expect(useProceduralStore.getState().topicContains).toBeNull()
  })

  it('reset clears everything', () => {
    useProceduralStore.setState({
      patterns: [{ id: 'x' } as never],
      summary: { totalPatterns: 5 } as never,
      error: 'err',
      timeWindowDays: 90,
    })
    useProceduralStore.getState().reset()
    const s = useProceduralStore.getState()
    expect(s.patterns).toEqual([])
    expect(s.summary).toBeNull()
    expect(s.error).toBeNull()
    expect(s.timeWindowDays).toBe(14)
  })

  it('refresh without a workspaceId is a no-op (guard)', async () => {
    const spy = vi.spyOn(useProceduralStore.getState(), 'loadPatterns')
    await useProceduralStore.getState().refresh()
    expect(spy).not.toHaveBeenCalled()
  })
})
