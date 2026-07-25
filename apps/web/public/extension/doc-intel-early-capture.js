/**
 * doc-intel-early-capture.js — Eagerly capture DOCS_modelChunk at document_start
 *
 * This script runs at document_start (before DOMContentLoaded) on Google Docs
 * pages to capture the document text from the transient DOCS_modelChunk variable
 * before Google Docs clears it.
 *
 * The captured text is stored in window.__waDocIntel._cachedGDocsText for use
 * by the main doc-intel-detector.js which runs later at document_idle.
 */

;(function () {
  'use strict'

  // Bail out if not a Google Docs document page
  if (!window.location.href.includes('docs.google.com/document/')) return

  console.log('[DocIntel:EarlyCapture] Running at document_start on Google Docs')

  // ─── Initialize shared state (may not exist yet since detector hasn't run) ──
  window.__waDocIntel = window.__waDocIntel || {
    activeField: null,
    fieldType: null,
    suggestions: [],
    findings: [],
    summary: '',
    activeSuggestionId: null,
    isProcessing: false,
    enabled: false,
    toolbarVisible: false,
    activationIcon: null,
    shadowHost: null,
    shadowRoot: null,
    editorFightsDOM: false,
    mirrorOverlay: null,
    complexEditor: null,
    complexEditorEl: null,
    isCanvasMode: false,
    _cachedGDocsText: '',
  }

  const state = window.__waDocIntel

  /**
   * Parse DOCS_modelChunk from a script source string.
   * Returns the extracted document text or '' if parsing fails.
   */
  function parseModelChunkFromSource(src) {
    if (!src || !src.includes('DOCS_modelChunk')) return ''

    const chunkIdx = src.indexOf('DOCS_modelChunk')
    const eqIdx = src.indexOf('=', chunkIdx)
    if (eqIdx === -1) return ''

    const arrStart = src.indexOf('[', eqIdx)
    if (arrStart === -1) return ''

    // Find matching closing bracket, skipping string contents
    let depth = 0
    let arrEnd = -1
    for (let i = arrStart; i < src.length; i++) {
      const ch = src[i]
      if (ch === '"') {
        i++
        while (i < src.length && src[i] !== '"') {
          if (src[i] === '\\') i++
          i++
        }
        continue
      }
      if (ch === '[') depth++
      else if (ch === ']') {
        depth--
        if (depth === 0) { arrEnd = i + 1; break }
      }
    }

    if (arrEnd === -1) return ''

    try {
      const jsonStr = src.slice(arrStart, arrEnd)
      const chunks = JSON.parse(jsonStr)
      let docText = ''

      for (const chunk of chunks) {
        if (typeof chunk === 'string') docText += chunk
        else if (chunk && typeof chunk.s === 'string') docText += chunk.s
      }

      if (docText.trim().length > 20) return docText
    } catch (e) {
      // Fallback: regex-extract "s":"..." values
      const sectionStr = src.slice(arrStart, Math.min(arrEnd || src.length, arrStart + 100000))
      const matches = sectionStr.matchAll(/"s"\s*:\s*"((?:[^"\\]|\\.)*)"/g)
      let docText = ''
      for (const m of matches) {
        try { docText += JSON.parse('"' + m[1] + '"') }
        catch (e2) { docText += m[1] }
      }
      if (docText.trim().length > 20) return docText
    }

    return ''
  }

  /**
   * Scan existing script tags for DOCS_modelChunk data.
   */
  function extractTextFromGDocsModelData() {
    const scripts = document.querySelectorAll('script:not([src])')
    for (const script of scripts) {
      const src = script.textContent || ''
      const text = parseModelChunkFromSource(src)
      if (text) return text
    }
    return ''
  }

  /**
   * Try immediate extraction, then set up MutationObserver for late-arriving scripts.
   */
  function capture() {
    // Try immediate extraction (scripts may already be in the DOM)
    const text = extractTextFromGDocsModelData()
    if (text && text.trim().length > 20) {
      state._cachedGDocsText = text
      console.log('[DocIntel:EarlyCapture] Captured DOCS_modelChunk immediately (' + text.length + ' chars)')
      return // Done — no need for observer
    }

    // Set up MutationObserver to catch script tags as they're added
    const observer = new MutationObserver((mutations) => {
      if (state._cachedGDocsText && state._cachedGDocsText.length > 20) {
        observer.disconnect()
        return
      }

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeName === 'SCRIPT' && !node.src) {
            const src = node.textContent || ''
            if (src.includes('DOCS_modelChunk')) {
              const text = parseModelChunkFromSource(src)
              if (text && text.trim().length > 20) {
                state._cachedGDocsText = text
                console.log('[DocIntel:EarlyCapture] MutationObserver captured DOCS_modelChunk (' + text.length + ' chars)')
                observer.disconnect()
                return
              }
            }
          }
        }

        // Also watch for characterData changes on existing script tags
        if (mutation.type === 'characterData' && mutation.target.parentNode &&
            mutation.target.parentNode.nodeName === 'SCRIPT') {
          const src = mutation.target.textContent || ''
          if (src.includes('DOCS_modelChunk')) {
            const text = parseModelChunkFromSource(src)
            if (text && text.trim().length > 20) {
              state._cachedGDocsText = text
              console.log('[DocIntel:EarlyCapture] charData captured DOCS_modelChunk (' + text.length + ' chars)')
              observer.disconnect()
              return
            }
          }
        }
      }
    })

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    // Stop watching after 60 seconds to avoid memory leak
    setTimeout(() => observer.disconnect(), 60000)
  }

  // Run capture immediately
  capture()

  // Also retry after DOM is ready (in case scripts load between now and DOMContentLoaded)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!state._cachedGDocsText || state._cachedGDocsText.length <= 20) {
        console.log('[DocIntel:EarlyCapture] Retrying capture after DOMContentLoaded')
        capture()
      }
    })
  }
})()
