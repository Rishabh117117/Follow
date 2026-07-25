/**
 * doc-intel-card-web.js — Shadow DOM Hover Cards
 *
 * Renders suggestion and finding hover cards in the shared Shadow DOM.
 * Listens for mouseover/mouseout on .wa-doc-suggestion spans.
 * Handles variant selection, accept, and dismiss actions.
 */

;(function () {
  'use strict'

  const state = window.__waDocIntel
  let currentCard = null
  let hideTimeout = null
  let analysisPanel = null

  // ─── Hover Detection (Page-Level Event Delegation) ────────────────

  document.addEventListener('mouseover', (e) => {
    const span = e.target.closest && e.target.closest('.wa-doc-suggestion, .wa-doc-finding')
    if (!span) return

    const id = span.dataset.suggestionId
    if (!id) return

    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null }

    const suggestion = state.suggestions.find(s => s.id === id)
    const finding = state.findings.find(f => f.id === id)

    if (suggestion || finding) {
      const rect = span.getBoundingClientRect()
      showCard(suggestion, finding, rect)
    }
  }, true)

  document.addEventListener('mouseout', (e) => {
    const span = e.target.closest && e.target.closest('.wa-doc-suggestion, .wa-doc-finding')
    if (!span) return
    scheduleHide()
  }, true)

  // ─── Card Rendering ───────────────────────────────────────────────

  function showCard(suggestion, finding, anchorRect) {
    hideCard(true) // Remove previous without animation

    const helpers = window.__waDocIntelHelpers
    if (!helpers) return
    const shadow = helpers.ensureShadowHost()
    if (!shadow) return

    const card = document.createElement('div')
    card.className = 'wa-card'

    const _setHTML = (el, h) => {
      if (helpers.safeSetInnerHTML) helpers.safeSetInnerHTML(el, h)
      else el.innerHTML = h
    }

    if (suggestion) {
      _setHTML(card, buildSuggestionCardHTML(suggestion))
      bindSuggestionCardEvents(card, suggestion)
    } else if (finding) {
      _setHTML(card, buildFindingCardHTML(finding))
    }

    // Position: above the anchor if there's space, else below
    const spaceAbove = anchorRect.top
    const cardHeight = 180 // Approximate
    const top = spaceAbove > cardHeight + 12
      ? anchorRect.top - cardHeight - 8
      : anchorRect.bottom + 8

    // Center horizontally on the anchor, clamped to viewport
    let left = anchorRect.left + (anchorRect.width / 2) - 150
    left = Math.max(8, Math.min(left, window.innerWidth - 320))

    card.style.top = top + 'px'
    card.style.left = left + 'px'

    // Hover on card prevents hiding
    card.addEventListener('mouseenter', () => {
      if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null }
    })
    card.addEventListener('mouseleave', () => {
      scheduleHide()
    })

    shadow.appendChild(card)
    currentCard = card

    // Adjust position after render if card overflows upward
    requestAnimationFrame(() => {
      const cardRect = card.getBoundingClientRect()
      if (cardRect.top < 4) {
        card.style.top = (anchorRect.bottom + 8) + 'px'
      }
    })
  }

  function hideCard(immediate) {
    if (!currentCard) return

    if (immediate) {
      currentCard.remove()
      currentCard = null
    } else {
      const c = currentCard
      c.style.opacity = '0'
      c.style.transition = 'opacity 0.15s'
      setTimeout(() => {
        c.remove()
        if (currentCard === c) currentCard = null
      }, 150)
    }
  }

  function scheduleHide() {
    if (hideTimeout) clearTimeout(hideTimeout)
    hideTimeout = setTimeout(() => hideCard(false), 120)
  }

  // ─── Suggestion Card HTML ─────────────────────────────────────────

  function buildSuggestionCardHTML(sug) {
    const badgeClass = `wa-badge-${sug.suggestionType}`
    const confidence = Math.round((sug.confidence || 0.7) * 100)

    let html = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
        <span class="wa-card-badge ${badgeClass}">${sug.suggestionType}</span>
        <span class="wa-card-confidence">${confidence}%</span>
      </div>
      <div class="wa-card-explanation">${escapeHTML(sug.explanation || '')}</div>
    `

    if (sug.variants && sug.variants.length > 0) {
      html += '<div class="wa-variant-list">'
      sug.variants.forEach((v, i) => {
        html += `
          <div class="wa-variant ${i === 0 ? 'selected' : ''}" data-variant-idx="${i}">
            <div class="wa-variant-radio"></div>
            <div>
              <div class="wa-variant-text">${escapeHTML(v.text)}</div>
              ${v.label ? `<div class="wa-variant-label">${escapeHTML(v.label)}</div>` : ''}
            </div>
          </div>
        `
      })
      html += '</div>'
    }

    html += `
      <div class="wa-card-actions">
        <button class="wa-btn-dismiss" data-action="dismiss">Dismiss</button>
        <button class="wa-btn-accept" data-action="accept" ${!sug.variants?.length ? 'disabled' : ''}>Accept</button>
      </div>
    `

    return html
  }

  function buildFindingCardHTML(finding) {
    const severityClass = `wa-badge-${finding.severity}`

    let html = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
        <span class="wa-card-badge ${severityClass}">${finding.severity}</span>
      </div>
      <div class="wa-finding-text">${escapeHTML(finding.finding || '')}</div>
    `

    if (finding.suggestion) {
      html += `<div class="wa-finding-suggestion">${escapeHTML(finding.suggestion)}</div>`
    }

    html += `
      <div class="wa-card-actions" style="margin-top:8px;">
        <button class="wa-btn-dismiss" data-action="dismiss">Dismiss</button>
      </div>
    `

    return html
  }

  // ─── Suggestion Card Events ───────────────────────────────────────

  function bindSuggestionCardEvents(card, suggestion) {
    let selectedVariantIdx = 0

    // Variant selection
    card.addEventListener('click', (e) => {
      const variant = e.target.closest('.wa-variant')
      if (variant) {
        const idx = parseInt(variant.dataset.variantIdx, 10)
        selectedVariantIdx = idx

        // Update visual selection
        card.querySelectorAll('.wa-variant').forEach((v, i) => {
          v.classList.toggle('selected', i === idx)
        })
        return
      }

      // Accept button
      if (e.target.dataset.action === 'accept') {
        const overlay = window.__waDocIntelOverlay
        if (!overlay) return

        const selectedVariant = suggestion.variants[selectedVariantIdx]
        if (!selectedVariant) return

        overlay.acceptSuggestion(suggestion.id, selectedVariant.text)
        hideCard(true)
        updateToolbarStatus()
        return
      }

      // Dismiss button
      if (e.target.dataset.action === 'dismiss') {
        const overlay = window.__waDocIntelOverlay
        if (!overlay) return

        overlay.dismissSuggestion(suggestion.id)
        hideCard(true)
        updateToolbarStatus()
        return
      }
    })
  }

  function updateToolbarStatus() {
    if (typeof window.__waDocIntelUpdateStatus === 'function') {
      window.__waDocIntelUpdateStatus()
    }
  }

  // ─── Analysis Summary Panel ───────────────────────────────────────

  function showAnalysisSummary(summary) {
    hideAnalysisSummary()
    if (!summary) return

    const helpers = window.__waDocIntelHelpers
    if (!helpers) return
    const shadow = helpers.ensureShadowHost()
    if (!shadow) return

    const panel = document.createElement('div')
    panel.className = 'wa-analysis-summary'
    const _summaryHTML = `<div class="wa-analysis-summary-title">Analysis Summary</div><div>${escapeHTML(summary)}</div><button class="wa-close-btn" style="position:absolute;top:6px;right:6px;">&times;</button>`
    if (helpers.safeSetInnerHTML) helpers.safeSetInnerHTML(panel, _summaryHTML)
    else panel.innerHTML = _summaryHTML

    panel.querySelector('.wa-close-btn').addEventListener('click', () => {
      hideAnalysisSummary()
    })

    shadow.appendChild(panel)
    analysisPanel = panel
  }

  function hideAnalysisSummary() {
    if (analysisPanel) {
      analysisPanel.remove()
      analysisPanel = null
    }
  }

  // ─── Helper ───────────────────────────────────────────────────────

  function escapeHTML(str) {
    if (!str) return ''
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // ─── Expose ───────────────────────────────────────────────────────

  window.__waDocIntelCard = {
    showCard,
    hideCard,
    scheduleHide,
    showAnalysisSummary,
    hideAnalysisSummary,
  }
})()
