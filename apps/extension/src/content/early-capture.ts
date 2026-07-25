/**
 * Early Capture — captures Google Docs DOCS_modelChunk at document_start.
 *
 * This transient data is cleared by Google shortly after load.
 * Must run at document_start to intercept it.
 * Caches the extracted text for later use by doc-intel and tracking.
 */

;(function earlyCapture() {
  const state = ((window as unknown as Record<string, unknown>).__waDocIntel as Record<string, unknown>) || {}
  ;(window as unknown as Record<string, unknown>).__waDocIntel = state

  function extractFromScripts(): string | null {
    const scripts = document.querySelectorAll('script')
    for (const script of scripts) {
      const text = script.textContent || ''
      const match = text.match(/DOCS_modelChunk\s*=\s*(\[[\s\S]*?\]);/)
      if (match?.[1]) {
        try {
          const chunks = JSON.parse(match[1])
          if (Array.isArray(chunks)) {
            const result = chunks
              .filter((c: unknown) => typeof c === 'object' && c !== null && 's' in (c as Record<string, unknown>))
              .map((c: { s: string }) => c.s)
              .join('')
            if (result.length > 0) return result
          }
        } catch {
          // Try regex fallback
          const textMatch = text.match(/"s"\s*:\s*"((?:[^"\\]|\\.)*)"/g)
          if (textMatch) {
            const parts = textMatch.map(m => {
              const val = m.match(/"s"\s*:\s*"((?:[^"\\]|\\.)*)"/)
              return val?.[1]?.replace(/\\n/g, '\n').replace(/\\"/g, '"') || ''
            })
            const result = parts.join('')
            if (result.length > 0) return result
          }
        }
      }
    }
    return null
  }

  // Attempt immediate extraction
  const immediate = extractFromScripts()
  if (immediate) {
    state._cachedGDocsText = immediate
    return
  }

  // Watch for late-arriving scripts with a MutationObserver
  const observer = new MutationObserver(() => {
    const text = extractFromScripts()
    if (text) {
      state._cachedGDocsText = text
      observer.disconnect()
    }
  })

  observer.observe(document.documentElement, { childList: true, subtree: true })

  // 60-second timeout to prevent memory leak
  setTimeout(() => observer.disconnect(), 60000)

  // Retry on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    if (!state._cachedGDocsText) {
      const text = extractFromScripts()
      if (text) state._cachedGDocsText = text
    }
  }, { once: true })
})()
