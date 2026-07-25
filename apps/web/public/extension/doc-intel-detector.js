/**
 * doc-intel-detector.js — Field Detection & Activation Icon
 *
 * Detects editable fields (contentEditable, textarea, input) on any web page.
 * Shows a small activation icon ("W") near focused fields.
 * Manages the shared __waDocIntel state namespace.
 *
 * Part of the Web Document Intelligence extension module.
 */

;(function () {
  'use strict'

  // ─── Trusted Types Policy ─────────────────────────────────────────
  // Google Docs enforces Trusted Types CSP which blocks innerHTML.
  // We create a policy that all doc-intel extension code shares.
  // The policy is a simple pass-through since we control all HTML
  // being injected (it's all UI chrome, never user content from the page).
  let _trustedPolicy = null
  function getTrustedPolicy() {
    if (_trustedPolicy) return _trustedPolicy
    try {
      if (typeof trustedTypes !== 'undefined' && trustedTypes.createPolicy) {
        _trustedPolicy = trustedTypes.createPolicy('waDocIntel', {
          createHTML: (s) => s,
        })
      }
    } catch (e) {
      // Policy name may already be taken — try a fallback name
      try {
        _trustedPolicy = trustedTypes.createPolicy('waDocIntel_' + Date.now(), {
          createHTML: (s) => s,
        })
      } catch (e2) {
        // Trusted Types not available or all policy slots used — innerHTML will work without it
      }
    }
    return _trustedPolicy
  }

  /**
   * Safe innerHTML setter that works on pages with Trusted Types CSP (e.g. Google Docs).
   * Falls back to raw innerHTML on pages without Trusted Types.
   */
  function safeSetInnerHTML(el, html) {
    const policy = getTrustedPolicy()
    if (policy) {
      el.innerHTML = policy.createHTML(html)
    } else {
      el.innerHTML = html
    }
  }

  // ─── Shared state namespace ───────────────────────────────────────
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
    complexEditor: null,   // null | 'google-docs' | 'notion' | 'coda' | 'quip'
    complexEditorEl: null, // Reference to the main editor element for complex editors
    isCanvasMode: false,   // true when Google Docs uses canvas rendering (no DOM text nodes)
    _cachedGDocsText: '',  // Cached text from DOCS_modelChunk (transient — must capture early)
  }

  const state = window.__waDocIntel

  // ─── Field Detection ──────────────────────────────────────────────

  function isEditableField(el) {
    if (!el || el.nodeType !== 1) return false
    const tag = el.tagName
    if (tag === 'TEXTAREA') return true
    if (tag === 'INPUT' && (el.type === 'text' || el.type === 'search' || el.type === 'url' || el.type === 'email')) return true
    if (el.isContentEditable) return true
    if (el.getAttribute('role') === 'textbox') return true
    // Check parent for contentEditable (e.g., clicked on a <p> inside a contentEditable div)
    if (el.closest && el.closest('[contenteditable="true"]')) return true
    return false
  }

  function getEditableRoot(el) {
    // For contentEditable, find the root editable element
    if (el.isContentEditable) {
      let root = el
      while (root.parentElement && root.parentElement.isContentEditable) {
        root = root.parentElement
      }
      return root
    }
    if (el.closest && el.closest('[contenteditable="true"]')) {
      return el.closest('[contenteditable="true"]')
    }
    return el
  }

  function getFieldType(el) {
    if (el.tagName === 'TEXTAREA') return 'textarea'
    if (el.tagName === 'INPUT') return 'input'
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return 'contenteditable'
    if (el.getAttribute('role') === 'textbox') return 'contenteditable'
    return 'unknown'
  }

  /**
   * Normalize Unicode chars before sending to API so the LLM's returned
   * spanText references the same characters the overlay will search for.
   * Must match the normalizeChars() function in doc-intel-overlay.js.
   */
  function normalizeCharsForAPI(str) {
    return (str || '')
      .replace(/[\u2018\u2019\u201A\u0060\u00B4]/g, "'")   // smart single quotes → '
      .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')     // smart double quotes → "
      .replace(/[\u2013\u2014\u2015]/g, '-')                  // en/em dash → -
      .replace(/\u2026/g, '...')                               // ellipsis → ...
      .replace(/\u00A0/g, ' ')                                 // non-breaking space → space
      .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')             // zero-width chars → remove
  }

  // Also attach to shared state so other extension scripts can access it
  state.normalizeCharsForAPI = normalizeCharsForAPI

  function extractText(el) {
    // Complex editor extraction
    if (state.complexEditor) {
      let text = extractTextFromComplexEditor()
      // Normalize Unicode before sending to API — this ensures the LLM's
      // returned spanText matches what the overlay's search also normalizes to.
      if (text && text.trim()) return normalizeCharsForAPI(text)
      // Fallback: try the element's innerText directly
      if (el && el.innerText) {
        const directText = el.innerText.trim()
        if (directText && directText.length > 20) {
          console.log('[DocIntel] extractText fallback: using el.innerText')
          return normalizeCharsForAPI(directText)
        }
      }
      return normalizeCharsForAPI(text || '') // Return whatever we got (may be empty)
    }
    const type = getFieldType(el)
    if (type === 'textarea' || type === 'input') return el.value || ''
    if (type === 'contenteditable') return el.innerText || ''
    return ''
  }

  // ─── Complex Editor Detection ──────────────────────────────────────

  /**
   * Detects if the current page uses a complex editor that prevents inline mark injection.
   * Returns { type, element } or null.
   */
  function detectComplexEditor() {
    const url = window.location.href

    // Google Docs — try multiple selectors as Google updates DOM frequently
    if (url.includes('docs.google.com/document/')) {
      // Try many known Google Docs editor selectors (old and new versions)
      const gdocsSelectors = [
        '.kix-appview-editor',
        '.docs-editor',
        '.kix-page',
        '.kix-paginateddocumentplugin',
        '.docs-texteventtarget-iframe',
        '[role="document"]',
        '.docs-editor-container',
        '.canvas-anchor',
      ]
      for (const sel of gdocsSelectors) {
        const el = document.querySelector(sel)
        if (el) {
          console.log('[DocIntel] Google Docs detected via:', sel)
          return { type: 'google-docs', element: el }
        }
      }
      // URL matches but no known element found — still treat as Google Docs
      // Use document.body as the element reference
      console.log('[DocIntel] Google Docs detected by URL (no editor element found)')
      return { type: 'google-docs', element: document.body }
    }

    // Notion
    if (url.includes('notion.so') || url.includes('notion.site')) {
      const pageContent = document.querySelector('.notion-page-content, [data-content-editable-root="true"], .notion-frame')
      if (pageContent) return { type: 'notion', element: pageContent }
      return { type: 'notion', element: document.body }
    }

    // Coda
    if (url.includes('coda.io')) {
      const editor = document.querySelector('[data-coda-ui-id="canvas"], .coda-doc-body')
      if (editor) return { type: 'coda', element: editor }
    }

    // Quip
    if (url.includes('quip.com')) {
      const editor = document.querySelector('.document-content, .article')
      if (editor) return { type: 'quip', element: editor }
    }

    // Dropbox Paper
    if (url.includes('paper.dropbox.com')) {
      const editor = document.querySelector('.editor-content')
      if (editor) return { type: 'dropbox-paper', element: editor }
    }

    return null
  }

  /**
   * Extract text from complex editors using their specific DOM structures.
   */
  function extractTextFromComplexEditor() {
    if (!state.complexEditor) return ''

    switch (state.complexEditor) {
      case 'google-docs': return extractTextFromGoogleDocs()
      case 'notion':      return extractTextFromNotion()
      default:            return extractTextFromGenericComplex()
    }
  }

  /**
   * Detect if Google Docs is in canvas rendering mode (no DOM text nodes).
   * In canvas mode, all text is drawn on <canvas> elements and there are
   * zero .kix-paragraphrenderer or .kix-wordhtmlgenerator-word-node elements.
   */
  function isGDocsCanvasMode() {
    const paragraphs = document.querySelectorAll('.kix-paragraphrenderer')
    const canvases = document.querySelectorAll('canvas')
    return paragraphs.length === 0 && canvases.length > 0
  }

  /**
   * Extract text from Google Docs internal model data stored in <script> tags.
   * Google Docs stores the document model in a DOCS_modelChunk variable.
   * This works in BOTH classic DOM mode and canvas rendering mode.
   */
  /**
   * Parse DOCS_modelChunk from a script source string.
   * Returns the extracted document text or '' if parsing fails.
   */
  function parseModelChunkFromSource(src) {
    if (!src || !src.includes('DOCS_modelChunk')) return ''

    // Find the array assignment: DOCS_modelChunk = [...]
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
          if (src[i] === '\\') i++ // skip escaped char
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
      console.warn('[DocIntel] DOCS_modelChunk JSON.parse failed:', e.message)

      // Fallback: regex-extract "s":"..." values from the chunk region
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
   * Eagerly capture DOCS_modelChunk text on page load.
   * Google Docs loads the model data in a script tag but clears it shortly after.
   * We must grab it immediately and cache it. Also set up a MutationObserver to
   * catch any late-arriving script tags that contain the data.
   */
  function eagerCaptureGDocsText() {
    if (!window.location.href.includes('docs.google.com/document/')) return

    // Try immediate extraction
    const text = extractTextFromGDocsModelData()
    if (text && text.trim().length > 20) {
      state._cachedGDocsText = text
      console.log('[DocIntel] Early capture: cached DOCS_modelChunk text (' + text.length + ' chars)')
    }

    // Set up MutationObserver to catch script tags that haven't been added yet
    // (Google Docs may load model data asynchronously)
    const observer = new MutationObserver((mutations) => {
      // Already have cached text — no need to keep watching
      if (state._cachedGDocsText && state._cachedGDocsText.length > 20) return

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeName === 'SCRIPT' && !node.src) {
            const src = node.textContent || ''
            if (src.includes('DOCS_modelChunk')) {
              const text = parseModelChunkFromSource(src)
              if (text && text.trim().length > 20) {
                state._cachedGDocsText = text
                console.log('[DocIntel] MutationObserver captured DOCS_modelChunk (' + text.length + ' chars)')
                observer.disconnect()
                return
              }
            }
          }
        }

        // Also watch for characterData changes on existing script tags
        // (Google Docs may modify script content in-place)
        if (mutation.type === 'characterData' && mutation.target.parentNode &&
            mutation.target.parentNode.nodeName === 'SCRIPT') {
          const src = mutation.target.textContent || ''
          if (src.includes('DOCS_modelChunk')) {
            const text = parseModelChunkFromSource(src)
            if (text && text.trim().length > 20) {
              state._cachedGDocsText = text
              console.log('[DocIntel] MutationObserver (charData) captured DOCS_modelChunk (' + text.length + ' chars)')
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

    // Stop watching after 30 seconds to avoid memory leak
    setTimeout(() => observer.disconnect(), 30000)
  }

  function extractTextFromGoogleDocs() {
    let text = ''

    // Strategy 0: Google Docs model data from script tags (works in canvas mode)
    // This is the most reliable strategy as it reads from Google's internal model,
    // not from DOM nodes (which don't exist in canvas rendering mode).
    // IMPORTANT: DOCS_modelChunk is TRANSIENT — Google Docs clears it shortly after
    // page load. We check the cache first (populated by eagerCaptureGDocsText()),
    // then try fresh extraction as a fallback.
    text = extractTextFromGDocsModelData()
    if (text && text.trim().length > 20) {
      // Update cache with latest data
      state._cachedGDocsText = text
      // Detect canvas mode and set flag
      state.isCanvasMode = isGDocsCanvasMode()
      if (state.isCanvasMode) {
        console.log('[DocIntel] Canvas mode detected — extracted text from DOCS_modelChunk (' + text.length + ' chars)')
      } else {
        console.log('[DocIntel] Extracted text from DOCS_modelChunk (' + text.length + ' chars)')
      }
      return text
    }

    // Strategy 0b: Use cached text from early capture
    // DOCS_modelChunk was already consumed by Google Docs — use what we cached.
    if (state._cachedGDocsText && state._cachedGDocsText.trim().length > 20) {
      state.isCanvasMode = isGDocsCanvasMode()
      console.log('[DocIntel] Using cached DOCS_modelChunk text (' + state._cachedGDocsText.length + ' chars, canvasMode=' + state.isCanvasMode + ')')
      return state._cachedGDocsText
    }

    // Strategy 1: .kix-paragraphrenderer word nodes (classic Google Docs DOM)
    const paragraphs = document.querySelectorAll('.kix-paragraphrenderer')
    if (paragraphs.length) {
      const lines = []
      for (const p of paragraphs) {
        const wordNodes = p.querySelectorAll('.kix-wordhtmlgenerator-word-node')
        if (wordNodes.length) {
          let lineText = ''
          for (const w of wordNodes) { lineText += w.textContent }
          if (lineText.trim()) lines.push(lineText)
        } else {
          const pt = p.innerText
          if (pt && pt.trim()) lines.push(pt.trim())
        }
      }
      text = lines.join('\n')
      if (text.trim()) { console.log('[DocIntel] Extracted text via .kix-paragraphrenderer'); return text }
    }

    // Strategy 2: .kix-page-content-wrapper innerText
    const pages = document.querySelectorAll('.kix-page-content-wrapper')
    if (pages.length) {
      text = Array.from(pages).map(p => p.innerText || '').join('\n').trim()
      if (text) { console.log('[DocIntel] Extracted text via .kix-page-content-wrapper'); return text }
    }

    // Strategy 3: .kix-page innerText
    const kixPages = document.querySelectorAll('.kix-page')
    if (kixPages.length) {
      text = Array.from(kixPages).map(p => p.innerText || '').join('\n').trim()
      if (text) { console.log('[DocIntel] Extracted text via .kix-page'); return text }
    }

    // Strategy 4: [role="document"] or .docs-editor
    const roleDoc = document.querySelector('[role="document"]')
    if (roleDoc) {
      text = (roleDoc.innerText || '').trim()
      if (text) { console.log('[DocIntel] Extracted text via [role="document"]'); return text }
    }
    const docsEditor = document.querySelector('.docs-editor')
    if (docsEditor) {
      text = (docsEditor.innerText || '').trim()
      if (text) { console.log('[DocIntel] Extracted text via .docs-editor'); return text }
    }

    // Strategy 5: .kix-appview-editor innerText (catch-all for old versions)
    const kixEditor = document.querySelector('.kix-appview-editor')
    if (kixEditor) {
      text = (kixEditor.innerText || '').trim()
      if (text) { console.log('[DocIntel] Extracted text via .kix-appview-editor innerText'); return text }
    }

    // Strategy 6: Try the stored complexEditorEl
    if (state.complexEditorEl && state.complexEditorEl !== document.body) {
      text = (state.complexEditorEl.innerText || '').trim()
      if (text) { console.log('[DocIntel] Extracted text via complexEditorEl'); return text }
    }

    // Strategy 7: Accessibility — try to find text in ARIA elements
    const ariaTextboxes = document.querySelectorAll('[role="textbox"], [aria-label*="Document content"]')
    for (const atb of ariaTextboxes) {
      text = (atb.innerText || '').trim()
      if (text && text.length > 20) { console.log('[DocIntel] Extracted text via ARIA element'); return text }
    }

    // Strategy 8: Google Docs canvas accessibility overlay
    const accessibilityEl = document.querySelector('.docs-accessibility-document-content, .kix-zoomdocumentplugin-outer')
    if (accessibilityEl) {
      text = (accessibilityEl.innerText || '').trim()
      if (text) { console.log('[DocIntel] Extracted text via accessibility overlay'); return text }
    }

    // Strategy 9: Iframe-based text capture (Google Docs input iframe)
    try {
      const iframes = document.querySelectorAll('.docs-texteventtarget-iframe iframe, iframe[title*="ocs"]')
      for (const iframe of iframes) {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
          if (iframeDoc) {
            text = (iframeDoc.body?.innerText || '').trim()
            if (text && text.length > 20) { console.log('[DocIntel] Extracted text via iframe'); return text }
          }
        } catch (e) { /* cross-origin blocked */ }
      }
    } catch (e) { /* no iframes */ }

    // Strategy 10: Last resort — broad content extraction
    // Find the largest text block on the page (likely the document content)
    const allDivs = document.querySelectorAll('div, article, section, main')
    let bestText = ''
    let bestLen = 0
    for (const div of allDivs) {
      const t = (div.innerText || '').trim()
      // Skip if it includes too many menu/UI items (heuristic: long continuous text is content)
      if (t.length > bestLen && t.length > 100) {
        // Check it's not a short collection of menu items
        const avgLineLen = t.length / Math.max(1, t.split('\n').length)
        if (avgLineLen > 30) {
          bestLen = t.length
          bestText = t
        }
      }
    }
    if (bestText) {
      console.log('[DocIntel] Extracted text via largest-block heuristic (' + bestLen + ' chars)')
      return bestText
    }

    console.warn('[DocIntel] Failed to extract text from Google Docs — no strategy succeeded')
    return ''
  }

  function extractTextFromNotion() {
    // Notion renders text in blocks with [data-block-id] or .notion-selectable
    const blocks = document.querySelectorAll('[data-block-id] [placeholder], .notion-page-content [data-content-editable-leaf="true"]')
    if (blocks.length) {
      return Array.from(blocks).map(b => b.textContent || '').filter(t => t.trim()).join('\n')
    }

    // Broader fallback
    const content = document.querySelector('.notion-page-content, [data-content-editable-root="true"]')
    return content ? (content.innerText || '') : ''
  }

  function extractTextFromGenericComplex() {
    // For unknown complex editors, try the stored element's innerText
    if (state.complexEditorEl) {
      return state.complexEditorEl.innerText || ''
    }
    return ''
  }

  // ─── Activation Icon ──────────────────────────────────────────────

  function ensureShadowHost() {
    if (state.shadowHost) return state.shadowRoot

    const host = document.createElement('div')
    host.id = 'wa-doc-intel-host'
    host.style.cssText = 'all:initial !important; position:fixed !important; top:0 !important; left:0 !important; z-index:2147483645 !important; pointer-events:none !important; width:0 !important; height:0 !important;'
    document.body.appendChild(host)

    const shadow = host.attachShadow({ mode: 'closed' })

    const style = document.createElement('style')
    style.textContent = getDocIntelShadowStyles()
    shadow.appendChild(style)

    state.shadowHost = host
    state.shadowRoot = shadow
    return shadow
  }

  function showActivationIcon(field) {
    if (state.activationIcon) hideActivationIcon()
    if (state.toolbarVisible) return // Don't show icon if toolbar is already open

    const shadow = ensureShadowHost()
    const rect = field.getBoundingClientRect()

    const icon = document.createElement('div')
    icon.className = 'wa-activation-icon'
    safeSetInnerHTML(icon, '<span style="font-weight:700;font-size:13px;color:#c4b5fd;">W</span>')
    icon.style.cssText = `
      position: fixed;
      top: ${rect.top + 4}px;
      left: ${rect.right - 36}px;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #18181b;
      border: 1.5px solid #7c3aed;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      pointer-events: auto;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      transition: transform 0.15s, box-shadow 0.15s;
      z-index: 2147483645;
    `
    icon.title = 'Document Intelligence (Ctrl+Shift+G)'

    icon.addEventListener('mouseenter', () => {
      icon.style.transform = 'scale(1.1)'
      icon.style.boxShadow = '0 2px 12px rgba(124,58,237,0.4)'
    })
    icon.addEventListener('mouseleave', () => {
      icon.style.transform = 'scale(1)'
      icon.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)'
    })
    icon.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      hideActivationIcon()
      if (typeof window.__waDocIntelShowToolbar === 'function') {
        window.__waDocIntelShowToolbar(field)
      }
    })

    shadow.appendChild(icon)
    state.activationIcon = icon
  }

  function hideActivationIcon() {
    if (state.activationIcon) {
      state.activationIcon.remove()
      state.activationIcon = null
    }
  }

  // ─── Focus/Blur Handlers ──────────────────────────────────────────

  let blurTimeout = null
  let focusDebounce = null

  function handleFieldFocus(event) {
    if (!state.enabled) return
    if (blurTimeout) { clearTimeout(blurTimeout); blurTimeout = null }
    if (focusDebounce) clearTimeout(focusDebounce)

    focusDebounce = setTimeout(() => {
      const el = event.target

      // Check for complex editor first (Google Docs, Notion, etc.)
      if (!state.complexEditor) {
        const complex = detectComplexEditor()
        if (complex) {
          state.complexEditor = complex.type
          state.complexEditorEl = complex.element
          state.activeField = complex.element
          state.fieldType = 'complex'
          showActivationIcon(complex.element)
          return
        }
      } else if (state.complexEditorEl) {
        // Already detected — just show icon if needed
        if (!state.toolbarVisible && !state.activationIcon) {
          showActivationIcon(state.complexEditorEl)
        }
        return
      }

      if (!isEditableField(el)) return

      const root = getEditableRoot(el)
      const text = extractText(root)
      // Skip very short fields (search bars, single-word inputs)
      if (text.length < 10 && getFieldType(root) === 'input') return

      state.activeField = root
      state.fieldType = getFieldType(root)

      showActivationIcon(root)
    }, 100) // 100ms debounce
  }

  function handleFieldBlur(event) {
    if (!state.enabled) return
    // Delay to allow clicking the activation icon or toolbar
    blurTimeout = setTimeout(() => {
      if (!state.toolbarVisible) {
        hideActivationIcon()
        // Don't clear activeField if toolbar is open
      }
    }, 300)
  }

  // ─── Extension Context Check ─────────────────────────────────────

  function isExtensionContextValid() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id)
    } catch {
      return false
    }
  }

  // ─── Message Listener ─────────────────────────────────────────────

  try { chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'toggleDocIntel') {
      // Auto-enable when toggled via keyboard shortcut (Ctrl+Shift+G)
      if (!state.enabled) {
        state.enabled = true
        console.log('[DocIntel] Auto-enabled via keyboard shortcut')
      }

      if (state.activeField && typeof window.__waDocIntelShowToolbar === 'function') {
        if (state.toolbarVisible) {
          if (typeof window.__waDocIntelHideToolbar === 'function') {
            window.__waDocIntelHideToolbar()
          }
        } else {
          hideActivationIcon()
          window.__waDocIntelShowToolbar(state.activeField)
        }
      } else {
        // No active field — try complex editor detection first
        const complex = detectComplexEditor()
        if (complex) {
          state.complexEditor = complex.type
          state.complexEditorEl = complex.element
          state.activeField = complex.element
          state.fieldType = 'complex'
          hideActivationIcon()
          if (typeof window.__waDocIntelShowToolbar === 'function') {
            window.__waDocIntelShowToolbar(complex.element)
          }
        } else {
          // Try focused element
          const active = document.activeElement
          if (active && isEditableField(active)) {
            const root = getEditableRoot(active)
            state.activeField = root
            state.fieldType = getFieldType(root)
            hideActivationIcon()
            if (typeof window.__waDocIntelShowToolbar === 'function') {
              window.__waDocIntelShowToolbar(root)
            }
          }
        }
      }
      sendResponse({ ok: true })
      return true
    }

    // Not for us — let other listeners handle it
    return false
  }) } catch (err) { console.warn('[DocIntel] Could not register message listener:', err.message) }

  // ─── Init: Load enabled state and attach listeners ────────────────

  function init() {
    // Auto-enable for Google Docs — users shouldn't need to toggle a setting
    const isGoogleDocs = window.location.href.includes('docs.google.com/document/')

    if (isExtensionContextValid()) {
      try {
        chrome.storage.local.get(['docIntelEnabled'], (result) => {
          if (chrome.runtime.lastError) {
            console.warn('[DocIntel] Storage read failed:', chrome.runtime.lastError.message)
            // Auto-enable for Google Docs even on storage error
            if (isGoogleDocs) {
              state.enabled = true
              tryDetectComplexEditorDelayed()
            }
            return
          }
          // Auto-enable for Google Docs regardless of stored setting
          state.enabled = isGoogleDocs || result.docIntelEnabled === true
          // Auto-detect complex editors on page load when enabled
          if (state.enabled) {
            tryDetectComplexEditorDelayed()
          }
        })
      } catch (err) {
        console.warn('[DocIntel] Init storage read failed:', err.message)
        // Auto-enable for Google Docs even on error
        if (isGoogleDocs) {
          state.enabled = true
          tryDetectComplexEditorDelayed()
        }
      }

      try {
        chrome.storage.onChanged.addListener((changes) => {
          if (changes.docIntelEnabled) {
            state.enabled = changes.docIntelEnabled.newValue === true
            if (!state.enabled) {
              hideActivationIcon()
              state.complexEditor = null
              state.complexEditorEl = null
              if (typeof window.__waDocIntelHideToolbar === 'function') {
                window.__waDocIntelHideToolbar()
              }
              if (typeof window.__waDocIntelClearMarks === 'function') {
                window.__waDocIntelClearMarks()
              }
            } else {
              // Just enabled — try detecting complex editor
              tryDetectComplexEditorDelayed()
            }
          }
        })
      } catch (err) {
        console.warn('[DocIntel] Storage change listener failed:', err.message)
      }
    } else {
      console.warn('[DocIntel] Extension context not available — running in degraded mode')
    }

    document.addEventListener('focusin', handleFieldFocus, true)
    document.addEventListener('focusout', handleFieldBlur, true)
  }

  /**
   * Delayed complex editor detection — gives the page time to render its editor.
   * Retries up to 3 times with 1s intervals (for SPAs like Google Docs that load dynamically).
   */
  function tryDetectComplexEditorDelayed() {
    let attempts = 0
    const maxAttempts = 5

    function tryDetect() {
      const complex = detectComplexEditor()
      if (complex) {
        state.complexEditor = complex.type
        state.complexEditorEl = complex.element
        state.activeField = complex.element
        state.fieldType = 'complex'
        // Show activation icon if not already showing toolbar
        if (state.enabled && !state.toolbarVisible) {
          showActivationIcon(complex.element)
        }
        return
      }

      attempts++
      if (attempts < maxAttempts) {
        setTimeout(tryDetect, 1000)
      }
    }

    // First attempt after a short delay
    setTimeout(tryDetect, 500)
  }

  // ─── Shadow DOM Styles ────────────────────────────────────────────

  function getDocIntelShadowStyles() {
    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .wa-activation-icon {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .wa-toolbar {
        position: fixed;
        background: #18181b;
        border: 1px solid #3f3f46;
        border-radius: 10px;
        padding: 8px 10px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        color: #d4d4d8;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 320px;
        max-width: 580px;
        z-index: 2147483645;
      }

      .wa-toolbar-row {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
      }

      .wa-chip {
        padding: 3px 8px;
        border-radius: 12px;
        border: 1px solid #52525b;
        background: transparent;
        color: #a1a1aa;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
        outline: none;
        font-family: inherit;
      }
      .wa-chip:hover { border-color: #7c3aed; color: #c4b5fd; }
      .wa-chip.active { background: #7c3aed; color: #fff; border-color: #7c3aed; }

      .wa-chip-grammar.active { background: #10b981; border-color: #10b981; }
      .wa-chip-clarity.active { background: #f59e0b; border-color: #f59e0b; color: #18181b; }
      .wa-chip-conciseness.active { background: #3b82f6; border-color: #3b82f6; }
      .wa-chip-tone.active { background: #8b5cf6; border-color: #8b5cf6; }
      .wa-chip-structure.active { background: #f43f5e; border-color: #f43f5e; }

      .wa-chip-analyze { font-style: italic; }
      .wa-chip-logic.active { background: #f97316; border-color: #f97316; color: #18181b; }
      .wa-chip-evidence.active { background: #06b6d4; border-color: #06b6d4; color: #18181b; }
      .wa-chip-bias.active { background: #ec4899; border-color: #ec4899; }

      .wa-custom-input {
        flex: 1;
        min-width: 120px;
        padding: 4px 8px;
        background: #27272a;
        border: 1px solid #3f3f46;
        border-radius: 6px;
        color: #d4d4d8;
        font-size: 11px;
        outline: none;
        font-family: inherit;
      }
      .wa-custom-input:focus { border-color: #7c3aed; }
      .wa-custom-input::placeholder { color: #71717a; }

      .wa-run-btn {
        padding: 4px 14px;
        background: #7c3aed;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
        font-family: inherit;
        white-space: nowrap;
      }
      .wa-run-btn:hover { background: #6d28d9; }
      .wa-run-btn:disabled { background: #3f3f46; color: #71717a; cursor: not-allowed; }

      .wa-close-btn {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: #71717a;
        font-size: 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s;
        font-family: inherit;
      }
      .wa-close-btn:hover { color: #f4f4f5; }

      .wa-status {
        font-size: 10px;
        color: #71717a;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .wa-status-badge {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 8px;
        font-size: 10px;
        font-weight: 600;
      }
      .wa-status-count { background: #7c3aed22; color: #c4b5fd; }
      .wa-status-error { background: #f43f5e22; color: #fb7185; }

      .wa-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid #3f3f46;
        border-top: 2px solid #7c3aed;
        border-radius: 50%;
        animation: wa-spin 0.6s linear infinite;
      }
      @keyframes wa-spin { to { transform: rotate(360deg); } }

      /* ─── Hover Card ─── */
      .wa-card {
        position: fixed;
        background: #18181b;
        border: 1px solid #3f3f46;
        border-radius: 10px;
        padding: 10px 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        color: #d4d4d8;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        pointer-events: auto;
        max-width: 360px;
        min-width: 220px;
        z-index: 2147483645;
      }

      .wa-card-badge {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 8px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      .wa-badge-grammar { background: #10b98122; color: #34d399; }
      .wa-badge-clarity { background: #f59e0b22; color: #fbbf24; }
      .wa-badge-conciseness { background: #3b82f622; color: #60a5fa; }
      .wa-badge-tone { background: #8b5cf622; color: #a78bfa; }
      .wa-badge-structure { background: #f43f5e22; color: #fb7185; }
      .wa-badge-custom { background: #a855f722; color: #c084fc; }

      .wa-badge-critical { background: #f43f5e22; color: #fb7185; }
      .wa-badge-warning { background: #f59e0b22; color: #fbbf24; }
      .wa-badge-info { background: #3b82f622; color: #60a5fa; }

      .wa-card-explanation {
        color: #a1a1aa;
        font-size: 11px;
        line-height: 1.4;
        margin: 4px 0 8px 0;
      }

      .wa-card-confidence {
        font-size: 10px;
        color: #71717a;
        margin-left: 6px;
      }

      .wa-variant-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 8px;
      }

      .wa-variant {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        padding: 4px 6px;
        border-radius: 6px;
        border: 1px solid #3f3f46;
        cursor: pointer;
        transition: border-color 0.15s;
        font-size: 11px;
      }
      .wa-variant:hover { border-color: #7c3aed; }
      .wa-variant.selected { border-color: #7c3aed; background: #7c3aed11; }

      .wa-variant-radio {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid #52525b;
        flex-shrink: 0;
        margin-top: 1px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .wa-variant.selected .wa-variant-radio {
        border-color: #7c3aed;
      }
      .wa-variant.selected .wa-variant-radio::after {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #7c3aed;
      }

      .wa-variant-text { color: #d4d4d8; line-height: 1.3; }
      .wa-variant-label { color: #71717a; font-size: 10px; margin-top: 1px; }

      .wa-card-actions {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
      }

      .wa-btn-accept {
        padding: 3px 12px;
        background: #10b981;
        color: white;
        border: none;
        border-radius: 5px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
      }
      .wa-btn-accept:hover { background: #059669; }
      .wa-btn-accept:disabled { background: #3f3f46; color: #71717a; cursor: not-allowed; }

      .wa-btn-dismiss {
        padding: 3px 12px;
        background: transparent;
        color: #71717a;
        border: 1px solid #3f3f46;
        border-radius: 5px;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit;
      }
      .wa-btn-dismiss:hover { color: #d4d4d8; border-color: #52525b; }

      .wa-finding-text {
        color: #d4d4d8;
        font-size: 11px;
        line-height: 1.4;
        margin: 4px 0;
      }
      .wa-finding-suggestion {
        color: #a1a1aa;
        font-size: 11px;
        font-style: italic;
        margin-top: 4px;
        padding-left: 8px;
        border-left: 2px solid #3f3f46;
      }

      .wa-analysis-summary {
        position: fixed;
        bottom: 12px;
        right: 12px;
        background: #18181b;
        border: 1px solid #3f3f46;
        border-radius: 10px;
        padding: 10px 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 11px;
        color: #a1a1aa;
        max-width: 360px;
        pointer-events: auto;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        z-index: 2147483645;
      }
      .wa-analysis-summary-title {
        font-weight: 600;
        color: #d4d4d8;
        margin-bottom: 4px;
      }

      /* ─── Results Panel (for complex editors like Google Docs) ─── */
      .wa-results-panel {
        max-height: 320px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 2px 0;
      }
      .wa-results-panel::-webkit-scrollbar { width: 6px; }
      .wa-results-panel::-webkit-scrollbar-track { background: transparent; }
      .wa-results-panel::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }

      .wa-result-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px 10px;
        border: 1px solid #3f3f46;
        border-radius: 8px;
        background: #1f1f23;
        transition: border-color 0.15s;
      }
      .wa-result-item:hover { border-color: #52525b; }

      .wa-result-header {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .wa-result-original {
        font-size: 11px;
        color: #71717a;
        text-decoration: line-through;
        line-height: 1.4;
        word-break: break-word;
      }

      .wa-result-arrow {
        color: #52525b;
        font-size: 10px;
        flex-shrink: 0;
      }

      .wa-result-replacement {
        font-size: 11px;
        color: #d4d4d8;
        line-height: 1.4;
        word-break: break-word;
      }

      .wa-result-explanation {
        font-size: 10px;
        color: #71717a;
        line-height: 1.3;
        margin-top: 2px;
      }

      .wa-result-actions {
        display: flex;
        gap: 4px;
        justify-content: flex-end;
        margin-top: 2px;
      }

      .wa-btn-copy {
        padding: 2px 10px;
        background: #10b981;
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s;
      }
      .wa-btn-copy:hover { background: #059669; }

      .wa-btn-dismiss-sm {
        padding: 2px 10px;
        background: transparent;
        color: #71717a;
        border: 1px solid #3f3f46;
        border-radius: 4px;
        font-size: 10px;
        cursor: pointer;
        font-family: inherit;
        transition: all 0.15s;
      }
      .wa-btn-dismiss-sm:hover { color: #a1a1aa; border-color: #52525b; }

      .wa-complex-notice {
        font-size: 10px;
        color: #71717a;
        font-style: italic;
        padding: 4px 0;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .wa-complex-notice-icon { font-size: 12px; }

      .wa-result-finding {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px 10px;
        border: 1px solid #3f3f46;
        border-radius: 8px;
        background: #1f1f23;
      }
      .wa-result-finding-text {
        font-size: 11px;
        color: #d4d4d8;
        line-height: 1.4;
      }
      .wa-result-finding-suggestion {
        font-size: 10px;
        color: #a1a1aa;
        font-style: italic;
        padding-left: 8px;
        border-left: 2px solid #3f3f46;
      }

      /* ─── Canvas Mode Panel (larger, primary display) ─── */
      .wa-result-item-canvas {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 12px;
        border: 1px solid #3f3f46;
        border-radius: 10px;
        background: #1f1f23;
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      .wa-result-item-canvas:hover {
        border-color: #7c3aed44;
        box-shadow: 0 0 0 1px #7c3aed22;
      }

      .wa-result-original-block {
        font-size: 12px;
        color: #a1a1aa;
        line-height: 1.5;
        padding: 6px 10px;
        background: #27272a;
        border-radius: 6px;
        border-left: 3px solid #52525b;
        word-break: break-word;
      }

      .wa-result-variants-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .wa-result-variant-option {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid #3f3f46;
        cursor: pointer;
        transition: all 0.15s;
        font-size: 12px;
      }
      .wa-result-variant-option:hover { border-color: #7c3aed; background: #7c3aed08; }
      .wa-result-variant-option.selected { border-color: #7c3aed; background: #7c3aed11; }

      .wa-result-variant-radio {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid #52525b;
        flex-shrink: 0;
        margin-top: 2px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: border-color 0.15s;
      }
      .wa-result-variant-option.selected .wa-result-variant-radio {
        border-color: #7c3aed;
      }
      .wa-result-variant-option.selected .wa-result-variant-radio::after {
        content: '';
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #7c3aed;
      }

      .wa-result-variant-content {
        flex: 1;
      }
      .wa-result-variant-text { color: #e4e4e7; line-height: 1.4; }
      .wa-result-variant-label {
        color: #71717a;
        font-size: 10px;
        margin-top: 2px;
        font-style: italic;
      }

      .wa-result-explanation-block {
        font-size: 11px;
        color: #71717a;
        line-height: 1.4;
        padding-top: 2px;
      }

      .wa-result-actions-row {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
        padding-top: 2px;
      }

      .wa-btn-copy-lg {
        padding: 4px 14px;
        background: #10b981;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s;
      }
      .wa-btn-copy-lg:hover { background: #059669; }

      .wa-btn-dismiss-lg {
        padding: 4px 14px;
        background: transparent;
        color: #71717a;
        border: 1px solid #3f3f46;
        border-radius: 6px;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit;
        transition: all 0.15s;
      }
      .wa-btn-dismiss-lg:hover { color: #a1a1aa; border-color: #52525b; }
    `
  }

  // Expose helpers for other modules
  window.__waDocIntelHelpers = {
    isEditableField,
    getEditableRoot,
    getFieldType,
    extractText,
    ensureShadowHost,
    hideActivationIcon,
    getDocIntelShadowStyles,
    detectComplexEditor,
    extractTextFromComplexEditor,
    isGDocsCanvasMode,
    safeSetInnerHTML,
  }

  // ─── Early DOCS_modelChunk Capture ──────────────────────────────
  // Run immediately (before DOMContentLoaded) to capture the transient
  // DOCS_modelChunk data before Google Docs clears it.
  eagerCaptureGDocsText()

  // ─── Boot ─────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Try one more capture after DOM is ready
      if (!state._cachedGDocsText) eagerCaptureGDocsText()
      init()
    })
  } else {
    init()
  }
})()
