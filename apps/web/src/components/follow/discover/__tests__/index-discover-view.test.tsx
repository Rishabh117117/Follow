import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(async () => ({ data: { signatures: [] }, error: null })),
    // Return a result with 0 matches so the useEffect-triggered runDiscover
    // doesn't clobber the preset suggestions in the no-matches test.
    post: vi.fn(async () => ({
      data: {
        result: {
          sourceIndexId: 'idx-1',
          sourceIndexName: 'Test',
          matches: [],
          privacyFloor: 'topics_only',
          scanned: 3,
          runtimeMs: 42,
          conflicts: [],
        },
      },
      error: null,
    })),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import { IndexDiscoverView } from '../index-discover-view'
import { useDiscoverStore } from '@/stores/discover-store'

describe('IndexDiscoverView', () => {
  beforeEach(() => {
    useDiscoverStore.getState().reset()
  })

  it('renders the header + privacy floor toggles', () => {
    render(<IndexDiscoverView workspaceId="ws-1" />)
    expect(screen.getByText('Discover')).toBeTruthy()
    expect(screen.getByTestId('privacy-floor-fingerprint_only')).toBeTruthy()
    expect(screen.getByTestId('privacy-floor-topics_only')).toBeTruthy()
    expect(screen.getByTestId('privacy-floor-full_signature')).toBeTruthy()
  })

  it('shows the no-source empty state when no source is selected', () => {
    render(<IndexDiscoverView workspaceId="ws-1" />)
    expect(screen.getByTestId('no-source-empty')).toBeTruthy()
  })

  it('switches privacy floor on click', () => {
    render(<IndexDiscoverView workspaceId="ws-1" />)
    fireEvent.click(screen.getByTestId('privacy-floor-full_signature'))
    expect(useDiscoverStore.getState().privacyFloor).toBe('full_signature')
  })

  it('displays no-matches empty state when suggestions exist but matches is empty', async () => {
    useDiscoverStore.setState({
      sourceIndexId: 'idx-1',
      suggestions: {
        sourceIndexId: 'idx-1',
        sourceIndexName: 'Test',
        matches: [],
        privacyFloor: 'topics_only',
        scanned: 3,
        runtimeMs: 42,
        conflicts: [],
      },
    })
    render(<IndexDiscoverView workspaceId="ws-1" />)
    // useEffect-triggered runDiscover fires asynchronously; the mock returns
    // matches=[] too, so findByTestId waits for the re-render to stabilize.
    expect(await screen.findByTestId('no-matches-empty')).toBeTruthy()
  })
})
