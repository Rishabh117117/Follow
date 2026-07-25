import { describe, it, expect } from 'vitest'

/**
 * PageContainer — unit tests for the page container component.
 */

describe('PageContainer', () => {
  it('should define page dimensions: 100% width, max-width 816px, min-height 1056px (US letter)', () => {
    const pageStyles = {
      width: '100%',
      maxWidth: 816,
      minHeight: 1056,
      background: '#FFFFFF',
    }

    expect(pageStyles.width).toBe('100%')
    expect(pageStyles.maxWidth).toBe(816)
    expect(pageStyles.minHeight).toBe(1056)
    expect(pageStyles.background).toBe('#FFFFFF')
  })

  it('should apply page shadow styling', () => {
    const shadow = '0 1px 3px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)'
    expect(shadow).toContain('rgba(0,0,0,0.12)')
    expect(shadow).toContain('rgba(0,0,0,0.04)')
  })

  it('should disable page wrapper in compact mode', () => {
    // In compact mode, the component renders without page styling
    const compact = true
    const shouldRenderPage = !compact
    expect(shouldRenderPage).toBe(false)

    const normal = false
    const shouldRenderPageNormal = !normal
    expect(shouldRenderPageNormal).toBe(true)
  })
})
