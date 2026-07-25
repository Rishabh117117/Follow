import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IndexCard } from '../index-card'

describe('IndexCard', () => {
  const base = {
    indexId: 'idx-1',
    indexName: 'Capstone Research',
    recordCount: 40,
    lastActivityAt: new Date('2026-04-01T00:00:00Z').toISOString(),
  }

  it('renders index name and coarse stats', () => {
    render(<IndexCard {...base} />)
    expect(screen.getByText('Capstone Research')).toBeTruthy()
    expect(screen.getByText(/~40 records/)).toBeTruthy()
  })

  it('renders owner name when provided', () => {
    render(<IndexCard {...base} ownerName="Priya" />)
    expect(screen.getByText(/by Priya/)).toBeTruthy()
  })

  it('renders similarity pill when similarity is a number', () => {
    render(<IndexCard {...base} similarity={0.73} />)
    expect(screen.getByTestId('similarity-idx-1').textContent).toContain('73%')
  })

  it('renders topic chips (strings only, never fact content)', () => {
    render(<IndexCard {...base} topics={['capstone', 'research']} />)
    expect(screen.getByText('capstone')).toBeTruthy()
    expect(screen.getByText('research')).toBeTruthy()
  })

  it('fires onOpen when View details is clicked', () => {
    const onOpen = vi.fn()
    render(<IndexCard {...base} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('View details'))
    expect(onOpen).toHaveBeenCalledWith('idx-1')
  })
})
