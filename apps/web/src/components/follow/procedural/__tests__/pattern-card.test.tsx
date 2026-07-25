import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PatternCard } from '../pattern-card'
import type { Pattern } from '@/stores/procedural-store'

const base: Pattern = {
  id: 'cluster:file:t1',
  type: 'cluster',
  label: '3 files reference t1',
  description: null,
  contributors: [
    { id: 'u1', name: 'Priya', contributionCount: 2 },
    { id: 'u2', name: null, contributionCount: 1 },
  ],
  edgeCount: 3,
  edgeTypes: ['references', 'supersedes'],
  sampleEdgeIds: ['e1', 'e2', 'e3'],
  confidence: 0.85,
  firstSeenAt: new Date('2026-04-01T00:00:00Z').toISOString(),
  lastUpdatedAt: new Date('2026-04-10T00:00:00Z').toISOString(),
  hasPrivateContributors: false,
  droppedBecausePrivacy: false,
}

describe('PatternCard', () => {
  it('renders the pattern label', () => {
    render(<PatternCard pattern={base} />)
    expect(screen.getByText('3 files reference t1')).toBeTruthy()
  })

  it('renders confidence percentage with a colored dot', () => {
    render(<PatternCard pattern={base} />)
    const conf = screen.getByTestId('pattern-confidence-cluster:file:t1')
    expect(conf.textContent).toContain('85%')
  })

  it('renders edge count pill and top edge type chips', () => {
    render(<PatternCard pattern={base} />)
    expect(screen.getByText('3 edges')).toBeTruthy()
    expect(screen.getByText('references')).toBeTruthy()
    expect(screen.getByText('supersedes')).toBeTruthy()
  })

  it('renders contributor pills — null name softens identity', () => {
    render(<PatternCard pattern={base} />)
    const row = screen.getByTestId('pattern-contributors-cluster:file:t1')
    expect(row.textContent).toContain('Priya')
    expect(row.textContent).toContain('—')
  })

  it('does NOT render the private-contributor flag when hasPrivateContributors=false', () => {
    render(<PatternCard pattern={base} />)
    expect(screen.queryByTestId('pattern-private-flag-cluster:file:t1')).toBeNull()
  })

  it('renders the private-contributor flag when hasPrivateContributors=true', () => {
    const withFlag: Pattern = { ...base, hasPrivateContributors: true }
    render(<PatternCard pattern={withFlag} />)
    expect(
      screen.getByTestId('pattern-private-flag-cluster:file:t1')
    ).toBeTruthy()
  })
})
