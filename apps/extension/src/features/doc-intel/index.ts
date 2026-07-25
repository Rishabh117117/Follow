/**
 * Doc Intelligence — self-initializing feature module.
 *
 * Detects editable fields, shows activation icon, and manages
 * the toolbar → API → overlay pipeline.
 */

import { state, isEditableField, getEditableRoot, getFieldType, detectComplexEditor, showActivationIcon, hideActivationIcon, isGDocsCanvasMode } from './detector'
import { showToolbar, hideToolbar } from './toolbar'
import { clearAllMarks, destroyObserver } from './overlay'
import { init as initCard } from './card'
import { detectPdfPage, showPdfButton, destroyPdfButton } from './pdf'
import { createShadowHost, getShadowRoot } from '@/content/shadow-host'

let isActive = false

function init(): void {
  if (isActive) return
  isActive = true

  // Create shadow host for doc-intel UI
  const shadow = createShadowHost()

  // Inject doc-intel styles into shadow
  const style = document.createElement('style')
  style.textContent = `
    .wa-activation-icon:hover { transform: scale(1.1); }
  `
  shadow.appendChild(style)

  // Initialize hover card system
  initCard(shadow)

  // Detect complex editor
  const complex = detectComplexEditor()
  if (complex) {
    state.complexEditor = complex.type
    state.complexEditorEl = complex.element
    state.isCanvasMode = isGDocsCanvasMode()
  }

  // Check for PDF page
  const pdf = detectPdfPage()
  if (pdf.isPdf && pdf.pdfUrl) {
    showPdfButton(pdf.pdfUrl)
    return // Don't show field detection on PDF pages
  }

  // Focus detection — show activation icon on editable fields
  document.addEventListener('focusin', handleFocusIn)
  document.addEventListener('focusout', handleFocusOut)

  // Toggle doc-intel via keyboard shortcut
  document.addEventListener('follow-toggle-doc-intel', handleToggle)

  // For complex editors (Google Docs): show toolbar on right-click with selected text
  if (complex) {
    state.activeField = complex.element
    state.fieldType = 'contenteditable'

    document.addEventListener('contextmenu', (e: MouseEvent) => {
      // Only show toolbar if text is selected
      const selection = document.getSelection()
      if (!selection || selection.isCollapsed || !selection.toString().trim()) return

      // Check if right-click is inside the editor
      const editorEl = complex.element
      if (!editorEl.contains(e.target as Node)) return

      e.preventDefault()
      hideActivationIcon()
      showToolbar(complex.element, shadow)
    })
  }
}

function handleFocusIn(e: FocusEvent): void {
  const target = e.target as HTMLElement
  if (!isEditableField(target)) return

  const field = getEditableRoot(target)
  state.activeField = field
  state.fieldType = getFieldType(field)

  const shadow = getShadowRoot()
  if (shadow && !state.toolbarVisible) {
    showActivationIcon(field, shadow)

    // Click on activation icon opens toolbar
    const icon = shadow.querySelector('.wa-activation-icon')
    if (icon) {
      icon.addEventListener('click', () => {
        hideActivationIcon()
        showToolbar(field, shadow)
      })
    }
  }
}

function handleFocusOut(): void {
  // Delay to allow clicks on activation icon
  setTimeout(() => {
    if (!state.toolbarVisible) {
      hideActivationIcon()
    }
  }, 200)
}

function handleToggle(): void {
  const shadow = getShadowRoot()
  if (!shadow) return

  if (state.toolbarVisible) {
    hideToolbar()
  } else {
    const field = state.activeField || state.complexEditorEl || document.activeElement as HTMLElement
    if (field) {
      hideActivationIcon()
      showToolbar(field, shadow)
    }
  }
}

function cleanup(): void {
  isActive = false
  hideToolbar()
  hideActivationIcon()
  clearAllMarks()
  destroyObserver()
  destroyPdfButton()
  document.removeEventListener('focusin', handleFocusIn)
  document.removeEventListener('focusout', handleFocusOut)
  document.removeEventListener('follow-toggle-doc-intel', handleToggle)
  state.activeField = null
  state.complexEditor = null
  state.complexEditorEl = null
  state.suggestions = []
  state.findings = []
}

// Auto-init
init()
document.addEventListener('follow-unload-doc-intel', cleanup)
