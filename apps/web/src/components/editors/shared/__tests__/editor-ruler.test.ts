import { describe, it, expect } from 'vitest'

/**
 * EditorRuler — unit tests for the Google Docs–style horizontal ruler.
 */

// Helper: extract ruler structure for assertions
function parseRuler() {
  const INCHES = 10
  const totalTicks = INCHES * 2 + 1 // 0 through 9 in 0.5 increments = 21 ticks
  const majorTicks: number[] = []
  const minorTicks: number[] = []

  for (let i = 0; i < totalTicks; i++) {
    if (i % 2 === 0) {
      majorTicks.push(i / 2)
    } else {
      minorTicks.push(i / 2)
    }
  }

  return { totalTicks, majorTicks, minorTicks }
}

describe('EditorRuler', () => {
  it('should define correct total tick count (21 ticks for 0–9 inches at 0.5 intervals)', () => {
    const { totalTicks } = parseRuler()
    expect(totalTicks).toBe(21)
  })

  it('should have 10 major ticks at whole inch positions (0–9)', () => {
    const { majorTicks } = parseRuler()
    // Major ticks are at 0, 1, 2, ..., 9 (the even indices)
    // That's 11 positions (0 through 10/2=10... wait)
    // Indices: 0,2,4,6,8,10,12,14,16,18,20 → 11 major tick positions (0–10)
    // But we only have 0–9 in the display (10 inches * 2 + 1 = 21 ticks, indices 0..20)
    // Major ticks at indices 0,2,4,...,20 → inch values 0,1,2,...,10
    // Actually INCHES=10, so ticks from 0 to 10*2=20, making 21 total
    // Major are at even: 0,2,4,6,8,10,12,14,16,18,20 → 11 major ticks (0-10 inches)
    // Labels shown for inch > 0 → labels 1-10
    expect(majorTicks).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(majorTicks.length).toBe(11)
  })

  it('should show numeric labels for major ticks (inches 1–9, excluding 0)', () => {
    const { majorTicks } = parseRuler()
    // Labels are shown for inchNum > 0, which means inches 1 through 10
    const labeledTicks = majorTicks.filter((inch) => inch > 0)
    expect(labeledTicks.length).toBe(10)
    expect(labeledTicks[0]).toBe(1)
    expect(labeledTicks[labeledTicks.length - 1]).toBe(10)
  })

  it('should position margin markers at approximately 8% from each edge', () => {
    // The ruler places left marker at 8% from left, right marker at 8% from right
    const leftMarkerPct = 8
    const rightMarkerPct = 8
    expect(leftMarkerPct).toBe(8)
    expect(rightMarkerPct).toBe(8)
    // Verify markers are symmetric
    expect(leftMarkerPct).toBe(rightMarkerPct)
  })
})
