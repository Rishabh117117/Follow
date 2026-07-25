/**
 * doc-intel-overlay.js — Mark Application & Text Replacement
 *
 * Applies visual suggestion marks (colored underlines) to editable fields.
 * Strategy A: contentEditable — inject <span> marks into the DOM
 * Strategy B: textarea — mirror overlay technique (Phase 2)
 *
 * Handles accept (text replacement) and dismiss (mark removal).
 * MutationObserver defense for editors that fight DOM changes.
 * Form submission cleanup to prevent mark contamination.
 */

;(function () {
  'use strict'

  const state = window.__waDocIntel

  // ─── Page CSS Injection ───────────────────────────────────────────

  function injectPageStyles() {
    if (document.getElementById('wa-doc-intel-styles')) return
    const style = document.createElement('style')
    style.id = 'wa-doc-intel-styles'
    style.textContent = `
      .wa-doc-suggestion {
        text-decoration: underline !important;
        text-decoration-thickness: 2px !important;
        text-underline-offset: 2px !important;
        cursor: pointer !important;
        transition: opacity 0.15s !important;
        text-decoration-skip-ink: none !important;
      }
      .wa-doc-suggestion-clarity    { text-decoration-color: #f59e0b !important; }
      .wa-doc-suggestion-conciseness { text-decoration-color: #3b82f6 !important; }
      .wa-doc-suggestion-tone       { text-decoration-color: #8b5cf6 !important; }
      .wa-doc-suggestion-grammar    { text-decoration-color: #10b981 !important; }
      .wa-doc-suggestion-structure  { text-decoration-color: #f43f5e !important; }
      .wa-doc-suggestion-custom     { text-decoration-color: #a855f7 !important; }
      .wa-doc-suggestion-dimmed     { opacity: 0.3 !important; }

      /* Analysis findings use same underline style */
      .wa-doc-finding { text-decoration: wavy underline !important; text-decoration-thickness: 1.5px !important; text-underline-offset: 2px !important; cursor: pointer !important; }
      .wa-doc-finding-critical { text-decoration-color: #f43f5e !important; }
      .wa-doc-finding-warning  { text-decoration-color: #f59e0b !important; }
      .wa-doc-finding-info     { text-decoration-color: #3b82f6 !important; }
    `
    document.head.appendChild(style)
  }

  // ─── ContentEditable: Mark Application ────────────────────────────

  function applyContentEditableMarks(element, suggestions) {
    if (!element || !suggestions.length) return { applied: 0, skipped: 0 }

    // Complex editors: skip inline marks — results panel handles display
    if (state.complexEditor) {
      return { applied: 0, skipped: suggestions.length, complexEditor: true }
    }

    injectPageStyles()

    let applied = 0
    let skipped = 0

    // Process in reverse to preserve text offsets
    const sortedSugs = [...suggestions].reverse()

    for (const sug of sortedSugs) {
      const matched = findTextInElement(element, sug.spanText)
      if (!matched) {
        skipped++
        continue
      }

      try {
        const span = document.createElement('span')
        span.className = `wa-doc-suggestion wa-doc-suggestion-${sug.suggestionType}`
        span.dataset.suggestionId = sug.id
        span.dataset.suggestionType = sug.suggestionType

        matched.range.surroundContents(span)
        applied++
      } catch (e) {
        // surroundContents can fail if the range spans across elements
        // Try alternative: extractContents + wrap + insert
        try {
          const range = matched.range
          const span = document.createElement('span')
          span.className = `wa-doc-suggestion wa-doc-suggestion-${sug.suggestionType}`
          span.dataset.suggestionId = sug.id
          span.dataset.suggestionType = sug.suggestionType

          const contents = range.extractContents()
          span.appendChild(contents)
          range.insertNode(span)
          applied++
        } catch (e2) {
          skipped++
        }
      }
    }

    // Watch for editors removing our marks
    watchForMarkRemoval(element)

    return { applied, skipped }
  }

  function applyFindingMarks(element, findings) {
    if (!element || !findings.length) return { applied: 0, skipped: 0 }

    // Complex editors: skip inline marks — results panel handles display
    if (state.complexEditor) {
      return { applied: 0, skipped: findings.length, complexEditor: true }
    }

    injectPageStyles()

    let applied = 0
    let skipped = 0

    const sortedFindings = [...findings].reverse()

    for (const finding of sortedFindings) {
      const matched = findTextInElement(element, finding.spanText)
      if (!matched) { skipped++; continue }

      try {
        const span = document.createElement('span')
        span.className = `wa-doc-finding wa-doc-finding-${finding.severity}`
        span.dataset.suggestionId = finding.id
        span.dataset.findingMode = finding.mode

        matched.range.surroundContents(span)
        applied++
      } catch (e) {
        skipped++
      }
    }

    return { applied, skipped }
  }

  // ─── Text Finding (TreeWalker) ────────────────────────────────────

  function findTextInElement(element, searchText) {
    if (!searchText || !element) return null

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null)
    let currentNode
    let fullText = ''
    const textNodes = []

    // Collect all text nodes and build full text
    while ((currentNode = walker.nextNode())) {
      textNodes.push({ node: currentNode, offset: fullText.length })
      fullText += currentNode.textContent
    }

    // Find the search text
    const idx = fullText.indexOf(searchText)
    if (idx === -1) return null

    // Map the offset back to text nodes
    let startNode = null, startOffset = 0
    let endNode = null, endOffset = 0

    for (let i = 0; i < textNodes.length; i++) {
      const tn = textNodes[i]
      const nodeEnd = tn.offset + tn.node.textContent.length

      if (!startNode && idx < nodeEnd) {
        startNode = tn.node
        startOffset = idx - tn.offset
      }

      const endIdx = idx + searchText.length
      if (!endNode && endIdx <= nodeEnd) {
        endNode = tn.node
        endOffset = endIdx - tn.offset
      }

      if (startNode && endNode) break
    }

    if (!startNode || !endNode) return null

    const range = document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)

    return { range }
  }

  // ─── MutationObserver Defense ─────────────────────────────────────

  let domObserver = null

  function watchForMarkRemoval(element) {
    if (domObserver) domObserver.disconnect()
    if (state.editorFightsDOM) return // Already in overlay mode

    domObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const removed of m.removedNodes) {
          if (removed.nodeType === 1 && removed.classList && removed.classList.contains('wa-doc-suggestion')) {
            // Editor removed our mark — switch to overlay mode
            console.log('[DocIntel] Editor removed marks — switching to overlay mode')
            state.editorFightsDOM = true
            domObserver.disconnect()
            domObserver = null
            // TODO: Phase 2 — switch to overlay mode for this field
            return
          }
        }
      }
    })

    domObserver.observe(element, { childList: true, subtree: true })
  }

  // ─── Accept / Dismiss ─────────────────────────────────────────────

  function acceptSuggestion(suggestionId, newText) {
    const field = state.activeField
    if (!field) return false

    const fieldType = state.fieldType

    // Complex editor: copy replacement text to clipboard + remove overlay
    if (state.complexEditor) {
      return acceptComplexEditor(suggestionId, newText)
    }

    if (fieldType === 'contenteditable') {
      return acceptContentEditable(field, suggestionId, newText)
    } else if (fieldType === 'textarea') {
      return acceptTextarea(field, suggestionId, newText)
    }
    return false
  }

  function dismissSuggestion(suggestionId) {
    const field = state.activeField
    if (!field) return false

    const fieldType = state.fieldType

    // Complex editor: remove overlay entry
    if (state.complexEditor) {
      return dismissComplexEditor(suggestionId)
    }

    if (fieldType === 'contenteditable') {
      return dismissContentEditable(field, suggestionId)
    } else if (fieldType === 'textarea') {
      return dismissTextarea(field, suggestionId)
    }
    return false
  }

  function acceptComplexEditor(suggestionId, newText) {
    // Copy the replacement text to clipboard
    try {
      navigator.clipboard.writeText(newText).then(() => {
        showCopiedToast()
      }).catch(() => {
        // Fallback
        const ta = document.createElement('textarea')
        ta.value = newText
        ta.style.cssText = 'position:fixed;left:-9999px;'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
        showCopiedToast()
      })
    } catch (e) { /* ignore clipboard failures */ }

    // Remove the overlay underline
    removeOverlayEntry(suggestionId)

    // Remove from state
    state.suggestions = state.suggestions.filter(s => s.id !== suggestionId)
    state.findings = state.findings.filter(f => f.id !== suggestionId)

    return true
  }

  function dismissComplexEditor(suggestionId) {
    removeOverlayEntry(suggestionId)
    state.suggestions = state.suggestions.filter(s => s.id !== suggestionId)
    state.findings = state.findings.filter(f => f.id !== suggestionId)
    return true
  }

  function showCopiedToast() {
    const helpers = window.__waDocIntelHelpers
    if (!helpers) return
    const shadow = helpers.ensureShadowHost()
    if (!shadow) return

    const toast = document.createElement('div')
    toast.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
      'background:#059669;color:white;padding:8px 16px;border-radius:8px;' +
      'font-size:13px;font-family:system-ui;z-index:1000000;' +
      'box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 0.3s;'
    toast.textContent = '\u2713 Copied to clipboard — paste in the document'
    shadow.appendChild(toast)
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300) }, 2500)
  }

  function acceptContentEditable(element, suggestionId, newText) {
    const span = element.querySelector(`[data-suggestion-id="${suggestionId}"]`)
    if (!span) return false

    // Pause observer while we modify the DOM
    if (domObserver) domObserver.disconnect()

    const textNode = document.createTextNode(newText)
    span.parentNode.replaceChild(textNode, span)

    // Notify the editor that content changed
    element.dispatchEvent(new Event('input', { bubbles: true }))

    // Remove from state
    state.suggestions = state.suggestions.filter(s => s.id !== suggestionId)
    state.findings = state.findings.filter(f => f.id !== suggestionId)

    // Re-observe
    if (!state.editorFightsDOM && state.suggestions.length > 0) {
      watchForMarkRemoval(element)
    }

    return true
  }

  function dismissContentEditable(element, suggestionId) {
    const span = element.querySelector(`[data-suggestion-id="${suggestionId}"]`)
    if (!span) return false

    if (domObserver) domObserver.disconnect()

    const textNode = document.createTextNode(span.textContent)
    span.parentNode.replaceChild(textNode, span)

    state.suggestions = state.suggestions.filter(s => s.id !== suggestionId)
    state.findings = state.findings.filter(f => f.id !== suggestionId)

    if (!state.editorFightsDOM && state.suggestions.length > 0) {
      watchForMarkRemoval(element)
    }

    return true
  }

  // ─── Textarea: Phase 2 stubs ──────────────────────────────────────

  function acceptTextarea(textarea, suggestionId, newText) {
    const sug = state.suggestions.find(s => s.id === suggestionId)
    if (!sug) return false

    const idx = textarea.value.indexOf(sug.spanText)
    if (idx === -1) return false

    const before = textarea.value.slice(0, idx)
    const after = textarea.value.slice(idx + sug.spanText.length)
    textarea.value = before + newText + after

    // Position cursor after the replacement
    const cursorPos = idx + newText.length
    textarea.setSelectionRange(cursorPos, cursorPos)

    textarea.dispatchEvent(new Event('input', { bubbles: true }))

    state.suggestions = state.suggestions.filter(s => s.id !== suggestionId)

    // Update mirror overlay if it exists
    if (state.mirrorOverlay) {
      syncMirrorContent(textarea, state.mirrorOverlay, state.suggestions)
    }

    return true
  }

  function dismissTextarea(textarea, suggestionId) {
    state.suggestions = state.suggestions.filter(s => s.id !== suggestionId)
    state.findings = state.findings.filter(f => f.id !== suggestionId)

    if (state.mirrorOverlay) {
      syncMirrorContent(textarea, state.mirrorOverlay, state.suggestions)
    }

    return true
  }

  // ─── Textarea: Mirror Overlay (Phase 2) ───────────────────────────

  function createMirrorOverlay(textarea) {
    const mirror = document.createElement('div')
    mirror.className = 'wa-textarea-mirror'

    // Copy all text-affecting styles from the textarea
    const cs = window.getComputedStyle(textarea)
    const stylesToCopy = [
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
      'letterSpacing', 'wordSpacing', 'textIndent', 'textAlign', 'textTransform',
      'whiteSpace', 'wordWrap', 'overflowWrap', 'direction',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'boxSizing',
    ]

    let cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;'
    cssText += `width:${textarea.offsetWidth}px;height:${textarea.offsetHeight}px;`
    cssText += 'background:transparent;color:transparent;border-color:transparent;'
    for (const prop of stylesToCopy) {
      cssText += `${prop.replace(/([A-Z])/g, '-$1').toLowerCase()}:${cs[prop]};`
    }

    mirror.style.cssText = cssText

    // Position the mirror over the textarea
    const parent = textarea.parentElement
    if (parent) {
      const parentPos = window.getComputedStyle(parent).position
      if (parentPos === 'static') parent.style.position = 'relative'
    }
    textarea.insertAdjacentElement('afterend', mirror)

    // Scroll sync
    textarea.addEventListener('scroll', () => {
      mirror.scrollTop = textarea.scrollTop
      mirror.scrollLeft = textarea.scrollLeft
    })

    // Resize sync
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        mirror.style.width = textarea.offsetWidth + 'px'
        mirror.style.height = textarea.offsetHeight + 'px'
      }).observe(textarea)
    }

    state.mirrorOverlay = mirror
    return mirror
  }

  function syncMirrorContent(textarea, mirror, suggestions) {
    const text = textarea.value
    let html = ''
    let lastIdx = 0

    // Sort suggestions by their position in the text
    const withOffsets = suggestions
      .map(s => ({ ...s, idx: text.indexOf(s.spanText) }))
      .filter(s => s.idx !== -1)
      .sort((a, b) => a.idx - b.idx)

    // Handle overlapping: skip if start is before previous end
    let prevEnd = 0
    for (const s of withOffsets) {
      if (s.idx < prevEnd) continue // Skip overlapping

      html += escapeHTML(text.slice(lastIdx, s.idx))
      html += `<mark class="wa-doc-suggestion wa-doc-suggestion-${s.suggestionType}" `
      html += `data-suggestion-id="${s.id}" data-suggestion-type="${s.suggestionType}" `
      html += `style="background:none;color:transparent;border-bottom:2px solid;pointer-events:auto;position:relative;`

      // Type-specific color
      const colors = {
        grammar: '#10b981', clarity: '#f59e0b', conciseness: '#3b82f6',
        tone: '#8b5cf6', structure: '#f43f5e', custom: '#a855f7'
      }
      html += `border-bottom-color:${colors[s.suggestionType] || '#a855f7'};`
      html += `">${escapeHTML(s.spanText)}</mark>`

      lastIdx = s.idx + s.spanText.length
      prevEnd = lastIdx
    }

    html += escapeHTML(text.slice(lastIdx))
    const _helpers = window.__waDocIntelHelpers
    if (_helpers && _helpers.safeSetInnerHTML) _helpers.safeSetInnerHTML(mirror, html)
    else mirror.innerHTML = html
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function applyTextareaMarks(textarea, suggestions) {
    if (!textarea || !suggestions.length) return { applied: 0, skipped: 0 }

    injectPageStyles()

    let mirror = state.mirrorOverlay
    if (!mirror) mirror = createMirrorOverlay(textarea)

    syncMirrorContent(textarea, mirror, suggestions)

    // Count how many were actually placed
    const applied = suggestions.filter(s => textarea.value.indexOf(s.spanText) !== -1).length
    const skipped = suggestions.length - applied

    return { applied, skipped }
  }

  // ─── Complex Editor Overlay (Grammarly-style) ────────────────────
  //
  // For editors like Google Docs where we can't inject <span> marks,
  // we create position:fixed underline divs that float over matching text.
  // The underlines track scroll and trigger hover cards on mouseenter.

  let overlayContainer = null
  let overlayEntries = []   // { id, type, rects, elements, range }
  let scrollListenerEl = null
  let scrollHandler = null
  let rafId = null

  // Canvas mode state (for scroll refresh)
  let canvasPageInfo = null
  let canvasLayout = null
  let canvasMetrics = null
  let canvasScrollHandler = null
  let canvasScrollRaf = null

  const UNDERLINE_COLORS = {
    clarity: '#f59e0b', conciseness: '#3b82f6', tone: '#8b5cf6',
    grammar: '#10b981', structure: '#f43f5e', custom: '#a855f7',
    critical: '#f43f5e', warning: '#f59e0b', info: '#3b82f6',
  }

  /**
   * Find the Google Docs (or similar) scroll container.
   * Returns the element that scrolls the document content.
   * Uses a two-step approach: try known selectors (verifying they scroll),
   * then walk up from content to find the scrollable ancestor.
   */
  function findScrollContainer() {
    // Step 1: Try known selectors — verify each actually scrolls
    const selectors = [
      '.kix-appview-editor',
      '.docs-editor-container',
      '.kix-paginateddocumentplugin',
      '.notion-frame',
      '.coda-doc-view',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el) {
        const style = window.getComputedStyle(el)
        const overflows = style.overflow === 'auto' || style.overflow === 'scroll' ||
                          style.overflowY === 'auto' || style.overflowY === 'scroll'
        if (overflows || el.scrollHeight > el.clientHeight + 10) {
          return el
        }
        // Even if not verifiably scrollable, still return known containers
        // (Google Docs may not expose overflow correctly)
        return el
      }
    }

    // Step 2: Walk up from content to find scrollable ancestor
    const firstPara = document.querySelector('.kix-paragraphrenderer')
    if (firstPara) {
      let el = firstPara.parentElement
      while (el && el !== document.body && el !== document.documentElement) {
        const style = window.getComputedStyle(el)
        if ((style.overflow === 'auto' || style.overflow === 'scroll' ||
             style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight + 10) {
          return el
        }
        el = el.parentElement
      }
    }

    return document.documentElement
  }

  /**
   * Normalize Unicode chars that Google Docs uses:
   * smart quotes → straight, em/en-dash → hyphen, etc.
   */
  function normalizeChars(str) {
    return (str || '')
      .replace(/[\u2018\u2019\u201A\u0060\u00B4]/g, "'")   // smart single quotes → '
      .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')     // smart double quotes → "
      .replace(/[\u2013\u2014\u2015]/g, '-')                  // en/em dash → -
      .replace(/\u2026/g, '...')                               // ellipsis → ...
      .replace(/\u00A0/g, ' ')                                 // non-breaking space → space
      .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')             // zero-width chars → remove
  }

  /**
   * Normalize whitespace: collapse runs of \s to ' ', trim.
   */
  function normalizeWS(str) {
    return (str || '').replace(/\s+/g, ' ').trim()
  }

  /**
   * Full normalization: chars + whitespace.
   */
  function normalize(str) {
    return normalizeWS(normalizeChars(str))
  }

  /**
   * Build a DOM Range from a raw text offset within collected text nodes.
   */
  function buildRangeFromOffset(textNodes, offset, length) {
    let startNode = null, startOffset = 0
    let endNode = null, endOffset = 0

    for (let i = 0; i < textNodes.length; i++) {
      const tn = textNodes[i]
      const nodeLen = tn.node.textContent.length
      const nodeEnd = tn.rawOffset + (tn.synthetic ? 1 : nodeLen)

      if (!startNode && offset < nodeEnd) {
        startNode = tn.node
        // Clamp offset within the text node's actual length
        // (synthetic entries may cause overshoot past the node boundary)
        startOffset = Math.min(offset - tn.rawOffset, nodeLen)
      }

      const endIdx = offset + length
      if (!endNode && endIdx <= nodeEnd) {
        endNode = tn.node
        endOffset = Math.min(endIdx - tn.rawOffset, nodeLen)
      }

      if (startNode && endNode) break
    }

    if (!startNode || !endNode) return null

    try {
      const range = document.createRange()
      range.setStart(startNode, startOffset)
      range.setEnd(endNode, endOffset)
      return { range }
    } catch (e) {
      return null
    }
  }

  /**
   * Build a normalized-char map for a raw string.
   * Returns { normStr, normToRaw[] } where normToRaw[i] maps to the raw index.
   * This collapses whitespace AND normalizes Unicode chars.
   */
  function buildNormMap(rawStr) {
    const chars = normalizeChars(rawStr)
    const normChars = []
    const normToRaw = []
    let inSpace = false

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]
      // Map back to original raw index (normalizeChars is char-for-char except removals)
      // Since normalizeChars can change char count (e.g., remove zero-width),
      // we need to track the raw index more carefully.
      // Actually normalizeChars replaces in-place on the string, so indices shift.
      // Safer: build from raw string directly.
    }

    // Simpler approach: walk the raw string directly
    const normChars2 = []
    const normToRaw2 = []
    let inSpace2 = false

    for (let i = 0; i < rawStr.length; i++) {
      let ch = rawStr[i]

      // Skip zero-width chars
      if ('\u200B\u200C\u200D\uFEFF'.includes(ch)) continue

      // Normalize Unicode chars
      if ('\u2018\u2019\u201A\u0060\u00B4'.includes(ch)) ch = "'"
      else if ('\u201C\u201D\u201E\u00AB\u00BB'.includes(ch)) ch = '"'
      else if ('\u2013\u2014\u2015'.includes(ch)) ch = '-'
      else if (ch === '\u2026') { normChars2.push('.', '.', '.'); normToRaw2.push(i, i, i); inSpace2 = false; continue }
      else if (ch === '\u00A0') ch = ' '

      // Collapse whitespace
      if (/\s/.test(ch)) {
        if (!inSpace2 && normChars2.length > 0) {
          normChars2.push(' ')
          normToRaw2.push(i)
          inSpace2 = true
        }
      } else {
        normChars2.push(ch)
        normToRaw2.push(i)
        inSpace2 = false
      }
    }

    return { normStr: normChars2.join(''), normToRaw: normToRaw2 }
  }

  /**
   * Collect text nodes ONLY from Google Docs word-node spans within a paragraph.
   * This matches exactly how text was extracted for the API.
   */
  function collectWordNodeTextEntries(paragraph) {
    const wordNodes = paragraph.querySelectorAll('.kix-wordhtmlgenerator-word-node')
    const textEntries = []
    let fullText = ''

    for (const wn of wordNodes) {
      const walker = document.createTreeWalker(wn, NodeFilter.SHOW_TEXT, null)
      let tn
      while ((tn = walker.nextNode())) {
        textEntries.push({ node: tn, rawOffset: fullText.length })
        fullText += tn.textContent
      }
    }

    return { textEntries, fullText }
  }

  /**
   * Search for text within collected text entries using exact + normalized matching.
   */
  function searchInTextEntries(textEntries, fullText, searchText) {
    if (!fullText || !searchText) return null

    // 1. Exact match
    let idx = fullText.indexOf(searchText)
    if (idx !== -1) {
      return buildRangeFromOffset(textEntries, idx, searchText.length)
    }

    // 2. Normalized match (chars + whitespace)
    const { normStr: normFull, normToRaw: fullMap } = buildNormMap(fullText)
    const normSearch = normalize(searchText)
    if (!normSearch) return null

    idx = normFull.indexOf(normSearch)
    if (idx !== -1 && (idx + normSearch.length - 1) < fullMap.length) {
      const rawStart = fullMap[idx]
      const rawEnd = fullMap[idx + normSearch.length - 1] + 1
      return buildRangeFromOffset(textEntries, rawStart, rawEnd - rawStart)
    }

    return null
  }

  /**
   * Find matching text ranges in the page DOM for the given items.
   * For Google Docs: searches only within .kix-wordhtmlgenerator-word-node spans
   * (matching exactly how the text was extracted).
   * Falls back to generic text search for other editors.
   */
  function findMatchingRanges(items) {
    const results = []
    const isGoogleDocs = state.complexEditor === 'google-docs'
    console.log(`[DocIntel Overlay] findMatchingRanges: isGoogleDocs=${isGoogleDocs}, complexEditor=${state.complexEditor}, items=${items.length}`)

    // For Google Docs, pre-collect all paragraphs and their word-node text
    let gdocsParagraphs = null
    if (isGoogleDocs) {
      const paras = document.querySelectorAll('.kix-paragraphrenderer')
      console.log(`[DocIntel Overlay] Found ${paras.length} .kix-paragraphrenderer elements`)
      if (paras.length) {
        gdocsParagraphs = Array.from(paras).map(para => {
          const { textEntries, fullText } = collectWordNodeTextEntries(para)
          return { para, textEntries, fullText }
        })
        // Log first paragraph text for debugging
        if (gdocsParagraphs.length > 0) {
          console.log(`[DocIntel Overlay] First para text (${gdocsParagraphs[0].textEntries.length} nodes): "${gdocsParagraphs[0].fullText.slice(0, 80)}..."`)
        }
      }
    }

    for (const item of items) {
      if (!item.spanText) continue
      let matched = null

      // Strategy 1: Google Docs word-node targeted search (paragraph by paragraph)
      if (gdocsParagraphs) {
        for (const { textEntries, fullText } of gdocsParagraphs) {
          matched = searchInTextEntries(textEntries, fullText, item.spanText)
          if (matched) break
        }

        // Strategy 1b: search across ALL word nodes combined (for cross-paragraph text)
        // Insert a space between paragraphs so the concatenated text matches
        // the API extraction (which joins paragraphs with \n, normalized to space).
        if (!matched) {
          const allEntries = []
          let allText = ''
          for (let pi = 0; pi < gdocsParagraphs.length; pi++) {
            const { textEntries, fullText } = gdocsParagraphs[pi]
            // Insert a space separator between paragraphs
            if (pi > 0 && allText.length > 0 && fullText.length > 0) {
              // Use a synthetic entry pointing to the end of the last text node
              // of the previous paragraph — this gives the space a position anchor
              const prevEntries = gdocsParagraphs[pi - 1].textEntries
              if (prevEntries.length > 0) {
                const lastEntry = prevEntries[prevEntries.length - 1]
                allEntries.push({
                  node: lastEntry.node,
                  rawOffset: allText.length,
                  synthetic: true,
                })
              }
              allText += ' '
            }
            for (const entry of textEntries) {
              allEntries.push({ node: entry.node, rawOffset: allText.length + entry.rawOffset })
            }
            allText += fullText
          }
          matched = searchInTextEntries(allEntries, allText, item.spanText)
        }
      }

      // Strategy 2: Generic fallback for non-Google-Docs editors
      if (!matched) {
        const roots = [
          document.querySelector('.notion-page-content'),
          state.complexEditorEl,
          document.body,
        ].filter(Boolean)

        for (const root of roots) {
          // Collect all text nodes generically
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
          const entries = []
          let full = ''
          let node
          while ((node = walker.nextNode())) {
            entries.push({ node, rawOffset: full.length })
            full += node.textContent
          }
          matched = searchInTextEntries(entries, full, item.spanText)
          if (matched) break
        }
      }

      if (matched) {
        results.push({ item, range: matched.range })
        console.log(`[DocIntel Overlay] ✓ MATCHED: "${item.spanText?.slice(0, 50)}…" → range(${matched.range.startContainer.nodeName}, ${matched.range.startOffset}–${matched.range.endOffset})`)
      } else {
        console.log(`[DocIntel Overlay] ✗ NOT FOUND: "${item.spanText?.slice(0, 50)}…"`)
      }
    }

    return results
  }

  /**
   * Create or get the overlay container — a fixed full-viewport div
   * with pointer-events: none so it doesn't block the editor.
   */
  function ensureOverlayContainer() {
    if (overlayContainer && overlayContainer.parentElement) return overlayContainer

    overlayContainer = document.createElement('div')
    overlayContainer.id = 'wa-complex-overlay'
    overlayContainer.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;' +
      'pointer-events:none;z-index:2147483647;'

    // For Google Docs: insert as last child of the editor container to be
    // in the same stacking context as the canvas tiles. Falls back to body.
    const isGoogleDocs = state.complexEditor === 'google-docs'
    let parent = document.body
    if (isGoogleDocs) {
      // Try several containers — pick the one that's closest to the canvas tiles
      const editorEl =
        document.querySelector('.kix-appview-editor') ||
        document.querySelector('.docs-editor-container') ||
        document.querySelector('.kix-paginateddocumentplugin')
      if (editorEl) {
        parent = editorEl
        console.log('[DocIntel Overlay] Inserting overlay container inside:', editorEl.className)
      }
    }

    parent.appendChild(overlayContainer)
    return overlayContainer
  }

  /**
   * Create a single underline div for a client rect.
   * Reused by both initial overlay and lazy offscreen materialization.
   */
  function createUnderlineDiv(entry, rect, item, range, type) {
    const underline = document.createElement('div')
    underline.className = 'wa-overlay-underline'
    underline.dataset.suggestionId = entry.id
    underline.dataset.entryType = type

    underline.style.cssText =
      `position:fixed;` +
      `top:${rect.bottom - 2}px;` +
      `left:${rect.left}px;` +
      `width:${rect.width}px;` +
      `height:${entry.isWavy ? 4 : 3}px;` +
      `pointer-events:auto;cursor:pointer;` +
      `z-index:2147483647;`

    if (entry.isWavy) {
      underline.style.background =
        `repeating-linear-gradient(90deg, ${entry.color} 0px, ${entry.color} 2px, transparent 2px, transparent 4px)`
      underline.style.backgroundSize = '4px 2px'
      underline.style.backgroundPosition = 'bottom'
      underline.style.backgroundRepeat = 'repeat-x'
    } else {
      underline.style.backgroundColor = entry.color
      underline.style.borderRadius = '1px'
    }

    underline.addEventListener('mouseenter', () => {
      onUnderlineHover(item, range, type)
    })
    underline.addEventListener('mouseleave', () => {
      onUnderlineLeave()
    })

    return underline
  }

  /**
   * Apply Grammarly-style overlay underlines for complex editors.
   * Returns { applied, skipped, matchedIds }.
   */
  function applyComplexEditorOverlay(items, type) {
    clearComplexOverlay()
    if (!items || !items.length) return { applied: 0, skipped: 0, matchedIds: [] }

    ensureOverlayContainer()

    const matches = findMatchingRanges(items)
    console.log(`[DocIntel Overlay] findMatchingRanges: ${matches.length}/${items.length} matched`)
    let applied = 0
    let skipped = items.length - matches.length
    const matchedIds = []
    let totalElements = 0
    let offscreenCount = 0

    for (const { item, range } of matches) {
      const colorKey = type === 'suggestions'
        ? (item.suggestionType || 'custom')
        : (item.severity || 'info')
      const color = UNDERLINE_COLORS[colorKey] || '#a855f7'
      const isWavy = type === 'findings'

      const entry = {
        id: item.id,
        type,
        colorKey,
        color,
        isWavy,
        range,
        elements: [],
        item,        // store item ref for revalidation/offscreen
        offscreen: false,
      }

      // Get all client rects for this range (may span multiple lines)
      let clientRects
      try {
        clientRects = range.getClientRects()
      } catch (e) {
        console.warn(`[DocIntel Overlay] getClientRects() failed for "${item.spanText?.slice(0, 40)}...":`, e)
        skipped++
        continue
      }

      if (!clientRects.length) {
        // Text is offscreen — store entry but don't create underlines yet.
        // They'll be materialized when the user scrolls to them.
        console.log(`[DocIntel Overlay] "${item.spanText?.slice(0, 40)}…" — 0 rects (offscreen)`)
        entry.offscreen = true
        overlayEntries.push(entry)
        matchedIds.push(item.id)
        applied++
        offscreenCount++
        continue
      }

      // Create an underline div for each client rect (each line of text)
      let elemCount = 0
      for (let i = 0; i < clientRects.length; i++) {
        const rect = clientRects[i]
        if (rect.width < 2 || rect.height < 2) continue // skip collapsed

        const underline = createUnderlineDiv(entry, rect, item, range, type)
        overlayContainer.appendChild(underline)
        entry.elements.push(underline)
        elemCount++
      }
      totalElements += elemCount
      console.log(`[DocIntel Overlay] "${item.spanText?.slice(0, 40)}…" — ${clientRects.length} rects, ${elemCount} underlines, color=${color}, top=${clientRects[0]?.bottom}px left=${clientRects[0]?.left}px`)

      overlayEntries.push(entry)
      matchedIds.push(item.id)
      applied++
    }

    // Set up scroll listener to reposition underlines
    setupScrollTracking()

    // Log overlay container state for debugging
    console.log(`[DocIntel Overlay] Summary: ${applied} applied, ${skipped} skipped, ${offscreenCount} offscreen, ${totalElements} underline divs created`)
    console.log(`[DocIntel Overlay] Container: parent=${overlayContainer.parentElement?.tagName}/${overlayContainer.parentElement?.className?.slice(0, 40)}, children=${overlayContainer.childElementCount}, zIndex=${overlayContainer.style.zIndex}`)

    // Verify container is in the DOM and visible
    const containerRect = overlayContainer.getBoundingClientRect()
    console.log(`[DocIntel Overlay] Container rect: ${containerRect.width}x${containerRect.height} at (${containerRect.left},${containerRect.top})`)

    // ── CSS Fallback for Google Docs ──────────────────────────────
    // Google Docs uses canvas-based rendering. Position:fixed overlay divs
    // may be hidden behind the canvas tiles. As a fallback, apply CSS
    // underline styles directly to the Range's text node parent elements.
    // This ensures visibility even when the overlay z-index battle is lost.
    if (state.complexEditor === 'google-docs') {
      injectGDocsFallbackStyles()
      let cssMarked = 0
      for (const entry of overlayEntries) {
        if (entry.stale) continue
        try {
          cssMarked += applyRangeCSS(entry.range, entry.id, entry.color, entry.isWavy, entry.type)
        } catch (e) {
          console.warn('[DocIntel Overlay] CSS fallback failed for entry:', entry.id, e)
        }
      }
      console.log(`[DocIntel Overlay] CSS fallback: marked ${cssMarked} word-node elements`)
    }

    return { applied, skipped, matchedIds }
  }

  /**
   * Inject Google Docs fallback CSS for underlines applied directly
   * to word-node elements. Uses !important to override GDocs styles.
   */
  function injectGDocsFallbackStyles() {
    if (document.getElementById('wa-gdocs-underline-styles')) return
    const style = document.createElement('style')
    style.id = 'wa-gdocs-underline-styles'
    style.textContent = `
      .wa-gdocs-underline {
        text-decoration: underline !important;
        text-decoration-thickness: 2.5px !important;
        text-underline-offset: 2px !important;
        text-decoration-skip-ink: none !important;
      }
      .wa-gdocs-underline-wavy {
        text-decoration: wavy underline !important;
        text-decoration-thickness: 2px !important;
        text-underline-offset: 2px !important;
        text-decoration-skip-ink: none !important;
      }
      .wa-gdocs-underline:hover, .wa-gdocs-underline-wavy:hover {
        cursor: pointer !important;
        background: rgba(139, 92, 246, 0.08) !important;
      }
    `
    document.head.appendChild(style)
  }

  /**
   * Apply CSS underline classes to the text node parents within a Range.
   * For Google Docs, this targets .kix-wordhtmlgenerator-word-node spans.
   * Returns the count of elements marked.
   */
  function applyRangeCSS(range, entryId, color, isWavy, entryType) {
    if (!range || !range.startContainer) return 0

    // Collect all word-node ancestors of text nodes within the range
    const wordNodes = new Set()

    // Walk all text nodes within the range
    const walker = document.createTreeWalker(
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      null
    )

    let node
    while ((node = walker.nextNode())) {
      if (!range.intersectsNode(node)) continue
      // Walk up to find the word-node span
      let el = node.parentElement
      while (el && !el.classList?.contains('kix-wordhtmlgenerator-word-node')) {
        el = el.parentElement
        if (!el || el.classList?.contains('kix-paragraphrenderer')) break
      }
      if (el && el.classList?.contains('kix-wordhtmlgenerator-word-node')) {
        wordNodes.add(el)
      }
    }

    let count = 0
    for (const wn of wordNodes) {
      const cls = isWavy ? 'wa-gdocs-underline-wavy' : 'wa-gdocs-underline'
      wn.classList.add(cls)
      wn.style.textDecorationColor = color + ' !important'
      wn.dataset.waEntryId = entryId
      wn.dataset.waEntryType = entryType

      // Attach hover listener for the card
      if (!wn._waHoverBound) {
        wn._waHoverBound = true
        wn.addEventListener('mouseenter', () => {
          const entry = overlayEntries.find(e => e.id === entryId)
          if (entry) onUnderlineHover(entry.item, entry.range, entry.type)
        })
        wn.addEventListener('mouseleave', () => {
          onUnderlineLeave()
        })
      }
      count++
    }
    return count
  }

  /**
   * Recalculate underline positions (called on scroll/resize).
   */
  function refreshOverlayPositions() {
    for (const entry of overlayEntries) {
      if (entry.stale) continue

      let clientRects
      try {
        clientRects = entry.range.getClientRects()
      } catch (e) {
        // Range is detached — mark stale
        entry.stale = true
        for (const el of entry.elements) el.style.display = 'none'
        continue
      }

      // Materialize previously-offscreen entries when they become visible
      if (entry.offscreen && clientRects.length > 0 && overlayContainer) {
        entry.offscreen = false
        for (let i = 0; i < clientRects.length; i++) {
          const rect = clientRects[i]
          if (rect.width < 2 || rect.height < 2) continue
          const underline = createUnderlineDiv(entry, rect, entry.item, entry.range, entry.type)
          overlayContainer.appendChild(underline)
          entry.elements.push(underline)
        }
        continue // positions are already set by createUnderlineDiv
      }

      let rectIdx = 0
      for (let i = 0; i < entry.elements.length; i++) {
        // Skip collapsed rects to align with valid ones
        while (rectIdx < clientRects.length) {
          const r = clientRects[rectIdx]
          if (r.width >= 2 && r.height >= 2) break
          rectIdx++
        }

        if (rectIdx < clientRects.length) {
          const rect = clientRects[rectIdx]
          entry.elements[i].style.top = (rect.bottom - 2) + 'px'
          entry.elements[i].style.left = rect.left + 'px'
          entry.elements[i].style.width = rect.width + 'px'
          entry.elements[i].style.display = ''
          rectIdx++
        } else {
          // No more rects — hide extra elements (text scrolled out of view)
          entry.elements[i].style.display = 'none'
        }
      }
    }
  }

  function setupScrollTracking() {
    teardownScrollTracking()

    const container = findScrollContainer()
    scrollListenerEl = container

    scrollHandler = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        refreshOverlayPositions()
        rafId = null
      })
    }

    container.addEventListener('scroll', scrollHandler, { passive: true })
    window.addEventListener('scroll', scrollHandler, { passive: true })
    window.addEventListener('resize', scrollHandler, { passive: true })

    // Start MutationObserver for Google Docs DOM re-renders
    setupGDocsMutationObserver()
  }

  function teardownScrollTracking() {
    if (scrollHandler) {
      if (scrollListenerEl) {
        scrollListenerEl.removeEventListener('scroll', scrollHandler)
      }
      window.removeEventListener('scroll', scrollHandler)
      window.removeEventListener('resize', scrollHandler)
      scrollHandler = null
      scrollListenerEl = null
    }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null }
    teardownMutationObserver()
  }

  // ─── MutationObserver for Google Docs DOM changes ───────────────

  let gdocsMutationObserver = null
  let mutationDebounceTimer = null

  function setupGDocsMutationObserver() {
    teardownMutationObserver()
    if (state.complexEditor !== 'google-docs') return

    const editor = document.querySelector('.kix-appview-editor')
                || document.querySelector('[role="document"]')
    if (!editor) return

    gdocsMutationObserver = new MutationObserver((mutations) => {
      // Check if any mutation affects paragraph content
      let paragraphChanged = false
      for (const m of mutations) {
        if (m.target.closest && m.target.closest('.kix-paragraphrenderer')) {
          paragraphChanged = true
          break
        }
        for (const node of [...m.addedNodes, ...m.removedNodes]) {
          if (node.nodeType === 1 && (
            node.classList?.contains('kix-paragraphrenderer') ||
            node.querySelector?.('.kix-paragraphrenderer')
          )) {
            paragraphChanged = true
            break
          }
        }
        if (paragraphChanged) break
      }

      if (paragraphChanged) {
        clearTimeout(mutationDebounceTimer)
        mutationDebounceTimer = setTimeout(() => {
          revalidateOverlayEntries()
        }, 500)
      }
    })

    gdocsMutationObserver.observe(editor, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }

  function teardownMutationObserver() {
    if (gdocsMutationObserver) {
      gdocsMutationObserver.disconnect()
      gdocsMutationObserver = null
    }
    clearTimeout(mutationDebounceTimer)
    mutationDebounceTimer = null
  }

  /**
   * Re-check overlay entries after DOM mutation. If a Range is detached
   * or its text no longer matches, try to re-match in the current DOM.
   */
  function revalidateOverlayEntries() {
    let anyChanged = false

    for (const entry of overlayEntries) {
      if (entry.stale) continue
      if (!entry.item) continue

      let rangeValid = false
      try {
        const rects = entry.range.getClientRects()
        const rangeText = entry.range.toString()
        const normRangeText = normalize(rangeText)
        const normSpanText = normalize(entry.item.spanText)
        rangeValid = rects.length > 0 && normRangeText === normSpanText
      } catch (e) {
        // Range is detached
      }

      if (rangeValid) continue

      // Range is invalid — try to re-match
      const newMatches = findMatchingRanges([entry.item])
      if (newMatches.length > 0) {
        // Remove old underline elements
        for (const el of entry.elements) el.remove()
        entry.elements = []
        // Update range and mark for materialization
        entry.range = newMatches[0].range
        entry.offscreen = true  // will be materialized on next refresh
        anyChanged = true
      } else {
        // Text no longer exists — mark stale
        entry.stale = true
        for (const el of entry.elements) el.remove()
        entry.elements = []
        anyChanged = true
      }
    }

    if (anyChanged) {
      refreshOverlayPositions()
    }
  }

  /**
   * Hover handlers — show/hide the suggestion card.
   */
  function onUnderlineHover(item, range, type) {
    const card = window.__waDocIntelCard
    if (!card) return

    // Get card anchor position — try the Range first, fall back to underline element
    let anchorRect
    try {
      const rects = range.getClientRects()
      anchorRect = rects[0] || range.getBoundingClientRect()
      // Verify we got a usable rect
      if (!anchorRect || (anchorRect.width === 0 && anchorRect.height === 0)) {
        anchorRect = null
      }
    } catch (e) {
      anchorRect = null
    }

    // Fallback: use the underline element's position
    if (!anchorRect) {
      const entry = overlayEntries.find(e => e.id === item.id)
      if (entry && entry.elements.length > 0) {
        anchorRect = entry.elements[0].getBoundingClientRect()
      }
    }

    if (!anchorRect) return

    const suggestion = type === 'suggestions' ? item : null
    const finding = type === 'findings' ? item : null

    card.showCard(suggestion, finding, anchorRect)
  }

  function onUnderlineLeave() {
    // Let the card's own mouseenter/mouseleave handle staying open
    const card = window.__waDocIntelCard
    if (card && card.scheduleHide) {
      card.scheduleHide()
    }
  }

  /**
   * Remove a single overlay entry by ID (for dismiss).
   */
  function removeOverlayEntry(id) {
    const idx = overlayEntries.findIndex(e => e.id === id)
    if (idx === -1) return
    const entry = overlayEntries[idx]
    for (const el of entry.elements) el.remove()
    overlayEntries.splice(idx, 1)
  }

  /**
   * Clear all complex editor overlay underlines.
   */
  function clearComplexOverlay() {
    teardownScrollTracking()
    teardownCanvasScrollTracking()
    canvasPageInfo = null
    canvasLayout = null
    canvasMetrics = null
    for (const entry of overlayEntries) {
      for (const el of entry.elements) el.remove()
    }
    overlayEntries = []
    if (overlayContainer) {
      overlayContainer.remove()
      overlayContainer = null
    }

    // Clean up CSS fallback marks from Google Docs word nodes
    const cssMarked = document.querySelectorAll('.wa-gdocs-underline, .wa-gdocs-underline-wavy')
    for (const el of cssMarked) {
      el.classList.remove('wa-gdocs-underline', 'wa-gdocs-underline-wavy')
      el.style.removeProperty('text-decoration-color')
      delete el.dataset.waEntryId
      delete el.dataset.waEntryType
    }
  }

  // ─── Clear All Marks ──────────────────────────────────────────────

  function clearAllMarks() {
    if (domObserver) { domObserver.disconnect(); domObserver = null }

    // Clean contentEditable marks
    const marks = document.querySelectorAll('.wa-doc-suggestion, .wa-doc-finding')
    marks.forEach(span => {
      const text = document.createTextNode(span.textContent)
      span.parentNode.replaceChild(text, span)
    })

    // Clean mirror overlay
    if (state.mirrorOverlay) {
      state.mirrorOverlay.remove()
      state.mirrorOverlay = null
    }

    // Clean complex editor overlay
    clearComplexOverlay()

    state.suggestions = []
    state.findings = []
    state.summary = ''
    state.editorFightsDOM = false
    // Note: don't reset complexEditor/complexEditorEl here — those are persistent per page
  }

  // ─── Form Submission Cleanup ──────────────────────────────────────

  document.addEventListener('submit', (e) => {
    const form = e.target
    if (!form || form.nodeType !== 1) return
    const editables = form.querySelectorAll('[contenteditable="true"]')
    editables.forEach(el => {
      const spans = el.querySelectorAll('.wa-doc-suggestion, .wa-doc-finding')
      spans.forEach(span => {
        const text = document.createTextNode(span.textContent)
        span.parentNode.replaceChild(text, span)
      })
    })
  }, true)

  // ─── Canvas Mode Overlay (Google Docs) ──────────────────────────
  //
  // In canvas-mode Google Docs, ALL text is rendered on <canvas> elements
  // with ZERO DOM text nodes. Range-based underlines are impossible.
  // Instead, we estimate text positions using typography math and the
  // known page layout, then create positioned overlay underlines.

  // Google Docs page layout constants at 100% zoom (US Letter)
  const GDOCS_PAGE_W = 816
  const GDOCS_PAGE_H = 1056
  const GDOCS_MARGIN_T = 96   // 1 inch top
  const GDOCS_MARGIN_B = 96   // 1 inch bottom
  const GDOCS_MARGIN_L = 96   // 1 inch left
  const GDOCS_MARGIN_R = 96   // 1 inch right
  const GDOCS_CONTENT_W = GDOCS_PAGE_W - GDOCS_MARGIN_L - GDOCS_MARGIN_R  // 624
  const GDOCS_CONTENT_H = GDOCS_PAGE_H - GDOCS_MARGIN_T - GDOCS_MARGIN_B // 864
  const GDOCS_FONT_PX = 14.67 // 11pt default
  const GDOCS_LINE_H_MULT = 1.15

  /**
   * Check if an element looks like a Google Docs page (aspect ratio test).
   * US Letter: 816×1056 → ratio 1.294, A4: 595×842 → ratio 1.415
   */
  function _isPageLikeElement(el, minWidth) {
    const r = el.getBoundingClientRect()
    if (r.width < (minWidth || 300) || r.height < (minWidth || 300)) return false
    const ratio = r.height / r.width
    if (ratio < 1.15 || ratio > 1.55) return false
    const zoom = r.width / GDOCS_PAGE_W
    return zoom > 0.3 && zoom < 4
  }

  /**
   * Find Google Docs page elements and detect zoom level.
   * Returns { pages: Element[], zoom: number, source: string, pageless?: bool }
   */
  function findGDocsCanvasPages() {
    // Strategy 1: .kix-page elements (classic Google Docs)
    let pages = document.querySelectorAll('.kix-page')
    if (pages.length > 0) {
      const zoom = pages[0].getBoundingClientRect().width / GDOCS_PAGE_W
      if (zoom > 0.3 && zoom < 4) {
        return { pages: Array.from(pages), zoom, source: 'kix-page' }
      }
    }

    // Strategy 2: .kix-page-paginated elements
    pages = document.querySelectorAll('.kix-page-paginated')
    if (pages.length > 0) {
      const zoom = pages[0].getBoundingClientRect().width / GDOCS_PAGE_W
      if (zoom > 0.3 && zoom < 4) {
        return { pages: Array.from(pages), zoom, source: 'kix-page-paginated' }
      }
    }

    // Strategy 3: Scan ALL descendants of the editor for page-sized elements
    // This catches new DOM structures where page class names have changed
    const editorArea = document.querySelector('.kix-appview-editor') ||
                       document.querySelector('.docs-editor-container') ||
                       document.querySelector('[role="document"]')

    if (editorArea) {
      const allDivs = editorArea.querySelectorAll('div')
      const candidates = []
      const seenRects = new Set()

      for (const div of allDivs) {
        if (!_isPageLikeElement(div, 300)) continue

        const r = div.getBoundingClientRect()
        // De-duplicate overlapping elements (parent/child with same rect)
        const rectKey = Math.round(r.top) + ',' + Math.round(r.left) + ',' + Math.round(r.width)
        if (seenRects.has(rectKey)) continue
        seenRects.add(rectKey)

        const zoom = r.width / GDOCS_PAGE_W
        const ratio = r.height / r.width
        candidates.push({ el: div, rect: r, zoom, ratio })
      }

      if (candidates.length > 0) {
        // Sort by closest aspect ratio to US Letter (1.294)
        candidates.sort((a, b) => Math.abs(a.ratio - 1.294) - Math.abs(b.ratio - 1.294))
        const bestWidth = candidates[0].rect.width

        // Group all elements with the same width (= same zoom level = multiple pages)
        const matchingPages = candidates.filter(p => Math.abs(p.rect.width - bestWidth) < 5)
        // Sort by vertical position (top to bottom)
        matchingPages.sort((a, b) => a.rect.top - b.rect.top)

        console.log(`[DocIntel Canvas] page-scan: found ${matchingPages.length} pages, ${bestWidth.toFixed(0)}px wide, zoom=${matchingPages[0].zoom.toFixed(3)}`)
        return {
          pages: matchingPages.map(p => p.el),
          zoom: matchingPages[0].zoom,
          source: 'page-scan'
        }
      }
    }

    // Strategy 4: Canvas elements with page-like aspect ratio
    const canvases = document.querySelectorAll('canvas')
    if (canvases.length > 0) {
      const pageCanvases = Array.from(canvases).filter(c => _isPageLikeElement(c, 100))
      if (pageCanvases.length > 0) {
        const zoom = pageCanvases[0].getBoundingClientRect().width / GDOCS_PAGE_W
        return { pages: pageCanvases, zoom: zoom || 1, source: 'canvas' }
      }
    }

    // Strategy 5: Walk UP from canvas-anchor elements to find page-sized ancestors
    const anchors = document.querySelectorAll('.canvas-anchor')
    if (anchors.length > 0) {
      const seenElements = new Set()
      const pageElements = []

      for (const anchor of anchors) {
        let el = anchor
        for (let depth = 0; depth < 10 && el; depth++) {
          el = el.parentElement
          if (!el) break

          if (_isPageLikeElement(el, 300)) {
            const r = el.getBoundingClientRect()
            const key = Math.round(r.top) + ':' + Math.round(r.left) + ':' + Math.round(r.width)
            if (!seenElements.has(key)) {
              seenElements.add(key)
              pageElements.push(el)
            }
            break // Found the page ancestor for this anchor
          }
        }
      }

      if (pageElements.length > 0) {
        pageElements.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        const zoom = pageElements[0].getBoundingClientRect().width / GDOCS_PAGE_W
        console.log(`[DocIntel Canvas] canvas-anchor-walk: found ${pageElements.length} pages, zoom=${zoom.toFixed(3)}`)
        return { pages: pageElements, zoom, source: 'canvas-anchor-walk' }
      }

      // No page-sized ancestor found — this might be pageless mode.
      // Use the anchors but with zoom=1 (default, not parent width).
      console.log('[DocIntel Canvas] canvas-anchors found but no page-sized ancestor; assuming pageless mode')
    }

    // Strategy 6: Pageless mode / single-page fallback
    // Google Docs pageless mode has no page boundaries, just a content area
    if (editorArea) {
      // In pageless mode, find the content column (narrower than the editor)
      const innerDivs = editorArea.querySelectorAll('div')
      let contentEl = null
      let bestFit = Infinity

      for (const div of innerDivs) {
        const r = div.getBoundingClientRect()
        // Look for a div that's reasonably wide (like a page width) and tall
        if (r.width < 400 || r.width > 1200 || r.height < 200) continue
        // Prefer elements closest to 816px wide (standard page width)
        const dist = Math.abs(r.width - GDOCS_PAGE_W)
        if (dist < bestFit) {
          bestFit = dist
          contentEl = div
        }
      }

      if (contentEl && bestFit < 300) {
        const zoom = contentEl.getBoundingClientRect().width / GDOCS_PAGE_W
        console.log(`[DocIntel Canvas] pageless: using content div ${contentEl.getBoundingClientRect().width.toFixed(0)}px wide, zoom=${zoom.toFixed(3)}`)
        return { pages: [contentEl], zoom, source: 'pageless', pageless: true }
      }

      // Last resort: editor container itself
      console.log('[DocIntel Canvas] Using editor fallback')
      return { pages: [editorArea], zoom: 1, source: 'editor-fallback', pageless: true }
    }

    return { pages: [], zoom: 1, source: 'none' }
  }

  /**
   * Try to detect the actual font used by Google Docs from CSS stylesheets.
   * Returns { family, sizePx, lineHeightMult } or null.
   */
  function _detectGDocsFont() {
    try {
      // Look for Google Docs' font style in the page
      // GDocs typically uses a <style> block or inline styles for the default font
      const testSelectors = [
        '.kix-paragraphrenderer', '.kix-lineview',
        '[data-font-family]', '.docs-editor-container'
      ]
      for (const sel of testSelectors) {
        const el = document.querySelector(sel)
        if (!el) continue
        const cs = window.getComputedStyle(el)
        if (cs.fontFamily && cs.fontSize) {
          const sizePx = parseFloat(cs.fontSize)
          if (sizePx > 5 && sizePx < 80) {
            return {
              family: cs.fontFamily,
              sizePx,
              lineHeightMult: cs.lineHeight !== 'normal'
                ? parseFloat(cs.lineHeight) / sizePx
                : GDOCS_LINE_H_MULT
            }
          }
        }
      }
    } catch (e) { /* ignore */ }
    return null
  }

  /**
   * Measure font metrics for Google Docs default font using canvas 2D API.
   * Attempts to detect the actual font; falls back to Arial 11pt.
   * Returns { fontSize, ctx, lineHeight, zoom }
   */
  function measureGDocsFont(zoom) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    // Try to detect the actual font
    const detected = _detectGDocsFont()
    let fontSize, fontFamily, lineHeightMult

    if (detected) {
      // Use detected font at the zoom-adjusted size
      fontSize = detected.sizePx * zoom
      fontFamily = detected.family
      lineHeightMult = detected.lineHeightMult
      console.log(`[DocIntel Canvas] Detected font: ${fontFamily.split(',')[0]} @ ${detected.sizePx}px, lineHeight=${lineHeightMult.toFixed(2)}x`)
    } else {
      // Default Google Docs font
      fontSize = GDOCS_FONT_PX * zoom
      fontFamily = 'Arial, sans-serif'
      lineHeightMult = GDOCS_LINE_H_MULT
      console.log(`[DocIntel Canvas] Using default font: Arial @ ${GDOCS_FONT_PX}px`)
    }

    ctx.font = `${fontSize}px ${fontFamily}`
    const lineHeight = fontSize * lineHeightMult

    return { fontSize, ctx, lineHeight, zoom, fontFamily }
  }

  /**
   * Detect the actual content area margins by inspecting the page element.
   * Returns { marginT, marginL, contentW, contentH }
   */
  function _detectPageMargins(pageEl, zoom) {
    const defaultMargins = {
      marginT: GDOCS_MARGIN_T * zoom,
      marginL: GDOCS_MARGIN_L * zoom,
      contentW: GDOCS_CONTENT_W * zoom,
      contentH: GDOCS_CONTENT_H * zoom,
    }

    try {
      const pageRect = pageEl.getBoundingClientRect()

      // Try to find the inner content area within the page
      // Google Docs sometimes has a content wrapper inside the page element
      const innerDivs = pageEl.querySelectorAll('div')
      for (const div of innerDivs) {
        const r = div.getBoundingClientRect()
        // The content area should be narrower than the page and inside it
        if (r.width < pageRect.width * 0.5 || r.width > pageRect.width * 0.95) continue
        if (r.height < pageRect.height * 0.5) continue
        if (r.left < pageRect.left || r.top < pageRect.top) continue

        // This looks like a content wrapper
        const mT = r.top - pageRect.top
        const mL = r.left - pageRect.left
        const cW = r.width
        const cH = r.height

        // Sanity check: margins should be reasonable (10-200px at zoom=1)
        if (mT / zoom > 10 && mT / zoom < 200 && mL / zoom > 10 && mL / zoom < 200) {
          console.log(`[DocIntel Canvas] Detected margins: T=${(mT/zoom).toFixed(0)}px L=${(mL/zoom).toFixed(0)}px, content=${(cW/zoom).toFixed(0)}×${(cH/zoom).toFixed(0)}px`)
          return { marginT: mT, marginL: mL, contentW: cW, contentH: cH }
        }
      }

      // Try reading CSS padding from the page element
      const cs = window.getComputedStyle(pageEl)
      const pT = parseFloat(cs.paddingTop) || 0
      const pL = parseFloat(cs.paddingLeft) || 0
      if (pT > 10 && pL > 10) {
        console.log(`[DocIntel Canvas] Detected padding: T=${pT.toFixed(0)}px L=${pL.toFixed(0)}px`)
        return {
          marginT: pT,
          marginL: pL,
          contentW: pageRect.width - pL - (parseFloat(cs.paddingRight) || pL),
          contentH: pageRect.height - pT - (parseFloat(cs.paddingBottom) || pT),
        }
      }
    } catch (e) { /* ignore */ }

    return defaultMargins
  }

  /**
   * Build a text layout model that maps character offsets to visual positions.
   * Works on the raw (un-normalized) document text.
   *
   * Uses proportional character widths within tokens to account for kerning,
   * and detects actual margins from page elements when possible.
   *
   * Returns { charMap, margins, getRectsForRange(rawStart, rawEnd) }
   */
  function buildCanvasTextLayout(rawDocText, metrics, pageInfo) {
    // Detect actual margins from the page element
    const margins = _detectPageMargins(
      pageInfo.pages[0],
      pageInfo.zoom
    )
    const contentW = margins.contentW
    const marginT  = margins.marginT
    const marginL  = margins.marginL
    const contentH = margins.contentH
    const linesPerPage = pageInfo.pageless
      ? 99999 // No page breaks in pageless mode
      : Math.floor(contentH / metrics.lineHeight)

    // We build a charMap for the raw text. Each position stores:
    // { page, lineInPage, x, cw (character width) }
    const charMap = new Array(rawDocText.length)
    let globalLine = 0
    let x = 0
    let rawIdx = 0

    const paragraphs = rawDocText.split('\n')

    for (let pi = 0; pi < paragraphs.length; pi++) {
      const para = paragraphs[pi]

      if (para.length === 0) {
        // Empty paragraph — record the newline character
        if (rawIdx < charMap.length) {
          charMap[rawIdx] = { page: Math.floor(globalLine / linesPerPage), lineInPage: globalLine % linesPerPage, x: 0, cw: 0 }
        }
        rawIdx++ // the \n
        globalLine++
        x = 0
        continue
      }

      // Tokenize into words and whitespace
      const tokens = para.match(/\S+|\s+/g) || [para]

      for (const token of tokens) {
        // Measure the WHOLE token width (accounts for kerning)
        const tokenW = metrics.ctx.measureText(token).width

        // Word wrap: if token doesn't fit and we're not at line start
        if (x > 0 && x + tokenW > contentW && !/^\s+$/.test(token)) {
          globalLine++
          x = 0
        }

        // Measure individual characters, then distribute proportionally
        // to match the whole-token width (accounts for kerning/ligatures)
        const rawCharWidths = []
        let rawTotalW = 0
        for (let i = 0; i < token.length; i++) {
          const cw = metrics.ctx.measureText(token[i]).width
          rawCharWidths.push(cw)
          rawTotalW += cw
        }
        // Scale factor: tokenW / sum(charWidths) to distribute kerning
        const scale = rawTotalW > 0 ? tokenW / rawTotalW : 1

        // Record position of each character with proportional widths
        for (let i = 0; i < token.length; i++) {
          const cw = rawCharWidths[i] * scale
          if (rawIdx + i < charMap.length) {
            charMap[rawIdx + i] = {
              page: Math.floor(globalLine / linesPerPage),
              lineInPage: globalLine % linesPerPage,
              x: x,
              cw: cw,
            }
          }
          x += cw
        }
        rawIdx += token.length
      }

      // Account for \n between paragraphs
      if (pi < paragraphs.length - 1) {
        if (rawIdx < charMap.length) {
          charMap[rawIdx] = { page: Math.floor(globalLine / linesPerPage), lineInPage: globalLine % linesPerPage, x: x, cw: 0 }
        }
        rawIdx++
        globalLine++
        x = 0
      }
    }

    console.log(`[DocIntel Canvas] Layout built: ${rawDocText.length} chars, ${globalLine + 1} lines, ${linesPerPage} lines/page, contentW=${contentW.toFixed(0)}px`)

    return {
      charMap,
      margins,
      linesPerPage,
      /**
       * Get visual rectangles for a character range (using RAW indices).
       * Groups consecutive characters on the same line into single rectangles.
       */
      getRectsForRange(rawStart, rawEnd) {
        // Group by line
        const lineGroups = new Map() // "page:line" → { page, line, minX, maxX }

        for (let i = rawStart; i < rawEnd && i < charMap.length; i++) {
          const pos = charMap[i]
          if (!pos) continue

          const key = pos.page + ':' + pos.lineInPage
          if (!lineGroups.has(key)) {
            lineGroups.set(key, { page: pos.page, line: pos.lineInPage, minX: pos.x, maxX: pos.x })
          }
          const g = lineGroups.get(key)
          g.minX = Math.min(g.minX, pos.x)
          // Use the stored character width for the right edge
          g.maxX = Math.max(g.maxX, pos.x + pos.cw)
        }

        // Convert to screen coordinates using page element positions
        const rects = []
        for (const [, g] of lineGroups) {
          const pageEl = pageInfo.pages[g.page]
          if (!pageEl) continue

          const pageRect = pageEl.getBoundingClientRect()
          const top = pageRect.top + marginT + (g.line * metrics.lineHeight)
          const left = pageRect.left + marginL + g.minX
          const width = g.maxX - g.minX

          // Clamp width to content area (safety: underline never wider than content)
          const clampedWidth = Math.min(width, contentW - g.minX)
          const height = metrics.lineHeight

          // Only include rects that are within the viewport (skip offscreen)
          if (top + height < -100 || top > window.innerHeight + 100) continue

          rects.push({
            top,
            left,
            width: Math.max(clampedWidth, 4), // minimum 4px wide
            height,
            page: g.page,
            lineInPage: g.line,
            relTop: marginT + (g.line * metrics.lineHeight),
            relLeft: marginL + g.minX,
          })
        }

        return rects
      }
    }
  }

  /**
   * Build a normalized-to-raw index map for the document text.
   * Returns { normText, normToRaw[] } where normToRaw[i] gives the raw index.
   */
  function buildNormToRawMap(rawText) {
    const normChars = []
    const normToRaw = []
    let inSpace = false

    for (let i = 0; i < rawText.length; i++) {
      let ch = rawText[i]

      // Skip zero-width chars
      if ('\u200B\u200C\u200D\uFEFF'.includes(ch)) continue

      // Normalize Unicode chars
      if ('\u2018\u2019\u201A\u0060\u00B4'.includes(ch)) ch = "'"
      else if ('\u201C\u201D\u201E\u00AB\u00BB'.includes(ch)) ch = '"'
      else if ('\u2013\u2014\u2015'.includes(ch)) ch = '-'
      else if (ch === '\u2026') { normChars.push('.', '.', '.'); normToRaw.push(i, i, i); inSpace = false; continue }
      else if (ch === '\u00A0') ch = ' '

      // Collapse whitespace
      if (/\s/.test(ch)) {
        if (!inSpace && normChars.length > 0) {
          normChars.push(' ')
          normToRaw.push(i)
          inSpace = true
        }
      } else {
        normChars.push(ch)
        normToRaw.push(i)
        inSpace = false
      }
    }

    return { normText: normChars.join(''), normToRaw }
  }

  /**
   * Apply Grammarly-style overlay underlines for canvas-mode Google Docs.
   * Estimates text positions using typography math.
   * Returns { applied, skipped, matchedIds }.
   */
  function applyCanvasModeOverlay(items, type) {
    clearComplexOverlay()
    if (!items || !items.length) return { applied: 0, skipped: 0, matchedIds: [] }

    // Get the document text
    const rawDocText = state._cachedGDocsText || ''
    if (!rawDocText || rawDocText.trim().length < 20) {
      console.warn('[DocIntel Canvas] No document text available for canvas overlay')
      return { applied: 0, skipped: 0, matchedIds: [] }
    }

    // Find page elements
    const pageInfo = findGDocsCanvasPages()
    if (!pageInfo.pages.length) {
      console.warn('[DocIntel Canvas] No page elements found')
      return { applied: 0, skipped: 0, matchedIds: [] }
    }
    console.log(`[DocIntel Canvas] Found ${pageInfo.pages.length} pages via ${pageInfo.source}, zoom=${pageInfo.zoom.toFixed(2)}`)

    // Measure font
    const metrics = measureGDocsFont(pageInfo.zoom)
    console.log(`[DocIntel Canvas] Font: ${metrics.fontSize.toFixed(1)}px, lineHeight: ${metrics.lineHeight.toFixed(1)}px, family: ${(metrics.fontFamily || 'Arial').split(',')[0]}`)

    // Build text layout
    const layout = buildCanvasTextLayout(rawDocText, metrics, pageInfo)

    // Store for scroll refresh
    canvasPageInfo = pageInfo
    canvasLayout = layout
    canvasMetrics = metrics

    // Build norm-to-raw map for matching
    const { normText, normToRaw } = buildNormToRawMap(rawDocText)

    ensureOverlayContainer()

    let applied = 0
    let skipped = 0
    const matchedIds = []

    for (const item of items) {
      if (!item.spanText) { skipped++; continue }

      // Normalize the search text
      const normSearch = normalize(item.spanText)
      if (!normSearch) { skipped++; continue }

      // Find in normalized document text
      const normIdx = normText.indexOf(normSearch)
      if (normIdx === -1) {
        // Try case-insensitive
        const lowerIdx = normText.toLowerCase().indexOf(normSearch.toLowerCase())
        if (lowerIdx === -1) {
          console.log(`[DocIntel Canvas] ✗ NOT FOUND: "${item.spanText.slice(0, 50)}…"`)
          skipped++
          continue
        }
        // Use case-insensitive match
        var rawStart = normToRaw[lowerIdx]
        var rawEnd = normToRaw[Math.min(lowerIdx + normSearch.length - 1, normToRaw.length - 1)] + 1
      } else {
        var rawStart = normToRaw[normIdx]
        var rawEnd = normToRaw[Math.min(normIdx + normSearch.length - 1, normToRaw.length - 1)] + 1
      }

      if (rawStart === undefined || rawEnd === undefined) { skipped++; continue }

      // Get visual rectangles
      const rects = layout.getRectsForRange(rawStart, rawEnd)
      if (!rects.length) {
        console.log(`[DocIntel Canvas] "${item.spanText.slice(0, 40)}…" — 0 rects (offscreen or layout error)`)
        skipped++
        continue
      }

      // Determine color
      const colorKey = type === 'suggestions'
        ? (item.suggestionType || 'custom')
        : (item.severity || 'info')
      const color = UNDERLINE_COLORS[colorKey] || '#a855f7'
      const isWavy = type === 'findings'

      const entry = {
        id: item.id,
        type,
        colorKey,
        color,
        isWavy,
        range: null, // No DOM Range in canvas mode
        elements: [],
        item,
        offscreen: false,
        canvasMode: true,
        rawStart,
        rawEnd,
        storedRects: rects, // For scroll repositioning
      }

      // Create Grammarly-style underline divs
      for (const rect of rects) {
        const underline = document.createElement('div')
        underline.className = 'wa-overlay-underline wa-canvas-underline'
        underline.dataset.suggestionId = item.id
        underline.dataset.entryType = type

        // Position the underline at the BOTTOM of the line box (always below text).
        // offset = lineHeight - small gap. This is the most robust approach since
        // it doesn't depend on exact font metrics matching Google's rendering.
        const underlineTop = rect.top + rect.height - 2

        underline.style.cssText =
          'position:fixed;' +
          'top:' + underlineTop + 'px;' +
          'left:' + rect.left + 'px;' +
          'width:' + rect.width + 'px;' +
          'height:2px;' +
          'pointer-events:auto;cursor:pointer;' +
          'z-index:2147483647;' +
          'transition:opacity 0.15s;' +
          'opacity:0.85;'

        if (isWavy) {
          // Wavy underline for findings — dotted pattern
          underline.style.background = 'none'
          underline.style.borderBottom = '2px dotted ' + color
          underline.style.height = '0px'
        } else {
          underline.style.backgroundColor = color
          underline.style.borderRadius = '1px'
        }

        // Store relative position for scroll updates
        underline._canvasRect = rect

        // Hover events for card display
        underline.addEventListener('mouseenter', () => {
          underline.style.opacity = '1'
          underline.style.height = isWavy ? '0px' : '3px'
          const cardRect = underline.getBoundingClientRect()
          onCanvasUnderlineHover(item, cardRect, type)
        })

        underline.addEventListener('mouseleave', () => {
          underline.style.opacity = '0.85'
          underline.style.height = isWavy ? '0px' : '2px'
          onUnderlineLeave()
        })

        overlayContainer.appendChild(underline)
        entry.elements.push(underline)
      }

      overlayEntries.push(entry)
      matchedIds.push(item.id)
      applied++

      const debugRects = rects.map(r => `${r.width.toFixed(0)}×${r.height.toFixed(0)}@(${r.left.toFixed(0)},${r.top.toFixed(0)})`).join(', ')
      console.log(`[DocIntel Canvas] ✓ MATCHED: "${item.spanText.slice(0, 40)}…" → ${rects.length} rects [${debugRects}], raw=${rawStart}..${rawEnd}, color=${color}`)
    }

    // Set up scroll tracking for canvas underlines
    setupCanvasScrollTracking()

    console.log(`[DocIntel Canvas] Summary: ${applied} applied, ${skipped} skipped, ${matchedIds.length} matched IDs`)
    return { applied, skipped, matchedIds }
  }

  /**
   * Hover handler for canvas overlay underlines.
   * Uses the underline element's bounding rect as the card anchor.
   */
  function onCanvasUnderlineHover(item, anchorRect, type) {
    const card = window.__waDocIntelCard
    if (!card) return

    const suggestion = type === 'suggestions' ? item : null
    const finding = type === 'findings' ? item : null

    if (!suggestion && !finding) return
    card.showCard(suggestion, finding, anchorRect)
  }

  /**
   * Refresh canvas overlay underline positions on scroll.
   * Re-reads page element positions and recalculates screen coordinates.
   */
  function refreshCanvasOverlayPositions() {
    if (!canvasPageInfo || !canvasLayout || !canvasMetrics) return

    for (const entry of overlayEntries) {
      if (!entry.canvasMode || entry.stale) continue

      // Recalculate rects from the current page positions
      const newRects = canvasLayout.getRectsForRange(entry.rawStart, entry.rawEnd)

      // Update each underline element's position
      for (let i = 0; i < entry.elements.length; i++) {
        const el = entry.elements[i]
        if (i < newRects.length) {
          const rect = newRects[i]
          el.style.top = (rect.top + rect.height - 2) + 'px'
          el.style.left = rect.left + 'px'
          el.style.width = rect.width + 'px'
          el.style.display = ''
          el._canvasRect = rect
        } else {
          el.style.display = 'none'
        }
      }

      // If we now have more rects than elements (text wrapped differently), create new ones
      if (newRects.length > entry.elements.length && overlayContainer) {
        for (let i = entry.elements.length; i < newRects.length; i++) {
          const rect = newRects[i]
          const underline = document.createElement('div')
          underline.className = 'wa-overlay-underline wa-canvas-underline'
          underline.dataset.suggestionId = entry.id
          underline.dataset.entryType = entry.type
          underline.style.cssText =
            'position:fixed;' +
            'top:' + (rect.top + rect.height - 2) + 'px;' +
            'left:' + rect.left + 'px;' +
            'width:' + rect.width + 'px;' +
            'height:2px;' +
            'pointer-events:auto;cursor:pointer;' +
            'z-index:2147483647;' +
            'transition:opacity 0.15s;' +
            'opacity:0.85;'

          if (entry.isWavy) {
            underline.style.background = 'none'
            underline.style.borderBottom = '2px dotted ' + entry.color
            underline.style.height = '0px'
          } else {
            underline.style.backgroundColor = entry.color
            underline.style.borderRadius = '1px'
          }

          underline._canvasRect = rect
          const item = entry.item
          const type = entry.type
          const isWavy = entry.isWavy

          underline.addEventListener('mouseenter', () => {
            underline.style.opacity = '1'
            underline.style.height = isWavy ? '0px' : '3px'
            onCanvasUnderlineHover(item, underline.getBoundingClientRect(), type)
          })
          underline.addEventListener('mouseleave', () => {
            underline.style.opacity = '0.85'
            underline.style.height = isWavy ? '0px' : '2px'
            onUnderlineLeave()
          })

          overlayContainer.appendChild(underline)
          entry.elements.push(underline)
        }
      }
    }
  }

  function setupCanvasScrollTracking() {
    teardownCanvasScrollTracking()

    canvasScrollHandler = () => {
      if (canvasScrollRaf) cancelAnimationFrame(canvasScrollRaf)
      canvasScrollRaf = requestAnimationFrame(() => {
        refreshCanvasOverlayPositions()
        canvasScrollRaf = null
      })
    }

    // Listen on multiple potential scroll containers
    window.addEventListener('scroll', canvasScrollHandler, { passive: true, capture: true })
    window.addEventListener('resize', canvasScrollHandler, { passive: true })

    // Also listen on the Google Docs scroll container specifically
    const scrollContainers = [
      document.querySelector('.kix-appview-editor'),
      document.querySelector('.docs-editor-container'),
    ].filter(Boolean)

    for (const c of scrollContainers) {
      c.addEventListener('scroll', canvasScrollHandler, { passive: true })
    }
  }

  function teardownCanvasScrollTracking() {
    if (canvasScrollHandler) {
      window.removeEventListener('scroll', canvasScrollHandler, true)
      window.removeEventListener('resize', canvasScrollHandler)

      const scrollContainers = [
        document.querySelector('.kix-appview-editor'),
        document.querySelector('.docs-editor-container'),
      ].filter(Boolean)
      for (const c of scrollContainers) {
        c.removeEventListener('scroll', canvasScrollHandler)
      }

      canvasScrollHandler = null
    }
    if (canvasScrollRaf) {
      cancelAnimationFrame(canvasScrollRaf)
      canvasScrollRaf = null
    }
  }

  // ─── Expose functions for other modules ───────────────────────────

  window.__waDocIntelOverlay = {
    applyContentEditableMarks,
    applyFindingMarks,
    applyTextareaMarks,
    applyComplexEditorOverlay,
    applyCanvasModeOverlay,
    removeOverlayEntry,
    clearComplexOverlay,
    acceptSuggestion,
    dismissSuggestion,
    clearAllMarks,
    findTextInElement,
    escapeHTML,
  }

  // Expose cleanup function for detector
  window.__waDocIntelClearMarks = clearAllMarks
})()
