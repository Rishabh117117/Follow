/**
 * Spotlight — navigate to a URL and highlight a specific section.
 *
 * Ported from WA background.js spotlight logic.
 * Listens for spotlight navigation messages from the service worker.
 */

export function init(): () => void {
  const handler = (msg: { type: string; payload?: Record<string, unknown> }) => {
    if (msg.type === 'SPOTLIGHT_SECTION' && msg.payload) {
      const { searchText } = msg.payload as { searchText: string }
      if (searchText) spotlightText(searchText)
    }
  }

  chrome.runtime?.onMessage?.addListener(handler)
  return () => chrome.runtime?.onMessage?.removeListener(handler)
}

function spotlightText(searchText: string): void {
  // Strategy 1: Text fragment (modern browsers)
  // Strategy 2: TreeWalker search + scroll + highlight
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const idx = (node.textContent || '').indexOf(searchText)
    if (idx >= 0) {
      const range = document.createRange()
      range.setStart(node, idx)
      range.setEnd(node, idx + searchText.length)

      // Scroll into view
      const rect = range.getBoundingClientRect()
      window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight / 3, behavior: 'smooth' })

      // Highlight with animation
      const highlight = document.createElement('span')
      highlight.style.cssText = `
        background: rgba(99, 102, 241, 0.2); border-radius: 2px;
        outline: 2px solid rgba(99, 102, 241, 0.5); outline-offset: 1px;
        transition: opacity 2s;
      `
      range.surroundContents(highlight)

      // Fade out after 2.5 seconds
      setTimeout(() => { highlight.style.opacity = '0' }, 2500)
      setTimeout(() => {
        const parent = highlight.parentNode
        while (highlight.firstChild) parent?.insertBefore(highlight.firstChild, highlight)
        highlight.remove()
      }, 4500)

      return
    }
  }
}

// Auto-init
const cleanup = init()
document.addEventListener('follow-unload-spotlight', cleanup)
