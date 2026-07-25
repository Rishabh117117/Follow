import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(async () => ({ data: null, error: null })),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import { ProceduralPatternsPanel } from '../procedural-patterns-panel'
import { useProceduralStore } from '@/stores/procedural-store'

describe('ProceduralPatternsPanel', () => {
  beforeEach(() => {
    useProceduralStore.getState().reset()
  })

  it('renders the summary strip with header + refresh button', () => {
    render(<ProceduralPatternsPanel workspaceId="ws-1" />)
    expect(screen.getByTestId('patterns-summary')).toBeTruthy()
    expect(screen.getByText('Learned patterns')).toBeTruthy()
    expect(screen.getByTestId('patterns-refresh')).toBeTruthy()
  })

  it('renders the filter bar', () => {
    render(<ProceduralPatternsPanel workspaceId="ws-1" />)
    expect(screen.getByTestId('pattern-filter-bar')).toBeTruthy()
  })

  it('shows empty-state message when no patterns and no error', async () => {
    render(<ProceduralPatternsPanel workspaceId="ws-1" />)
    // loading finishes (api returns null data → patterns stays []).
    expect(await screen.findByTestId('patterns-empty')).toBeTruthy()
  })

  it('shows privacy-drop count when droppedByPrivacy > 0', () => {
    useProceduralStore.setState({
      patterns: [],
      total: 5,
      filtered: 3,
      droppedByPrivacy: 2,
    })
    render(<ProceduralPatternsPanel workspaceId="ws-1" />)
    expect(screen.getByTestId('privacy-drop-count').textContent).toContain(
      '2 dropped by privacy'
    )
  })

  it('renders pattern cards when patterns exist', () => {
    useProceduralStore.setState({
      patterns: [
        {
          id: 'cluster:file:t1',
          type: 'cluster',
          label: 'p1',
          description: null,
          contributors: [],
          edgeCount: 2,
          edgeTypes: ['references'],
          sampleEdgeIds: [],
          confidence: 0.6,
          firstSeenAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
          hasPrivateContributors: false,
          droppedBecausePrivacy: false,
        },
      ],
      total: 1,
      filtered: 1,
    })
    render(<ProceduralPatternsPanel workspaceId="ws-1" />)
    expect(screen.getByTestId('pattern-card-cluster:file:t1')).toBeTruthy()
  })
})
