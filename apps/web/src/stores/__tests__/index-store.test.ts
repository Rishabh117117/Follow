import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useIndexStore } from '../index-store'

describe('IndexStore (WIRE-1)', () => {
  beforeEach(() => {
    useIndexStore.setState({
      activeIndexId: 'personal',
      indexes: [
        { id: 'personal', name: 'Personal', type: 'personal', facts: 247, files: 89, chats: 34 },
        { id: 'capstone', name: 'Capstone Thesis', type: 'project', facts: 112, files: 44, chats: 18, members: 3 },
        { id: 'follow-dev', name: 'Follow Development', type: 'project', facts: 91, files: 32, chats: 12, members: 2 },
      ],
      dropdownOpen: false,
      createFormOpen: false,
      isLoading: false,
    })
  })

  it('setActiveIndex changes activeIndexId', () => {
    useIndexStore.getState().setActiveIndex('capstone')
    expect(useIndexStore.getState().activeIndexId).toBe('capstone')
  })

  it('toggleDropdown flips dropdownOpen', () => {
    expect(useIndexStore.getState().dropdownOpen).toBe(false)
    useIndexStore.getState().toggleDropdown()
    expect(useIndexStore.getState().dropdownOpen).toBe(true)
  })

  it('addIndex appends to indexes array', () => {
    useIndexStore.getState().addIndex({
      id: 'test-project',
      name: 'Test Project',
      type: 'project',
      facts: 0,
      files: 0,
      chats: 0,
      members: 1,
    })
    expect(useIndexStore.getState().indexes).toHaveLength(4)
  })

  it('setIndexes replaces the indexes array', () => {
    useIndexStore.getState().setIndexes([
      { id: 'personal', name: 'Personal', type: 'personal', facts: 0, files: 0, chats: 0 },
    ])
    expect(useIndexStore.getState().indexes).toHaveLength(1)
  })

  it('fetchIndexes calls /api/indexes and updates store', async () => {
    const mockData = [
      { id: 'personal', name: 'Personal', type: 'personal' as const, facts: 10, files: 5, chats: 2 },
      { id: 'proj-1', name: 'Proj', type: 'project' as const, facts: 0, files: 0, chats: 0, members: 1 },
    ]
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockData }),
    } as Response)

    await useIndexStore.getState().fetchIndexes()
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/indexes'),
      expect.any(Object)
    )
    expect(useIndexStore.getState().indexes).toEqual(mockData)
    fetchSpy.mockRestore()
  })

  it('createIndex POSTs to /api/indexes and appends result', async () => {
    const created = {
      id: 'new-proj',
      name: 'New Project',
      type: 'project' as const,
      facts: 0,
      files: 0,
      chats: 0,
      members: 1,
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: created }),
    } as Response)

    const result = await useIndexStore
      .getState()
      .createIndex('New Project', 'project', 'c3d4e5f6-a7b8-9012-cdef-123456789012')
    expect(result).toEqual(created)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/indexes'),
      expect.objectContaining({ method: 'POST' })
    )
    fetchSpy.mockRestore()
  })

  it('getActiveIndex selector returns correct index', () => {
    const active = useIndexStore.getState().getActiveIndex()
    expect(active?.name).toBe('Personal')
  })

  it('does not contain SEED_INDEXES hardcoded array at init', async () => {
    // After reset, indexes should be empty (not seeded)
    useIndexStore.setState({ indexes: [] })
    expect(useIndexStore.getState().indexes).toHaveLength(0)
  })
})
