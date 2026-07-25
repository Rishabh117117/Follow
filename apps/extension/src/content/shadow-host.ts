/**
 * Shadow Host — creates and manages the Shadow DOM container for UI injection.
 *
 * All extension UI (chat panel, overlays, doc-intel cards) renders inside
 * a single Shadow DOM to prevent style conflicts with the host page.
 */

let shadowRoot: ShadowRoot | null = null
let hostElement: HTMLElement | null = null
let mountPoint: HTMLElement | null = null

/**
 * Create the shadow DOM host element and mount point for React.
 * Returns the ShadowRoot for style injection.
 */
export function createShadowHost(): ShadowRoot {
  if (shadowRoot) return shadowRoot

  hostElement = document.createElement('follow-ui')
  hostElement.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;'

  shadowRoot = hostElement.attachShadow({ mode: 'closed' })

  // Base reset styles
  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }
  `
  shadowRoot.appendChild(style)

  // React mount point
  mountPoint = document.createElement('div')
  mountPoint.id = 'follow-root'
  shadowRoot.appendChild(mountPoint)

  document.documentElement.appendChild(hostElement)
  return shadowRoot
}

/**
 * Get the React mount point inside the shadow DOM.
 */
export function getMountPoint(): HTMLElement | null {
  return mountPoint
}

/**
 * Get the shadow root for style injection.
 */
export function getShadowRoot(): ShadowRoot | null {
  return shadowRoot
}

/**
 * Remove the shadow host from the DOM.
 */
export function destroyShadowHost(): void {
  if (hostElement) {
    hostElement.remove()
    hostElement = null
    shadowRoot = null
    mountPoint = null
  }
}
