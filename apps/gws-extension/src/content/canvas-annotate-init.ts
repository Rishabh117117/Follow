/**
 * Canvas Annotate Init — runs at document_start (before Google Docs loads)
 *
 * Sets window._docs_annotate_canvas_by_ext to our extension ID so that
 * Google Docs renders SVG <rect> elements over the canvas with text
 * bounding boxes. This enables inline overlays (underlines, highlights,
 * ghost drafts) positioned precisely over document text.
 *
 * Must run BEFORE Google Docs initializes its rendering engine.
 */
;(window as any)._docs_annotate_canvas_by_ext = 'hmmanjibicfpahoimfffeakklgmcgbga'

/**
 * MAIN world document text fetcher.
 * The content script (ISOLATED world) can't always fetch with page cookies.
 * This listener runs in MAIN world and has full access to the page's auth.
 * Content script sends a postMessage request, this fetches and replies.
 */
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
  } catch (err: any) {
    window.postMessage({ type: 'follow-fetch-doc-text-result', requestId, error: err.message }, '*')
  }
})
