import { describe, it, expect, beforeEach } from 'vitest'
import { useIndexStore } from '@/stores/index-store'

describe('IndexSelector (UI-1)', () => {
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
    })
  })

  it('renders current index name and stats', () => {
    const active = useIndexStore.getState().getActiveIndex()
    expect(active).toBeDefined()
    expect(active!.name).toBe('Personal')
    expect(active!.facts).toBe(247)
    expect(active!.files).toBe(89)
  })

  it('click opens dropdown with all indexes', () => {
    useIndexStore.getState().toggleDropdown()
    expect(useIndexStore.getState().dropdownOpen).toBe(true)
    const { indexes } = useIndexStore.getState()
    expect(indexes).toHaveLength(3)
  })

  it('clicking an index calls setActiveIndex and closes dropdown', () => {
    useIndexStore.getState().toggleDropdown()
    expect(useIndexStore.getState().dropdownOpen).toBe(true)
    useIndexStore.getState().setActiveIndex('capstone')
    expect(useIndexStore.getState().activeIndexId).toBe('capstone')
    expect(useIndexStore.getState().dropdownOpen).toBe(false)
  })

  it('Create New button opens create form', () => {
    useIndexStore.getState().toggleCreateForm()
    expect(useIndexStore.getState().createFormOpen).toBe(true)
  })

  it('create form submits new index', () => {
    useIndexStore.getState().addIndex({
      id: 'new-index',
      name: 'New Index',
      type: 'personal',
      facts: 0,
      files: 0,
      chats: 0,
    })
    expect(useIndexStore.getState().indexes).toHaveLength(4)
    expect(useIndexStore.getState().indexes[3]!.name).toBe('New Index')
  })

  it('cancel closes form', () => {
    useIndexStore.getState().toggleCreateForm()
    expect(useIndexStore.getState().createFormOpen).toBe(true)
    useIndexStore.getState().toggleCreateForm()
    expect(useIndexStore.getState().createFormOpen).toBe(false)
  })
})
