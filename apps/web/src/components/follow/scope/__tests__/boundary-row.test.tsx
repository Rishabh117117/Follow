import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BoundaryRow } from '../boundary-row'
import type { Boundary } from '@/stores/scope-store'

describe('BoundaryRow', () => {
  const base: Boundary = { dimension: 'confidence', op: 'gte', value: 0.8 }

  it('renders the dimension and op controls', () => {
    const onUpdate = vi.fn()
    const onRemove = vi.fn()
    render(
      <BoundaryRow boundary={base} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    )
    expect(screen.getByTestId('boundary-row-0')).toBeTruthy()
  })

  it('fires onRemove when × is clicked', () => {
    const onUpdate = vi.fn()
    const onRemove = vi.fn()
    render(
      <BoundaryRow boundary={base} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    )
    fireEvent.click(screen.getByLabelText('Remove boundary'))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('updates confidence value when slider moves', () => {
    const onUpdate = vi.fn()
    const onRemove = vi.fn()
    render(
      <BoundaryRow boundary={base} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    )
    const slider = document.querySelector('input[type=range]') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '0.95' } })
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ value: 0.95 }))
  })
})
