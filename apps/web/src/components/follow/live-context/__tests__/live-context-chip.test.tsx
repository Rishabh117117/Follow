import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LiveContextChip } from '../live-context-chip'
import type { Boundary } from '@/stores/scope-store'

describe('LiveContextChip', () => {
  it('summarises a confidence boundary', () => {
    const b: Boundary = { dimension: 'confidence', op: 'gte', value: 0.8 }
    render(<LiveContextChip boundary={b} />)
    expect(screen.getByText(/confidence gte 0.8/).textContent).toContain('0.8')
  })

  it('summarises a relative time boundary', () => {
    const b: Boundary = {
      dimension: 'time',
      op: 'within',
      window: { type: 'relative', days: 14 },
    }
    render(<LiveContextChip boundary={b} />)
    expect(screen.getByText(/time within 14d/).textContent).toContain('14d')
  })

  it('calls onRemove when × is clicked', () => {
    const b: Boundary = { dimension: 'topic', op: 'include', values: ['x'] }
    const onRemove = vi.fn()
    render(<LiveContextChip boundary={b} onRemove={onRemove} />)
    fireEvent.click(screen.getByLabelText(/Remove topic boundary/))
    expect(onRemove).toHaveBeenCalledOnce()
  })
})
