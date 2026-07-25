/**
 * Doc Intel Detector — field detection, complex editor detection, text extraction.
 *
 * Ported from doc-intel-detector.js (1,434 lines → ~200 lines).
 * Handles: editable field detection, activation icon, complex editor detection,
 * text extraction (10+ Google Docs strategies), unicode normalization.
 */

// ─── Trusted Types ────────────────────────────────────────────────────────

let trustedPolicy: { createHTML: (s: string) => unknown } | null = null

export function safeSetInnerHTML(el: HTMLElement, html: string): void {
  if (!trustedPolicy) {
    try {
      if (typeof (globalThis as unknown as { trustedTypes?: { createPolicy: Function } }).trustedTypes !== 'undefined') {
        trustedPolicy = (globalThis as unknown as { trustedTypes: { createPolicy: Function } }).trustedTypes.createPolicy('waDocIntel_' + Date.now(), { createHTML: (s: string) => s })
      }
    } catch { /* CSP or policy slots exhausted */ }
  }
  if (trustedPolicy) {
    el.innerHTML = trustedPolicy.createHTML(html) as string
  } else {
    el.innerHTML = html
  }
}

// ─── Shared State ─────────────────────────────────────────────────────────

export interface DocIntelState {
  activeField: HTMLElement | null
  fieldType: string | null
  suggestions: Suggestion[]
  findings: Finding[]
  isProcessing: boolean
  toolbarVisible: boolean
  complexEditor: string | null
  complexEditorEl: HTMLElement | null
  isCanvasMode: boolean
  _cachedGDocsText: string
}

export interface Suggestion {
  id: string
  spanText: string
  suggestionType: string
  explanation: string
  confidence?: number
  variants?: { text: string }[]
}

export interface Finding {
  id: string
  spanText: string
  mode: string
  severity: string
  finding: string
  suggestion?: string
}

export const state: DocIntelState = {
  activeField: null,
  fieldType: null,
  suggestions: [],
  findings: [],
  isProcessing: false,
  toolbarVisible: false,
  complexEditor: null,
  complexEditorEl: null,
  isCanvasMode: false,
  _cachedGDocsText: '',
}

// ─── Field Detection ──────────────────────────────────────────────────────

export function isEditableField(el: Element | null): boolean {
  if (!el || el.nodeType !== 1) return false
  const tag = (el as HTMLElement).tagName
  if (tag === 'TEXTAREA') return true
  if (tag === 'INPUT' && ['text', 'search', 'url', 'email'].includes((el as HTMLInputElement).type)) return true
  if ((el as HTMLElement).isContentEditable) return true
  if (el.getAttribute('role') === 'textbox') return true
  if (el.closest?.('[contenteditable="true"]')) return true
  return false
}

export function getEditableRoot(el: HTMLElement): HTMLElement {
  if (el.isContentEditable) {
    let root = el
    while (root.parentElement?.isContentEditable) root = root.parentElement
    return root
  }
  return el.closest?.('[contenteditable="true"]') as HTMLElement || el
}

export function getFieldType(el: HTMLElement): string {
  if (el.tagName === 'TEXTAREA') return 'textarea'
  if (el.tagName === 'INPUT') return 'input'
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return 'contenteditable'
  return 'unknown'
}

// ─── Unicode Normalization ────────────────────────────────────────────────

export function normalizeChars(str: string): string {
  return (str || '')
    .replace(/[\u2018\u2019\u201A\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
}

// ─── Complex Editor Detection ─────────────────────────────────────────────

export function detectComplexEditor(): { type: string; element: HTMLElement } | null {
  const url = window.location.href

  if (url.includes('docs.google.com/document/')) {
    const selectors = ['.kix-appview-editor', '.docs-editor', '.kix-page', '[role="document"]']
    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel)
      if (el) return { type: 'google-docs', element: el }
    }
    return { type: 'google-docs', element: document.body }
  }

  if (url.includes('notion.so') || url.includes('notion.site')) {
    const el = document.querySelector<HTMLElement>('.notion-page-content, .notion-frame')
    return { type: 'notion', element: el || document.body }
  }

  if (url.includes('coda.io')) {
    const el = document.querySelector<HTMLElement>('[data-coda-ui-id="canvas"], .coda-doc-body')
    if (el) return { type: 'coda', element: el }
  }

  if (url.includes('quip.com')) {
    const el = document.querySelector<HTMLElement>('.document-content, [data-testid="document-content"]')
    if (el) return { type: 'quip', element: el }
  }

  return null
}

// ─── Text Extraction ──────────────────────────────────────────────────────

export function extractText(el: HTMLElement | null): string {
  if (state.complexEditor) {
    const text = extractTextFromComplexEditor()
    if (text?.trim()) return normalizeChars(text)
    if (el?.innerText) return normalizeChars(el.innerText)
    return ''
  }
  const type = el ? getFieldType(el) : 'unknown'
  if (type === 'textarea' || type === 'input') return (el as HTMLInputElement).value || ''
  if (type === 'contenteditable') return el?.innerText || ''
  return ''
}

function extractTextFromComplexEditor(): string {
  // Check cached text from early-capture (DOCS_modelChunk)
  const cached = (window as unknown as Record<string, { _cachedGDocsText?: string }>).__waDocIntel?._cachedGDocsText
  if (cached) return cached

  if (state.complexEditor === 'google-docs') {
    // Strategy 1: Paragraph renderers
    const paras = document.querySelectorAll('.kix-paragraphrenderer')
    if (paras.length > 0) {
      return Array.from(paras).map(p => p.textContent || '').join('\n')
    }

    // Strategy 2: Page content
    const pageContent = document.querySelector('.kix-page-content-wrapper')
    if (pageContent?.innerText) return pageContent.innerText

    // Strategy 3: Role=document
    const roleDoc = document.querySelector('[role="document"]')
    if (roleDoc?.innerText && roleDoc.innerText.length > 20) return roleDoc.innerText

    // Strategy 4: Editor container
    const editor = document.querySelector('.kix-appview-editor')
    if (editor?.innerText && editor.innerText.length > 20) return editor.innerText
  }

  if (state.complexEditor === 'notion') {
    const blocks = document.querySelectorAll('[data-block-id]')
    if (blocks.length > 0) return Array.from(blocks).map(b => b.textContent || '').join('\n')
    const content = document.querySelector('.notion-page-content')
    if (content?.innerText) return content.innerText
  }

  return state.complexEditorEl?.innerText || ''
}

// ─── Canvas Mode Detection ────────────────────────────────────────────────

export function isGDocsCanvasMode(): boolean {
  const paras = document.querySelectorAll('.kix-paragraphrenderer')
  if (paras.length > 0) return false
  const canvases = document.querySelectorAll('.kix-canvas-tile-content canvas')
  return canvases.length > 0
}

// ─── Activation Icon ──────────────────────────────────────────────────────

let activationIcon: HTMLElement | null = null

export function showActivationIcon(field: HTMLElement, shadowRoot: ShadowRoot): void {
  hideActivationIcon()
  if (state.toolbarVisible) return

  const rect = field.getBoundingClientRect()
  const icon = document.createElement('div')
  icon.className = 'wa-activation-icon'
  icon.textContent = 'W'
  icon.style.cssText = `
    position: fixed; top: ${rect.top + 4}px; left: ${rect.right - 36}px;
    width: 28px; height: 28px; border-radius: 6px; background: #6366F1;
    color: #fff; font-size: 14px; font-weight: 700; display: flex;
    align-items: center; justify-content: center; cursor: pointer;
    box-shadow: 0 1px 4px rgba(0,0,0,0.15); z-index: 9999;
    pointer-events: auto; transition: transform 0.1s;
  `
  icon.addEventListener('mouseenter', () => { icon.style.transform = 'scale(1.1)' })
  icon.addEventListener('mouseleave', () => { icon.style.transform = 'scale(1)' })

  shadowRoot.appendChild(icon)
  activationIcon = icon
}

export function hideActivationIcon(): void {
  activationIcon?.remove()
  activationIcon = null
}
