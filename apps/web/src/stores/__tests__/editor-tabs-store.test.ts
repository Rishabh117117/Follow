import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorTabsStore } from '../editor-tabs-store'

/**
 * EditorTabsStore — unit tests for the Zustand editor tabs store.
 */

describe('EditorTabsStore', () => {
  beforeEach(() => {
    // Reset store to defaults
    useEditorTabsStore.getState().reset()
  })

  it('should initialize with a default "Document" tab at index 0', () => {
    const { tabs, activeTabIndex } = useEditorTabsStore.getState()
    expect(tabs.length).toBe(1)
    expect(tabs[0]!.label).toBe('Document')
    expect(activeTabIndex).toBe(0)
  })

  it('should add a tab and activate it', () => {
    const { addTab } = useEditorTabsStore.getState()

    addTab('Methods')

    const { tabs, activeTabIndex } = useEditorTabsStore.getState()
    expect(tabs.length).toBe(2)
    expect(tabs[1]!.label).toBe('Methods')
    expect(activeTabIndex).toBe(1) // new tab activated
  })

  it('should remove a tab and keep at least one', () => {
    const store = useEditorTabsStore.getState()
    store.addTab('Methods')
    store.addTab('Results')

    const { tabs: before } = useEditorTabsStore.getState()
    expect(before.length).toBe(3)

    useEditorTabsStore.getState().removeTab(1) // remove 'Methods'

    const { tabs: after } = useEditorTabsStore.getState()
    expect(after.length).toBe(2)
    expect(after.map((t) => t.label)).toEqual(['Document', 'Results'])
  })

  it('should set active tab index', () => {
    const store = useEditorTabsStore.getState()
    store.addTab('Methods')
    store.addTab('Results')

    useEditorTabsStore.getState().setActiveTab(0)

    expect(useEditorTabsStore.getState().activeTabIndex).toBe(0)
  })

  it('should activate previous tab when removing the active tab', () => {
    const store = useEditorTabsStore.getState()
    store.addTab('Methods')
    store.addTab('Results')

    // Active is now 2 (Results, from the last addTab)
    expect(useEditorTabsStore.getState().activeTabIndex).toBe(2)

    // Remove active tab (index 2)
    useEditorTabsStore.getState().removeTab(2)

    const { activeTabIndex, tabs } = useEditorTabsStore.getState()
    expect(tabs.length).toBe(2)
    // Should activate previous (index 1)
    expect(activeTabIndex).toBe(1)
  })
})
