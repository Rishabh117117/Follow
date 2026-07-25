import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConfirmDialog } from '@/components/follow/modals/confirm-dialog'

describe('ConfirmDialog (Sprint CTX-1)', () => {
  it('renders item name in message', () => {
    render(<ConfirmDialog name="My Document" onConfirm={() => {}} onCancel={() => {}} />)
    const msg = screen.getByTestId('confirm-dialog-message')
    expect(msg.textContent).toContain('My Document')
  })

  it('clicking Remove calls onConfirm', () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog name="Doc" onConfirm={onConfirm} onCancel={() => {}} />)
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('clicking Cancel calls onCancel', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog name="Doc" onConfirm={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
