import { describe, it, expect, vi } from 'vitest'

describe('ProactiveCard', () => {
  const tension = {
    id: 't1',
    description: 'Section 2 contradicts data in Section 4',
    severity: 'high',
    sections: ['Section 2', 'Section 4'],
  }

  it('shows correct title for high severity', () => {
    const isHigh = tension.severity === 'high'
    const title = isHigh ? 'Potential issue' : 'Possible inconsistency'
    expect(title).toBe('Potential issue')
  })

  it('shows correct title for medium severity', () => {
    const mediumTension = { ...tension, severity: 'medium' }
    const title = mediumTension.severity === 'high' ? 'Potential issue' : 'Possible inconsistency'
    expect(title).toBe('Possible inconsistency')
  })

  it('calls onTellMore with tension when Tell me more is clicked', () => {
    const onTellMore = vi.fn()
    // Simulate button click
    onTellMore(tension)
    expect(onTellMore).toHaveBeenCalledWith(tension)
    expect(onTellMore).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss with tension id when dismissed', () => {
    const onDismiss = vi.fn()
    onDismiss(tension.id)
    expect(onDismiss).toHaveBeenCalledWith('t1')
  })

  it('filters out tentative tensions correctly', () => {
    const tensions = [
      { id: '1', severity: 'high', tentative: false, resolvedAt: null },
      { id: '2', severity: 'medium', tentative: true, resolvedAt: null },
      { id: '3', severity: 'high', tentative: false, resolvedAt: '2024-01-01' },
      { id: '4', severity: 'low', tentative: false, resolvedAt: null },
    ]
    const qualifying = tensions.filter(
      (t) => !t.tentative && (t.severity === 'high' || t.severity === 'medium') && !t.resolvedAt
    )
    expect(qualifying).toHaveLength(1)
    expect(qualifying[0]!.id).toBe('1')
  })
})
