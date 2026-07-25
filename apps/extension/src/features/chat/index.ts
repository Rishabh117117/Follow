/**
 * Chat — self-initializing feature module.
 *
 * Mounts the FloatingUnit (3-state chat widget) inside Shadow DOM.
 */

import { createShadowHost, getMountPoint } from '@/content/shadow-host'

let root: { unmount: () => void } | null = null

async function init(): Promise<void> {
  if (root) return

  const shadow = createShadowHost()
  const mountPoint = getMountPoint()
  if (!mountPoint) return

  const chatContainer = document.createElement('div')
  chatContainer.id = 'follow-chat'
  mountPoint.appendChild(chatContainer)

  const style = document.createElement('style')
  style.textContent = `
    #follow-chat { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #follow-chat *, #follow-chat *::before, #follow-chat *::after { box-sizing: border-box; }
    @keyframes follow-spin { to { transform: rotate(360deg); } }
    @keyframes follow-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  `
  shadow.appendChild(style)

  const { createRoot } = await import('react-dom/client')
  const { createElement } = await import('react')
  const { FloatingUnit } = await import('./FloatingUnit')

  const reactRoot = createRoot(chatContainer)
  reactRoot.render(createElement(FloatingUnit))
  root = reactRoot
}

function cleanup(): void {
  if (root) {
    root.unmount()
    root = null
  }
}

// Auto-init + cleanup listener
init()
document.addEventListener('follow-unload-chat', cleanup)
