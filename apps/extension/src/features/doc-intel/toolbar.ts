/**
 * Doc Intel Toolbar — floating mode toolbar with mode chips, Run button, and results panel.
 *
 * For Google Docs, results are shown in an inline panel (since API-based
 * highlighting doesn't produce hoverable DOM spans). For other editors,
 * marks are injected into the DOM and hover cards handle interaction.
 */

import { state, extractText, safeSetInnerHTML } from './detector'
import {
  applyContentEditableMarks,
  applyFindingMarks,
  applyTextareaMarks,
  clearAllMarks,
  acceptSuggestion,
  dismissSuggestion,
  scrollToTextInGoogleDoc,
} from './overlay'
import { replaceTextInGoogleDoc, extractGoogleDocId } from '@/lib/google-docs-api'
import { sendToBackground } from '@/core/message-bus'

const EDIT_MODES = [
  { id: 'edit_grammar', label: 'Grammar' }, { id: 'edit_clarity', label: 'Clarity' },
  { id: 'edit_conciseness', label: 'Concise' }, { id: 'edit_tone', label: 'Tone' },
  { id: 'edit_structure', label: 'Structure' },
]
const ANALYZE_MODES = [
  { id: 'analyze_logic', label: 'Logic' }, { id: 'analyze_evidence', label: 'Evidence' },
  { id: 'analyze_bias', label: 'Bias' },
]

const TYPE_COLORS: Record<string, string> = {
  clarity: '#f59e0b', conciseness: '#3b82f6', tone: '#8b5cf6',
  grammar: '#10b981', structure: '#f43f5e', custom: '#a855f7',
}
const SEVERITY_COLORS: Record<string, string> = {
  critical: '#f43f5e', warning: '#f59e0b', info: '#3b82f6',
}

let toolbarEl: HTMLElement | null = null
let selectedMode: string | null = null
let customInstruction = ''

export function showToolbar(field: HTMLElement, shadowRoot: ShadowRoot): void {
  hideToolbar()
  state.activeField = field
  state.toolbarVisible = true

  const toolbar = document.createElement('div')
  toolbar.style.cssText = `
    position: fixed; z-index: 10000; background: #18181b; border-radius: 10px;
    padding: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.3); pointer-events: auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-height: 80vh; overflow-y: auto;
  `

  const chips = [...EDIT_MODES, ...ANALYZE_MODES].map(m =>
    `<button data-mode="${m.id}" style="padding:4px 10px;border:1px solid #3f3f46;border-radius:14px;background:transparent;color:#e4e4e7;font-size:11px;cursor:pointer;margin:2px;">${m.label}</button>`
  ).join('')

  safeSetInnerHTML(toolbar, `
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:2px;margin-bottom:6px;">
      ${chips}
      <div style="flex:1;"></div>
      <button data-action="close" style="background:none;border:none;color:#9AA0A6;cursor:pointer;font-size:16px;padding:0 4px;">&times;</button>
    </div>
    <div style="display:flex;gap:4px;">
      <input data-input="custom" placeholder="Custom instruction..." style="flex:1;padding:6px 8px;background:#27272a;border:1px solid #3f3f46;border-radius:6px;color:#e4e4e7;font-size:12px;outline:none;" />
      <button data-action="run" disabled style="padding:6px 12px;border:none;border-radius:6px;background:#6366F1;color:#fff;font-size:12px;cursor:pointer;opacity:0.5;">Run</button>
    </div>
    <div data-status style="display:none;padding:4px 0;font-size:11px;color:#9AA0A6;"></div>
    <div data-results style="display:none;"></div>
  `)

  // Position
  const rect = field.getBoundingClientRect()
  const isComplex = state.complexEditor || rect.width > window.innerWidth * 0.8
  if (isComplex) {
    toolbar.style.top = '60px'
    toolbar.style.left = `${Math.max(8, (window.innerWidth - 560) / 2)}px`
    toolbar.style.width = `${Math.min(560, window.innerWidth - 32)}px`
  } else {
    const top = rect.top > 80 ? rect.top - 80 : rect.bottom + 8
    toolbar.style.top = `${top}px`
    toolbar.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 580))}px`
    toolbar.style.width = `${Math.min(560, rect.width)}px`
  }

  // Events
  toolbar.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target.dataset.mode) {
      selectedMode = target.dataset.mode
      toolbar.querySelectorAll('[data-mode]').forEach(b => {
        (b as HTMLElement).style.background = b === target ? '#6366F1' : 'transparent'
        ;(b as HTMLElement).style.borderColor = b === target ? '#6366F1' : '#3f3f46'
      })
      const run = toolbar.querySelector('[data-action="run"]') as HTMLButtonElement
      if (run) { run.disabled = false; run.style.opacity = '1' }
    }
    if (target.dataset.action === 'close' || target.closest('[data-action="close"]')) hideToolbar()
    if (target.dataset.action === 'run' && selectedMode && !state.isProcessing) runDocIntel()
  })

  const input = toolbar.querySelector('[data-input="custom"]') as HTMLInputElement
  input?.addEventListener('input', (e) => { customInstruction = (e.target as HTMLInputElement).value })
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && selectedMode) runDocIntel() })

  shadowRoot.appendChild(toolbar)
  toolbarEl = toolbar
}

export function hideToolbar(): void {
  toolbarEl?.remove()
  toolbarEl = null
  state.toolbarVisible = false
  selectedMode = null
  customInstruction = ''
  clearAllMarks()
}

async function runDocIntel(): Promise<void> {
  if (!selectedMode || !state.activeField || state.isProcessing) return
  state.isProcessing = true
  updateStatus('Processing...')
  clearResults()

  const text = extractText(state.activeField)
  if (!text || text.length < 10) {
    updateStatus('Not enough text to analyze')
    state.isProcessing = false
    return
  }

  const isAnalyze = selectedMode.startsWith('analyze_')
  const action = isAnalyze ? 'analyze' : 'suggest'
  const payload = { action, content: text, mode: selectedMode, customInstruction: customInstruction || undefined }

  try {
    const result = await sendToBackground<{
      suggestions?: Array<{ id: string; spanText: string; suggestionType: string; explanation: string; confidence?: number; variants?: Array<{ text: string; label: string }> }>
      findings?: Array<{ id: string; spanText: string; severity: string; finding: string; suggestion?: string; mode: string }>
      summary?: string
    }>({
      type: 'DOC_INTEL_REQUEST',
      payload,
    })

    if (!result.success) {
      updateStatus(`Error: ${result.error}`)
      state.isProcessing = false
      return
    }

    if (isAnalyze && result.data?.findings) {
      state.findings = result.data.findings
      const { applied, skipped } = applyFindingMarks(state.activeField!, state.findings)
      updateStatus(`${applied} finding(s) marked, ${skipped} skipped`)
      renderFindingsPanel(result.data.findings, result.data.summary)
    } else if (result.data?.suggestions) {
      state.suggestions = result.data.suggestions
      const fieldType = state.activeField!.tagName === 'TEXTAREA' ? 'textarea' : 'contenteditable'
      const { applied, skipped } = fieldType === 'textarea'
        ? applyTextareaMarks(state.activeField! as HTMLTextAreaElement, state.suggestions)
        : applyContentEditableMarks(state.activeField!, state.suggestions)
      updateStatus(`${applied} suggestion(s) applied, ${skipped} skipped`)
      renderSuggestionsPanel(result.data.suggestions)
    }
  } catch (err) {
    updateStatus(`Error: ${(err as Error).message}`)
  }

  state.isProcessing = false
}

// ─── Results Panel ──────────────────────────────────────────────────────

function renderSuggestionsPanel(suggestions: Array<{
  id: string; spanText: string; suggestionType: string; explanation: string;
  confidence?: number; variants?: Array<{ text: string; label: string }>
}>): void {
  const container = toolbarEl?.querySelector('[data-results]') as HTMLElement
  if (!container || suggestions.length === 0) return

  container.style.display = 'block'

  const rows = suggestions.map(sug => {
    const color = TYPE_COLORS[sug.suggestionType] || '#a855f7'
    const variant = sug.variants?.[0]
    const variantPreview = variant ? escapeHTML(variant.text.slice(0, 60)) : ''
    const confidence = sug.confidence ? `${Math.round(sug.confidence * 100)}%` : ''

    return `
      <div data-result-id="${sug.id}" style="padding:8px;border:1px solid #27272a;border-radius:6px;margin-bottom:4px;cursor:pointer;transition:background 0.1s;" onmouseenter="this.style.background='#27272a'" onmouseleave="this.style.background='transparent'">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
          <span style="font-size:10px;color:#9AA0A6;text-transform:uppercase;letter-spacing:0.04em;">${sug.suggestionType}</span>
          ${confidence ? `<span style="font-size:10px;color:#52525b;">${confidence}</span>` : ''}
          <div style="flex:1;"></div>
          <button data-accept="${sug.id}" style="padding:2px 8px;border:none;border-radius:4px;background:#16A34A;color:#fff;font-size:10px;cursor:pointer;">Accept</button>
          <button data-dismiss="${sug.id}" style="padding:2px 8px;border:none;border-radius:4px;background:#374151;color:#e4e4e7;font-size:10px;cursor:pointer;">Dismiss</button>
        </div>
        <div style="font-size:11px;color:#a1a1aa;margin-bottom:2px;">"${escapeHTML(sug.spanText.slice(0, 50))}${sug.spanText.length > 50 ? '...' : ''}"</div>
        <div style="font-size:11px;color:#d4d4d8;line-height:1.4;">${escapeHTML(sug.explanation)}</div>
        ${variantPreview ? `<div style="font-size:11px;color:#22c55e;margin-top:4px;">&rarr; ${variantPreview}${(variant?.text?.length ?? 0) > 60 ? '...' : ''}</div>` : ''}
      </div>
    `
  }).join('')

  safeSetInnerHTML(container, `
    <div style="margin-top:8px;border-top:1px solid #27272a;padding-top:8px;">
      <div style="font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Suggestions</div>
      ${rows}
    </div>
  `)

  // Wire up events
  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement

    // Accept button
    const acceptId = target.dataset.accept || target.closest('[data-accept]')?.getAttribute('data-accept')
    if (acceptId) {
      e.stopPropagation()
      const sug = state.suggestions.find(s => s.id === acceptId)
      if (sug) {
        const newText = sug.variants?.[0]?.text || sug.spanText
        acceptSuggestion(acceptId, newText)
        target.closest('[data-result-id]')?.remove()
      }
      return
    }

    // Dismiss button
    const dismissId = target.dataset.dismiss || target.closest('[data-dismiss]')?.getAttribute('data-dismiss')
    if (dismissId) {
      e.stopPropagation()
      dismissSuggestion(dismissId)
      target.closest('[data-result-id]')?.remove()
      return
    }

    // Row click → scroll to text
    const row = target.closest('[data-result-id]') as HTMLElement
    if (row?.dataset.resultId) {
      const sug = state.suggestions.find(s => s.id === row.dataset.resultId)
      if (sug) scrollToTextInGoogleDoc(sug.spanText)
    }
  })
}

function renderFindingsPanel(findings: Array<{
  id: string; spanText: string; severity: string; finding: string; suggestion?: string
}>, summary?: string): void {
  const container = toolbarEl?.querySelector('[data-results]') as HTMLElement
  if (!container || findings.length === 0) return

  container.style.display = 'block'

  const summaryHtml = summary
    ? `<div style="font-size:12px;color:#a1a1aa;margin-bottom:8px;line-height:1.5;">${escapeHTML(summary)}</div>`
    : ''

  const rows = findings.map(f => {
    const color = SEVERITY_COLORS[f.severity] || '#3b82f6'
    return `
      <div data-result-id="${f.id}" style="padding:8px;border:1px solid #27272a;border-radius:6px;margin-bottom:4px;cursor:pointer;transition:background 0.1s;" onmouseenter="this.style.background='#27272a'" onmouseleave="this.style.background='transparent'">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
          <span style="font-size:10px;color:${color};text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">${f.severity}</span>
          <div style="flex:1;"></div>
          <button data-dismiss="${f.id}" style="padding:2px 8px;border:none;border-radius:4px;background:#374151;color:#e4e4e7;font-size:10px;cursor:pointer;">Dismiss</button>
        </div>
        <div style="font-size:11px;color:#a1a1aa;margin-bottom:2px;">"${escapeHTML(f.spanText.slice(0, 50))}${f.spanText.length > 50 ? '...' : ''}"</div>
        <div style="font-size:11px;color:#d4d4d8;line-height:1.4;">${escapeHTML(f.finding)}</div>
        ${f.suggestion ? `<div style="font-size:11px;color:#6366F1;margin-top:4px;">Suggestion: ${escapeHTML(f.suggestion)}</div>` : ''}
      </div>
    `
  }).join('')

  safeSetInnerHTML(container, `
    <div style="margin-top:8px;border-top:1px solid #27272a;padding-top:8px;">
      <div style="font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Analysis Results</div>
      ${summaryHtml}
      ${rows}
    </div>
  `)

  // Wire up events
  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement

    const dismissId = target.dataset.dismiss || target.closest('[data-dismiss]')?.getAttribute('data-dismiss')
    if (dismissId) {
      e.stopPropagation()
      dismissSuggestion(dismissId)
      target.closest('[data-result-id]')?.remove()
      return
    }

    const row = target.closest('[data-result-id]') as HTMLElement
    if (row?.dataset.resultId) {
      const finding = state.findings.find(f => f.id === row.dataset.resultId)
      if (finding) scrollToTextInGoogleDoc(finding.spanText)
    }
  })
}

function clearResults(): void {
  const container = toolbarEl?.querySelector('[data-results]') as HTMLElement
  if (container) { container.style.display = 'none'; container.innerHTML = '' }
}

function updateStatus(msg: string): void {
  const el = toolbarEl?.querySelector('[data-status]') as HTMLElement
  if (el) { el.style.display = 'block'; el.textContent = msg }
}

function escapeHTML(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
