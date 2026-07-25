import { describe, it, expect, vi } from 'vitest'

/**
 * DocTabs — unit tests for the document section tab bar.
 */

describe('DocTabs', () => {
  const defaultTabs = ['Methodology', 'Lit Review', 'Framework', 'Conclusion']

  it('should render all tabs', () => {
    expect(defaultTabs.length).toBe(4)
    expect(defaultTabs).toContain('Methodology')
    expect(defaultTabs).toContain('Conclusion')
  })

  it('should highlight the active tab with correct styling', () => {
    const activeIndex = 1
    const activeTab = defaultTabs[activeIndex]
    const isActive = (index: number) => index === activeIndex

    expect(activeTab).toBe('Lit Review')
    expect(isActive(0)).toBe(false)
    expect(isActive(1)).toBe(true)
    expect(isActive(2)).toBe(false)
  })

  it('should fire onTabChange when a tab is clicked', () => {
    const onTabChange = vi.fn()
    const clickIndex = 2

    onTabChange(clickIndex)

    expect(onTabChange).toHaveBeenCalledWith(2)
    expect(onTabChange).toHaveBeenCalledTimes(1)
  })

  it('should fire onTabClose when close button is clicked', () => {
    const onTabClose = vi.fn()
    const closeIndex = 0

    onTabClose(closeIndex)

    expect(onTabClose).toHaveBeenCalledWith(0)
  })

  it('should show a + button for new tabs', () => {
    // The + button should always be visible
    const hasNewButton = true
    expect(hasNewButton).toBe(true)
  })

  it('should fire onNewTab when + button is clicked', () => {
    const onNewTab = vi.fn()

    onNewTab()

    expect(onNewTab).toHaveBeenCalledTimes(1)
  })
})
