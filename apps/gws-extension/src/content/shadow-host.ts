/**
 * Creates the shadow DOM host for Follow's UI.
 * All Follow UI renders inside this shadow DOM to achieve complete CSS isolation
 * from Google Docs' stylesheets.
 */

import { EXTENSION_CSS } from '@/styles/extension-css'
import { SHADOW_RESET_CSS } from '@/styles/shadow-reset-css'

let shadowRoot: ShadowRoot | null = null

/**
 * Create the shadow DOM host and mount point.
 * Returns the shadow root for React to mount into.
 */
export function createShadowHost(): ShadowRoot {
  // Remove any existing host (hot reload support)
  const existing = document.getElementById('follow-gws-root')
  if (existing) existing.remove()

  // Create host element — fixed position, zero-size, max z-index, pointer-events none
  const host = document.createElement('div')
  host.id = 'follow-gws-root'
  host.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;'
  document.body.appendChild(host)

  // Attach shadow DOM (open mode for dev tools inspection)
  const shadow = host.attachShadow({ mode: 'open' })

  // Inject reset styles first
  const resetStyle = document.createElement('style')
  resetStyle.textContent = SHADOW_RESET_CSS
  shadow.appendChild(resetStyle)

  // Inject Follow extension styles
  const extensionStyle = document.createElement('style')
  extensionStyle.textContent = EXTENSION_CSS
  shadow.appendChild(extensionStyle)

  // Create React mount point — full viewport overlay, pointer-events none
  const mountPoint = document.createElement('div')
  mountPoint.id = 'follow-app'
  mountPoint.style.cssText =
    'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;'
  shadow.appendChild(mountPoint)

  shadowRoot = shadow
  return shadow
}

/**
 * Get the existing shadow root (if created).
 */
export function getShadowRoot(): ShadowRoot | null {
  return shadowRoot
}

/**
 * Get the React mount point inside the shadow DOM.
 */
export function getMountPoint(): HTMLElement | null {
  return shadowRoot?.getElementById('follow-app') ?? null
}
