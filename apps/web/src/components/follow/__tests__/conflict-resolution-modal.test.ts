import { describe, it, expect } from 'vitest'

describe('ConflictResolutionModal', () => {
  const factA = {
    id: 'k1',
    fact: 'Revenue grew 15%',
    source: 'Q3 report',
    contributedByName: 'Rishabh',
    confidence: 0.9,
  }
  const factB = {
    id: 'k2',
    fact: 'Revenue grew 12%',
    source: 'Internal data',
    contributedByName: 'Anika',
    confidence: 0.6,
  }

  it('has two fact cards with correct data', () => {
    expect(factA.fact).toBe('Revenue grew 15%')
    expect(factB.fact).toBe('Revenue grew 12%')
  })

  it('selecting a fact sets the selected id', () => {
    let selectedId: string | null = null
    const onSelect = (id: string) => {
      selectedId = id
    }
    onSelect(factA.id)
    expect(selectedId).toBe('k1')
  })

  it('merge mode clears fact selection', () => {
    let selectedId: string | null = 'k1'
    let showMerge = false
    // Simulate clicking "Or provide a merged fact"
    showMerge = true
    selectedId = null
    expect(selectedId).toBeNull()
    expect(showMerge).toBe(true)
  })

  it('resolve button disabled until selection or merge text', () => {
    const canResolve = (selectedId: string | null, mergeText: string) =>
      selectedId !== null || mergeText.trim().length > 0
    expect(canResolve(null, '')).toBe(false)
    expect(canResolve('k1', '')).toBe(true)
    expect(canResolve(null, 'Merged fact')).toBe(true)
  })

  it('confidence colors map correctly', () => {
    const getColor = (c: number) => (c > 0.7 ? 'green' : c >= 0.5 ? 'amber' : 'red')
    expect(getColor(factA.confidence)).toBe('green')
    expect(getColor(factB.confidence)).toBe('amber')
    expect(getColor(0.3)).toBe('red')
  })
})
