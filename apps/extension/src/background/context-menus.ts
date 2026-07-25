/**
 * Context Menus — merged context menu registration.
 *
 * Combines GWS "Ask Follow..." and WA "Capture to Workspace" + "Analyze PDF".
 */

export function registerContextMenus(): void {
  // GWS: Ask Follow with selected text on Google Docs
  chrome.contextMenus.create({
    id: 'ask-follow',
    title: 'Ask Follow...',
    contexts: ['selection'],
    documentUrlPatterns: ['https://docs.google.com/*'],
  })

  // Web: Capture selection/page/link to workspace
  chrome.contextMenus.create({
    id: 'capture-to-workspace',
    title: 'Capture to Workspace',
    contexts: ['page', 'selection', 'link'],
  })

  // Web: Analyze PDF with Doc Intel
  chrome.contextMenus.create({
    id: 'analyze-pdf',
    title: 'Analyze PDF with Doc Intel',
    contexts: ['page', 'link'],
    documentUrlPatterns: ['*://*/*.pdf*'],
  })
}
