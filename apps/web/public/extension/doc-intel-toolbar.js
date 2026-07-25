/**
 * doc-intel-toolbar.js — Floating Mode Toolbar
 *
 * Compact floating toolbar positioned near the active editable field.
 * Contains mode chips (Grammar, Clarity, Concise, Tone, Structure + Analysis modes),
 * custom instruction input, Run button, and status indicators.
 *
 * Fetches suggestions from the API and delegates mark application to doc-intel-overlay.js.
 */

;(function () {
  'use strict'

  const state = window.__waDocIntel
  let toolbarEl = null
  let selectedMode = null
  let customInstruction = ''
  let resultsPanelEl = null

  // Simple hash for stale text detection (djb2 algorithm)
  function simpleHash(str) {
    let hash = 5381
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i)
      hash |= 0 // Convert to 32bit integer
    }
    return hash
  }

  // ─── Mode Definitions ─────────────────────────────────────────────

  const EDIT_MODES = [
    { id: 'edit_grammar', label: 'Grammar', chipClass: 'wa-chip-grammar' },
    { id: 'edit_clarity', label: 'Clarity', chipClass: 'wa-chip-clarity' },
    { id: 'edit_conciseness', label: 'Concise', chipClass: 'wa-chip-conciseness' },
    { id: 'edit_tone', label: 'Tone', chipClass: 'wa-chip-tone' },
    { id: 'edit_structure', label: 'Structure', chipClass: 'wa-chip-structure' },
  ]

  const ANALYZE_MODES = [
    { id: 'analyze_logic', label: 'Logic', chipClass: 'wa-chip-logic wa-chip-analyze' },
    { id: 'analyze_evidence', label: 'Evidence', chipClass: 'wa-chip-evidence wa-chip-analyze' },
    { id: 'analyze_bias', label: 'Bias', chipClass: 'wa-chip-bias wa-chip-analyze' },
  ]

  // ─── Show Toolbar ─────────────────────────────────────────────────

  function showToolbar(field) {
    hideToolbar()

    const helpers = window.__waDocIntelHelpers
    if (!helpers) return
    const shadow = helpers.ensureShadowHost()
    if (!shadow) return

    state.activeField = field
    // Don't overwrite fieldType if complex editor is already detected
    if (!state.complexEditor) {
      state.fieldType = helpers.getFieldType(field)
    }
    state.toolbarVisible = true

    const toolbar = document.createElement('div')
    toolbar.className = 'wa-toolbar'
    if (helpers.safeSetInnerHTML) {
      helpers.safeSetInnerHTML(toolbar, buildToolbarHTML())
    } else {
      toolbar.innerHTML = buildToolbarHTML()
    }

    // Position above the field (or fixed top-center for complex editors)
    const rect = field.getBoundingClientRect()
    const toolbarHeight = 72
    let top, left, maxWidth

    if (state.complexEditor || field === document.body || rect.width > window.innerWidth * 0.8) {
      // Complex editor or full-page element — position fixed near top center
      top = 60
      maxWidth = Math.min(580, window.innerWidth - 32)
      left = Math.max(8, (window.innerWidth - maxWidth) / 2)
    } else {
      top = rect.top - toolbarHeight - 8
      if (top < 8) top = rect.bottom + 8
      left = rect.left
      maxWidth = Math.min(580, rect.width, window.innerWidth - 16)
      left = Math.max(8, Math.min(left, window.innerWidth - maxWidth - 8))
    }

    toolbar.style.top = top + 'px'
    toolbar.style.left = left + 'px'
    toolbar.style.width = maxWidth + 'px'

    shadow.appendChild(toolbar)
    toolbarEl = toolbar

    bindToolbarEvents(toolbar)
  }

  function hideToolbar() {
    if (toolbarEl) {
      toolbarEl.remove()
      toolbarEl = null
    }
    if (resultsPanelEl) {
      resultsPanelEl.remove()
      resultsPanelEl = null
    }
    state.toolbarVisible = false
    selectedMode = null
    customInstruction = ''

    // Also clear marks and cards
    if (window.__waDocIntelOverlay) {
      window.__waDocIntelOverlay.clearAllMarks()
    }
    if (window.__waDocIntelCard) {
      window.__waDocIntelCard.hideCard(true)
      window.__waDocIntelCard.hideAnalysisSummary()
    }
  }

  // ─── Toolbar HTML ─────────────────────────────────────────────────

  function buildToolbarHTML() {
    let chips = ''

    for (const mode of EDIT_MODES) {
      chips += `<button class="wa-chip ${mode.chipClass}" data-mode="${mode.id}">${mode.label}</button>`
    }
    chips += '<span style="width:1px;height:16px;background:#3f3f46;margin:0 2px;"></span>'
    for (const mode of ANALYZE_MODES) {
      chips += `<button class="wa-chip ${mode.chipClass}" data-mode="${mode.id}">${mode.label}</button>`
    }

    return `
      <div class="wa-toolbar-row">
        ${chips}
        <div style="flex:1;"></div>
        <button class="wa-close-btn" data-action="close">&times;</button>
      </div>
      <div class="wa-toolbar-row">
        <input class="wa-custom-input" placeholder="Custom instruction..." data-input="custom" />
        <button class="wa-run-btn" data-action="run" disabled>Run</button>
      </div>
      <div class="wa-toolbar-row wa-status" data-status-row style="display:none;">
        <span data-status-text></span>
      </div>
    `
  }

  // ─── Toolbar Events ───────────────────────────────────────────────

  function bindToolbarEvents(toolbar) {
    toolbar.addEventListener('click', (e) => {
      const target = e.target

      // Mode chip click
      if (target.dataset.mode) {
        selectedMode = target.dataset.mode

        // Update chip visual state
        toolbar.querySelectorAll('.wa-chip').forEach(chip => {
          chip.classList.toggle('active', chip.dataset.mode === selectedMode)
        })

        // Enable Run button
        const runBtn = toolbar.querySelector('[data-action="run"]')
        if (runBtn) runBtn.disabled = false
        return
      }

      // Close button
      if (target.dataset.action === 'close' || target.closest('[data-action="close"]')) {
        hideToolbar()
        return
      }

      // Run button
      if (target.dataset.action === 'run') {
        if (!selectedMode || state.isProcessing) return
        runDocIntel()
        return
      }
    })

    // Custom instruction input
    const input = toolbar.querySelector('[data-input="custom"]')
    if (input) {
      input.addEventListener('input', (e) => {
        customInstruction = e.target.value
      })
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && selectedMode && !state.isProcessing) {
          e.preventDefault()
          runDocIntel()
        }
      })
    }
  }

  // ─── Run Doc Intelligence ─────────────────────────────────────────

  async function runDocIntel() {
    if (!selectedMode || !state.activeField || state.isProcessing) return

    const helpers = window.__waDocIntelHelpers
    const overlay = window.__waDocIntelOverlay
    const card = window.__waDocIntelCard
    if (!helpers || !overlay) return

    // Clear previous results
    overlay.clearAllMarks()
    if (card) card.hideAnalysisSummary()

    state.isProcessing = true
    updateStatus('processing', 'Analyzing...')

    const text = helpers.extractText(state.activeField)
    if (!text || !text.trim()) {
      state.isProcessing = false
      updateStatus('error', 'No text to analyze')
      return
    }

    // Truncate if too long
    const content = text.length > 50000 ? text.slice(0, 50000) : text

    // Snapshot a hash of the text before the API call
    // so we can detect if the user edited the document during analysis
    const preCallHash = simpleHash(content)

    try {
      const config = await getConfig()
      if (!config.apiUrl) {
        state.isProcessing = false
        updateStatus('error', 'API URL not configured. Check extension settings.')
        return
      }

      const isEdit = selectedMode.startsWith('edit_')
      const endpoint = isEdit ? 'suggest' : 'analyze'

      const requestHeaders = {
        'x-user-id': config.userId || '00000000-0000-0000-0000-000000000001',
        ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
      }
      const requestBody = {
        content,
        mode: selectedMode,
        customInstruction: customInstruction || undefined,
        url: window.location.href,
        fieldType: state.fieldType,
      }

      // Route through background service worker to avoid mixed-content
      // blocking on HTTPS pages (e.g. Google Docs).
      let json
      if (isExtensionContextValid()) {
        const result = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'docIntelRequest',
            apiUrl: config.apiUrl,
            endpoint,
            headers: requestHeaders,
            body: requestBody,
          }, resolve)
        })
        if (result.error) throw new Error(result.error)
        json = result.data
      } else {
        // Fallback: direct fetch (only works on HTTP pages)
        const response = await fetch(`${config.apiUrl}/api/doc-intelligence-web/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...requestHeaders },
          body: JSON.stringify(requestBody),
        })
        if (!response.ok) {
          const err = await response.json().catch(() => ({}))
          throw new Error(err?.error?.message || `HTTP ${response.status}`)
        }
        json = await response.json()
      }

      // Check if document text changed during API call
      let staleWarning = false
      if (state.complexEditor) {
        const currentText = helpers.extractText(state.activeField)
        const postCallHash = simpleHash(currentText?.length > 50000 ? currentText.slice(0, 50000) : (currentText || ''))
        if (postCallHash !== preCallHash) {
          staleWarning = true
          console.log('[DocIntel] Document text changed during analysis — some matches may fail')
        }
      }

      if (isEdit && json.data?.suggestions) {
        state.suggestions = json.data.suggestions
        const time = json.data.processingTimeMs ? `${(json.data.processingTimeMs / 1000).toFixed(1)}s` : ''

        // Complex editors: Grammarly-style overlay underlines
        if (state.complexEditor) {
          if (state.suggestions.length > 0) {
            // Canvas mode: use typography-estimated position overlay
            // DOM mode: use Range-based overlay
            let result
            if (state.isCanvasMode && overlay.applyCanvasModeOverlay) {
              result = overlay.applyCanvasModeOverlay(state.suggestions, 'suggestions')
            } else {
              result = overlay.applyComplexEditorOverlay(state.suggestions, 'suggestions')
            }

            const applied = result?.applied || 0
            const skipped = result?.skipped || 0
            const matchedIds = new Set(result?.matchedIds || [])

            let msg = `${applied} suggestion${applied > 1 ? 's' : ''}`
            if (skipped > 0) msg += ` (${skipped} not matched)`
            if (time) msg += ` \u2022 ${time}`
            if (staleWarning) msg += ' \u2022 text changed'
            updateStatus(applied > 0 ? 'count' : 'info', applied > 0 ? msg : 'No suggestions matched in document')

            // Show unmatched suggestions in results panel so users can still use them
            if (skipped > 0) {
              const unmatched = state.suggestions.filter(s => !matchedIds.has(s.id))
              if (unmatched.length > 0) {
                showResultsPanel(unmatched, 'suggestions', true)
              }
            }
          } else {
            updateStatus('info', 'No suggestions found')
          }
        } else {
          // Normal editors: apply inline marks
          let result
          if (state.fieldType === 'contenteditable') {
            result = overlay.applyContentEditableMarks(state.activeField, state.suggestions)
          } else if (state.fieldType === 'textarea') {
            result = overlay.applyTextareaMarks(state.activeField, state.suggestions)
          }

          const applied = result?.applied || 0
          const skipped = result?.skipped || 0

          if (applied > 0) {
            let msg = `${applied} suggestion${applied > 1 ? 's' : ''}`
            if (skipped > 0) msg += ` (${skipped} skipped)`
            if (time) msg += ` \u2022 ${time}`
            updateStatus('count', msg)
          } else {
            updateStatus('info', 'No suggestions found')
          }
        }
      } else if (!isEdit && json.data) {
        state.findings = json.data.findings || []
        state.summary = json.data.summary || ''
        const time = json.data.processingTimeMs ? `${(json.data.processingTimeMs / 1000).toFixed(1)}s` : ''

        // Complex editors: Grammarly-style overlay underlines for findings
        if (state.complexEditor) {
          if (state.findings.length > 0) {
            // Canvas mode: use typography-estimated overlay
            // DOM mode: use Range-based overlay
            let result
            if (state.isCanvasMode && overlay.applyCanvasModeOverlay) {
              result = overlay.applyCanvasModeOverlay(state.findings, 'findings')
            } else {
              result = overlay.applyComplexEditorOverlay(state.findings, 'findings')
            }

            const applied = result?.applied || 0
            const skipped = result?.skipped || 0

            let msg = `${applied} finding${applied > 1 ? 's' : ''}`
            if (skipped > 0) msg += ` (${skipped} not matched)`
            if (time) msg += ` \u2022 ${time}`
            updateStatus(applied > 0 ? 'count' : 'info', applied > 0 ? msg : 'No findings matched in document')
          } else {
            updateStatus('info', 'No findings')
          }
          if (state.summary && card) {
            card.showAnalysisSummary(state.summary)
          }
        } else {
          // Normal editors: apply inline finding marks
          if (state.fieldType === 'contenteditable' && state.findings.length > 0) {
            overlay.applyFindingMarks(state.activeField, state.findings)
          }

          if (card && state.summary) {
            card.showAnalysisSummary(state.summary)
          }

          const count = state.findings.length
          if (count > 0) {
            updateStatus('count', `${count} finding${count > 1 ? 's' : ''} \u2022 ${time}`)
          } else {
            updateStatus('info', 'No findings')
          }
        }
      }
    } catch (err) {
      console.error('[DocIntel] Run failed:', err)
      const msg = err.message || 'Failed to analyze'
      if (msg.includes('Extension context invalidated') || msg.includes('context invalidated')) {
        updateStatus('error', 'Extension reloaded — please refresh this page')
      } else {
        updateStatus('error', msg)
      }
    } finally {
      state.isProcessing = false
    }
  }

  // ─── Status Display ───────────────────────────────────────────────

  function updateStatus(type, message) {
    if (!toolbarEl) return

    const row = toolbarEl.querySelector('[data-status-row]')
    const text = toolbarEl.querySelector('[data-status-text]')
    if (!row || !text) return

    row.style.display = 'flex'

    const _setHTML = (el, h) => {
      const helpers = window.__waDocIntelHelpers
      if (helpers && helpers.safeSetInnerHTML) helpers.safeSetInnerHTML(el, h)
      else el.innerHTML = h
    }

    if (type === 'processing') {
      _setHTML(text, `<div class="wa-spinner"></div> <span>${escapeHTML(message)}</span>`)
    } else if (type === 'count') {
      _setHTML(text, `<span class="wa-status-badge wa-status-count">${escapeHTML(message)}</span>`)
    } else if (type === 'error') {
      _setHTML(text, `<span class="wa-status-badge wa-status-error">${escapeHTML(message)}</span>`)
    } else {
      _setHTML(text, `<span>${escapeHTML(message)}</span>`)
    }

    // Update Run button state
    const runBtn = toolbarEl.querySelector('[data-action="run"]')
    if (runBtn) {
      runBtn.disabled = state.isProcessing || !selectedMode
      runBtn.textContent = state.isProcessing ? 'Running...' : 'Run'
    }
  }

  // ─── Config Helper ────────────────────────────────────────────────

  function isExtensionContextValid() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id)
    } catch {
      return false
    }
  }

  function getConfig() {
    return new Promise((resolve) => {
      // If extension context is invalidated (e.g., after extension reload),
      // fall back to default config so the toolbar still works
      if (!isExtensionContextValid()) {
        console.warn('[DocIntel] Extension context invalidated — using default config')
        resolve({
          apiUrl: 'http://localhost:3001',
          apiKey: '',
          userId: '',
          workspaceId: '',
        })
        return
      }

      try {
        chrome.storage.local.get(['apiUrl', 'apiKey', 'userId', 'workspaceId'], (result) => {
          if (chrome.runtime.lastError) {
            console.warn('[DocIntel] Storage read failed:', chrome.runtime.lastError.message)
            resolve({
              apiUrl: 'http://localhost:3001',
              apiKey: '',
              userId: '',
              workspaceId: '',
            })
            return
          }
          resolve({
            apiUrl: result.apiUrl || 'http://localhost:3001',
            apiKey: result.apiKey || '',
            userId: result.userId || '',
            workspaceId: result.workspaceId || '',
          })
        })
      } catch (err) {
        console.warn('[DocIntel] Config retrieval failed:', err.message)
        resolve({
          apiUrl: 'http://localhost:3001',
          apiKey: '',
          userId: '',
          workspaceId: '',
        })
      }
    })
  }

  // ─── Results Panel (for complex editors) ──────────────────────────

  function showResultsPanel(items, type, isUnmatched) {
    // Remove previous results panel
    if (resultsPanelEl) {
      resultsPanelEl.remove()
      resultsPanelEl = null
    }

    if (!toolbarEl) return
    const helpers = window.__waDocIntelHelpers
    if (!helpers) return
    const shadow = helpers.ensureShadowHost()
    if (!shadow) return

    const panel = document.createElement('div')
    panel.className = 'wa-toolbar'
    panel.style.cssText = toolbarEl.style.cssText

    // Position below the toolbar
    const toolbarRect = toolbarEl.getBoundingClientRect()
    panel.style.top = (toolbarRect.bottom + 6) + 'px'

    // Canvas mode: make the panel taller and wider for better readability
    if (state.isCanvasMode) {
      panel.style.maxHeight = Math.min(500, window.innerHeight - toolbarRect.bottom - 24) + 'px'
      panel.style.width = Math.min(480, window.innerWidth - 32) + 'px'
    } else {
      panel.style.maxHeight = '360px'
    }
    panel.style.overflow = 'hidden'

    // Build notice about complex editor mode
    const editorName = {
      'google-docs': 'Google Docs',
      'notion': 'Notion',
      'coda': 'Coda',
      'quip': 'Quip',
      'dropbox-paper': 'Dropbox Paper',
    }[state.complexEditor] || 'this editor'

    let html
    if (isUnmatched) {
      html = `<div class="wa-complex-notice" style="border-left:3px solid #f59e0b;padding-left:8px;"><span class="wa-complex-notice-icon">\u26A0\uFE0F</span> ${items.length} suggestion${items.length > 1 ? 's' : ''} couldn't be highlighted in the document. The text may have changed or special formatting interfered. You can still copy the suggested fixes below.</div>`
    } else if (state.isCanvasMode) {
      html = `<div class="wa-complex-notice"><span class="wa-complex-notice-icon">\u2728</span> ${items.length} suggestion${items.length > 1 ? 's' : ''} found. Click "Copy fix" to copy replacement text, then paste in your document.</div>`
    } else {
      html = `<div class="wa-complex-notice"><span class="wa-complex-notice-icon">\u2139\uFE0F</span> Results shown in panel — ${escapeHTML(editorName)} doesn't support inline marks. Click "Copy fix" to copy replacement text.</div>`
    }

    html += '<div class="wa-results-panel">'

    if (type === 'suggestions') {
      for (const sug of items) {
        html += buildSuggestionResultHTML(sug)
      }
    } else if (type === 'findings') {
      for (const finding of items) {
        html += buildFindingResultHTML(finding)
      }
    }

    html += '</div>'
    const _helpers = window.__waDocIntelHelpers
    if (_helpers && _helpers.safeSetInnerHTML) _helpers.safeSetInnerHTML(panel, html)
    else panel.innerHTML = html

    // Bind result item events
    bindResultsPanelEvents(panel, type)

    shadow.appendChild(panel)
    resultsPanelEl = panel
  }

  function buildSuggestionResultHTML(sug) {
    // Use enhanced layout for canvas mode
    if (state.isCanvasMode) {
      return buildCanvasModeSuggestionHTML(sug)
    }

    const badgeClass = `wa-badge-${sug.suggestionType}`
    const firstVariant = sug.variants && sug.variants.length > 0 ? sug.variants[0] : null
    const confidence = Math.round((sug.confidence || 0.7) * 100)

    let html = `<div class="wa-result-item" data-suggestion-id="${sug.id}">`
    html += `<div class="wa-result-header">`
    html += `<span class="wa-card-badge ${badgeClass}">${escapeHTML(sug.suggestionType)}</span>`
    html += `<span class="wa-card-confidence">${confidence}%</span>`
    html += `</div>`

    // Original → Replacement
    html += `<div style="display:flex;align-items:flex-start;gap:6px;flex-wrap:wrap;">`
    html += `<span class="wa-result-original">"${escapeHTML(truncateText(sug.spanText, 80))}"</span>`
    if (firstVariant) {
      html += `<span class="wa-result-arrow">\u2192</span>`
      html += `<span class="wa-result-replacement">"${escapeHTML(truncateText(firstVariant.text, 80))}"</span>`
    }
    html += `</div>`

    if (sug.explanation) {
      html += `<div class="wa-result-explanation">${escapeHTML(sug.explanation)}</div>`
    }

    // Variant selector if multiple variants
    if (sug.variants && sug.variants.length > 1) {
      html += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:2px;">`
      sug.variants.forEach((v, i) => {
        const sel = i === 0 ? 'style="border-color:#7c3aed;color:#c4b5fd;"' : ''
        html += `<button class="wa-btn-dismiss-sm" data-variant-idx="${i}" data-for="${sug.id}" ${sel}>${escapeHTML(truncateText(v.text, 40))}${v.label ? ' (' + escapeHTML(v.label) + ')' : ''}</button>`
      })
      html += `</div>`
    }

    html += `<div class="wa-result-actions">`
    html += `<button class="wa-btn-dismiss-sm" data-action="dismiss" data-id="${sug.id}">Dismiss</button>`
    if (firstVariant) {
      html += `<button class="wa-btn-copy" data-action="copy" data-id="${sug.id}" data-text="${escapeHTMLAttr(firstVariant.text)}">Copy fix</button>`
    }
    html += `</div>`

    html += `</div>`
    return html
  }

  /**
   * Build an enhanced suggestion card for canvas-mode Google Docs.
   * Larger, more readable, with inline variant selection and prominent copy button.
   */
  function buildCanvasModeSuggestionHTML(sug) {
    const badgeClass = `wa-badge-${sug.suggestionType}`
    const firstVariant = sug.variants && sug.variants.length > 0 ? sug.variants[0] : null
    const confidence = Math.round((sug.confidence || 0.7) * 100)

    let html = `<div class="wa-result-item-canvas" data-suggestion-id="${sug.id}">`

    // Header row: badge + confidence
    html += `<div class="wa-result-header">`
    html += `<span class="wa-card-badge ${badgeClass}">${escapeHTML(sug.suggestionType)}</span>`
    html += `<span class="wa-card-confidence">${confidence}%</span>`
    html += `</div>`

    // Original text block
    html += `<div class="wa-result-original-block">${escapeHTML(sug.spanText)}</div>`

    // Explanation
    if (sug.explanation) {
      html += `<div class="wa-result-explanation-block">${escapeHTML(sug.explanation)}</div>`
    }

    // Variant options (radio-style selection)
    if (sug.variants && sug.variants.length > 0) {
      html += `<div class="wa-result-variants-row">`
      sug.variants.forEach((v, i) => {
        const selected = i === 0 ? ' selected' : ''
        html += `<div class="wa-result-variant-option${selected}" data-variant-idx="${i}" data-for="${sug.id}">`
        html += `<div class="wa-result-variant-radio"></div>`
        html += `<div class="wa-result-variant-content">`
        html += `<div class="wa-result-variant-text">${escapeHTML(v.text)}</div>`
        if (v.label) html += `<div class="wa-result-variant-label">${escapeHTML(v.label)}</div>`
        html += `</div></div>`
      })
      html += `</div>`
    }

    // Action buttons
    html += `<div class="wa-result-actions-row">`
    html += `<button class="wa-btn-dismiss-lg" data-action="dismiss" data-id="${sug.id}">Dismiss</button>`
    if (firstVariant) {
      html += `<button class="wa-btn-copy-lg" data-action="copy" data-id="${sug.id}" data-text="${escapeHTMLAttr(firstVariant.text)}">Copy fix</button>`
    }
    html += `</div>`

    html += `</div>`
    return html
  }

  function buildFindingResultHTML(finding) {
    const severityClass = `wa-badge-${finding.severity}`

    let html = `<div class="wa-result-finding" data-finding-id="${finding.id}">`
    html += `<div class="wa-result-header">`
    html += `<span class="wa-card-badge ${severityClass}">${escapeHTML(finding.severity)}</span>`
    html += `</div>`
    html += `<div class="wa-result-finding-text">${escapeHTML(finding.finding || '')}</div>`
    if (finding.spanText) {
      html += `<div class="wa-result-explanation">In: "${escapeHTML(truncateText(finding.spanText, 100))}"</div>`
    }
    if (finding.suggestion) {
      html += `<div class="wa-result-finding-suggestion">${escapeHTML(finding.suggestion)}</div>`
    }
    html += `<div class="wa-result-actions">`
    html += `<button class="wa-btn-dismiss-sm" data-action="dismiss-finding" data-id="${finding.id}">Dismiss</button>`
    html += `</div>`
    html += `</div>`
    return html
  }

  function appendSummaryToResultsPanel(summary) {
    if (!resultsPanelEl) return
    const scrollPanel = resultsPanelEl.querySelector('.wa-results-panel')
    if (!scrollPanel) return

    const summaryDiv = document.createElement('div')
    summaryDiv.style.cssText = 'padding:8px 10px;border:1px solid #3f3f46;border-radius:8px;background:#1f1f23;'
    const _sh = window.__waDocIntelHelpers
    const _sumHTML = `<div style="font-weight:600;color:#d4d4d8;font-size:11px;margin-bottom:4px;">Summary</div><div style="font-size:11px;color:#a1a1aa;line-height:1.4;">${escapeHTML(summary)}</div>`
    if (_sh && _sh.safeSetInnerHTML) _sh.safeSetInnerHTML(summaryDiv, _sumHTML)
    else summaryDiv.innerHTML = _sumHTML
    scrollPanel.prepend(summaryDiv)
  }

  function bindResultsPanelEvents(panel, type) {
    panel.addEventListener('click', async (e) => {
      const target = e.target

      // Copy fix button
      if (target.dataset.action === 'copy') {
        const text = target.dataset.text
        if (text) {
          try {
            await navigator.clipboard.writeText(text)
            target.textContent = 'Copied!'
            target.style.background = '#059669'
            setTimeout(() => {
              target.textContent = 'Copy fix'
              target.style.background = ''
            }, 1500)
          } catch (err) {
            // Fallback: select and copy
            const ta = document.createElement('textarea')
            ta.value = text
            ta.style.cssText = 'position:fixed;left:-9999px;'
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            ta.remove()
            target.textContent = 'Copied!'
            setTimeout(() => { target.textContent = 'Copy fix' }, 1500)
          }
        }
        return
      }

      // Dismiss suggestion
      if (target.dataset.action === 'dismiss') {
        const id = target.dataset.id
        const item = target.closest('.wa-result-item, .wa-result-item-canvas')
        if (item) {
          item.style.opacity = '0'
          item.style.transition = 'opacity 0.15s, max-height 0.2s'
          item.style.maxHeight = item.scrollHeight + 'px'
          setTimeout(() => {
            item.style.maxHeight = '0'
            item.style.overflow = 'hidden'
            item.style.padding = '0'
            item.style.margin = '0'
            item.style.border = 'none'
            setTimeout(() => item.remove(), 200)
          }, 150)
        }
        state.suggestions = state.suggestions.filter(s => s.id !== id)
        updateStatusFromResults()
        return
      }

      // Dismiss finding
      if (target.dataset.action === 'dismiss-finding') {
        const id = target.dataset.id
        const item = target.closest('.wa-result-finding')
        if (item) {
          item.style.opacity = '0'
          item.style.transition = 'opacity 0.15s'
          setTimeout(() => item.remove(), 150)
        }
        state.findings = state.findings.filter(f => f.id !== id)
        updateStatusFromResults()
        return
      }

      // Variant selection for suggestions (both classic and canvas mode)
      const variantTarget = target.closest('[data-variant-idx]')
      if (variantTarget && variantTarget.dataset.for) {
        const sugId = variantTarget.dataset.for
        const idx = parseInt(variantTarget.dataset.variantIdx, 10)
        const sug = state.suggestions.find(s => s.id === sugId)
        if (sug && sug.variants && sug.variants[idx]) {
          // Find the parent result item (works for both classic and canvas mode)
          const item = variantTarget.closest('.wa-result-item, .wa-result-item-canvas')
          if (item) {
            const copyBtn = item.querySelector('[data-action="copy"]')
            if (copyBtn) {
              copyBtn.dataset.text = sug.variants[idx].text
            }
            // Update replacement text display (classic mode)
            const replacement = item.querySelector('.wa-result-replacement')
            if (replacement) {
              replacement.textContent = '"' + truncateText(sug.variants[idx].text, 80) + '"'
            }
            // Update canvas-mode radio selection
            item.querySelectorAll('.wa-result-variant-option').forEach(opt => {
              opt.classList.toggle('selected', opt.dataset.variantIdx === String(idx))
            })
            // Update classic mode variant button styling
            item.querySelectorAll('[data-variant-idx]:not(.wa-result-variant-option)').forEach(btn => {
              btn.style.borderColor = btn.dataset.variantIdx === String(idx) ? '#7c3aed' : ''
              btn.style.color = btn.dataset.variantIdx === String(idx) ? '#c4b5fd' : ''
            })
          }
        }
        return
      }
    })
  }

  function updateStatusFromResults() {
    const count = state.suggestions.length + state.findings.length
    if (count === 0) {
      updateStatus('info', 'All items resolved')
      // Auto-close results panel after a beat
      setTimeout(() => {
        if (resultsPanelEl) {
          resultsPanelEl.remove()
          resultsPanelEl = null
        }
      }, 800)
    } else {
      updateStatus('count', `${count} remaining`)
    }
  }

  // ─── Helper ───────────────────────────────────────────────────────

  function escapeHTML(str) {
    if (!str) return ''
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function escapeHTMLAttr(str) {
    if (!str) return ''
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  function truncateText(str, maxLen) {
    if (!str) return ''
    if (str.length <= maxLen) return str
    return str.slice(0, maxLen - 1) + '\u2026'
  }

  // ─── Expose for other modules ─────────────────────────────────────

  window.__waDocIntelShowToolbar = showToolbar
  window.__waDocIntelHideToolbar = hideToolbar
  window.__waDocIntelUpdateStatus = function () {
    const count = state.suggestions.length + state.findings.length
    if (count === 0) {
      updateStatus('info', 'All suggestions resolved')
    } else {
      updateStatus('count', `${count} remaining`)
    }
  }
})()
