/**
 * Canvas Annotate Init — MAIN world script for canvas mode interception.
 *
 * Runs in the page's MAIN world (not isolated) to access page-level APIs.
 * Sets up the __waDocIntel namespace for cross-script communication.
 * Also provides a postMessage channel for the content script to fetch
 * document text with page cookies (needed for multi-tab Google Docs export).
 */

;(function canvasAnnotateInit() {
  if ((window as unknown as Record<string, unknown>).__waDocIntel) return
  ;(window as unknown as Record<string, unknown>).__waDocIntel = {
    isCanvasMode: false,
    _cachedGDocsText: null,
    activeField: null,
    fieldType: null,
    complexEditor: null,
  }
})()

// ─── MAIN world doc text fetcher ─────────────────────────────────────────
// Content script (ISOLATED world) can't get all tabs via export endpoint.
// This listener runs in MAIN world with full page cookies, so it gets ALL tabs.
window.addEventListener('message', async (e: MessageEvent) => {
  if (e.data?.type !== 'follow-fetch-doc-text') return
  const { googleDocId, requestId } = e.data
  if (!googleDocId || !requestId) return

  try {
    const res = await fetch(
      `https://docs.google.com/document/d/${googleDocId}/export?format=txt`
    )
    if (res.ok) {
      const text = await res.text()
      window.postMessage({ type: 'follow-fetch-doc-text-result', requestId, text }, '*')
    } else {
      window.postMessage({ type: 'follow-fetch-doc-text-result', requestId, error: `HTTP ${res.status}` }, '*')
    }
  } catch (err: unknown) {
    window.postMessage({ type: 'follow-fetch-doc-text-result', requestId, error: (err as Error).message }, '*')
  }
})
