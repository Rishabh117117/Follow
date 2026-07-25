/**
 * Doc Intel Card — hover cards for suggestions and findings.
 *
 * Ported from doc-intel-card-web.js (291 lines → ~120 lines).
 * Event delegation on document for mouseover/mouseout on marks.
 */

import { state, safeSetInnerHTML, type Suggestion, type Finding } from './detector'
import { acceptSuggestion, dismissSuggestion } from './overlay'

let currentCard: HTMLElement | null = null
let hideTimeout: ReturnType<typeof setTimeout> | null = null
let shadowRoot: ShadowRoot | null = null

export function init(shadow: ShadowRoot): void {
  shadowRoot = shadow

  document.addEventListener('mouseover', (e) => {
    const span = (e.target as HTMLElement).closest?.('.wa-doc-suggestion, .wa-doc-finding')
    if (!span) return
    const id = (span as HTMLElement).dataset.suggestionId
    if (!id) return

    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null }

    const suggestion = state.suggestions.find(s => s.id === id)
    const finding = state.findings.find(f => f.id === id)
    if (suggestion || finding) showCard(suggestion || null, finding || null, (span as HTMLElement).getBoundingClientRect())
  }, true)

  document.addEventListener('mouseout', (e) => {
    if ((e.target as HTMLElement).closest?.('.wa-doc-suggestion, .wa-doc-finding')) {
      scheduleHide()
    }
  }, true)
}

function showCard(suggestion: Suggestion | null, finding: Finding | null, rect: DOMRect): void {
  hideCard()
  if (!shadowRoot) return

  const card = document.createElement('div')
  card.className = 'wa-card'
  card.style.cssText = `
    position: fixed; z-index: 9999; background: #1e1e2e; color: #e4e4e7; border-radius: 10px;
    padding: 12px; width: 300px; font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    pointer-events: auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `

  if (suggestion) {
    const variant = suggestion.variants?.[0]
    safeSetInnerHTML(card, `
      <div style="margin-bottom:8px;"><span style="background:#374151;padding:2px 6px;border-radius:4px;font-size:11px;">${suggestion.suggestionType}</span>
      ${suggestion.confidence ? `<span style="color:#9AA0A6;font-size:11px;margin-left:6px;">${Math.round(suggestion.confidence * 100)}%</span>` : ''}</div>
      <div style="margin-bottom:8px;line-height:1.4;">${suggestion.explanation}</div>
      ${variant ? `<div style="background:#27272a;padding:8px;border-radius:6px;margin-bottom:10px;font-size:12px;">${escapeHTML(variant.text)}</div>` : ''}
      <div style="display:flex;gap:6px;">
        <button data-action="accept" style="flex:1;padding:6px;border:none;border-radius:6px;background:#16A34A;color:#fff;cursor:pointer;font-size:12px;">Accept</button>
        <button data-action="dismiss" style="flex:1;padding:6px;border:none;border-radius:6px;background:#374151;color:#e4e4e7;cursor:pointer;font-size:12px;">Dismiss</button>
      </div>
    `)

    card.querySelector('[data-action="accept"]')?.addEventListener('click', () => {
      const text = variant?.text || suggestion.spanText
      acceptSuggestion(suggestion.id, text)
      hideCard()
    })
    card.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => {
      dismissSuggestion(suggestion.id)
      hideCard()
    })
  } else if (finding) {
    safeSetInnerHTML(card, `
      <div style="margin-bottom:8px;"><span style="background:#374151;padding:2px 6px;border-radius:4px;font-size:11px;">${finding.severity}</span></div>
      <div style="margin-bottom:8px;line-height:1.4;">${finding.finding}</div>
      ${finding.suggestion ? `<div style="color:#9AA0A6;font-size:12px;margin-bottom:8px;">${finding.suggestion}</div>` : ''}
      <button data-action="dismiss" style="padding:6px 12px;border:none;border-radius:6px;background:#374151;color:#e4e4e7;cursor:pointer;font-size:12px;">Dismiss</button>
    `)
    card.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => {
      dismissSuggestion(finding.id)
      hideCard()
    })
  }

  // Position
  const top = rect.top > 200 ? rect.top - 200 : rect.bottom + 8
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 320))
  card.style.top = `${top}px`
  card.style.left = `${left}px`

  card.addEventListener('mouseenter', () => { if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null } })
  card.addEventListener('mouseleave', scheduleHide)

  shadowRoot.appendChild(card)
  currentCard = card
}

function hideCard(): void {
  currentCard?.remove()
  currentCard = null
}

function scheduleHide(): void {
  hideTimeout = setTimeout(() => hideCard(), 120)
}

function escapeHTML(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export { hideCard }
