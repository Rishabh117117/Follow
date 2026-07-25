import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SavedQueriesList } from '../saved-queries-list'
import { useQueryStore } from '@/stores/query-store'

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(async () => ({ data: { queries: [] }, error: null })),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

describe('SavedQueriesList', () => {
  beforeEach(() => {
    useQueryStore.getState().reset()
    useQueryStore.setState({ savedQueries: [] })
  })

  it('renders the empty state when no saved queries', () => {
    render(<SavedQueriesList />)
    expect(screen.getByTestId('saved-queries-empty')).toBeTruthy()
  })

  it('renders pinned section when a query is pinned', () => {
    useQueryStore.setState({
      savedQueries: [
        {
          id: 'q1',
          userId: 'u',
          workspaceId: 'w',
          name: 'Priya recent',
          description: null,
          boundaries: [],
          selectSpec: { fields: ['id'] },
          aggregations: null,
          isPinned: true,
          lastRunAt: null,
          runCount: 3,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })
    render(<SavedQueriesList />)
    expect(screen.getByText('Priya recent')).toBeTruthy()
    expect(screen.getByText(/Pinned/)).toBeTruthy()
  })

  it('separates pinned from recent', () => {
    useQueryStore.setState({
      savedQueries: [
        {
          id: 'q1',
          userId: 'u',
          workspaceId: 'w',
          name: 'Pinned query',
          description: null,
          boundaries: [],
          selectSpec: { fields: ['id'] },
          aggregations: null,
          isPinned: true,
          lastRunAt: null,
          runCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'q2',
          userId: 'u',
          workspaceId: 'w',
          name: 'Recent query',
          description: null,
          boundaries: [],
          selectSpec: { fields: ['id'] },
          aggregations: null,
          isPinned: false,
          lastRunAt: null,
          runCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })
    render(<SavedQueriesList />)
    expect(screen.getByText('Pinned query')).toBeTruthy()
    expect(screen.getByText('Recent query')).toBeTruthy()
    // Both section headers render in addition to the query names.
    expect(screen.getAllByText(/Pinned/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText(/Recent/).length).toBeGreaterThanOrEqual(2)
  })
})
