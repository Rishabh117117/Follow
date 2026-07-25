/**
 * doc-intel-pdf.js — PDF Detection & "Open in Doc Intel Viewer" Button
 *
 * Detects when the user is viewing a PDF in the browser (Chrome native viewer,
 * Adobe Acrobat extension, or any <embed type="application/pdf">).
 *
 * Shows a floating button that opens the PDF in the Workspace Doc Intel viewer
 * (a standalone page at /pdf-viewer?url=...) where full Grammarly-style
 * underlines and hover cards work natively.
 */

;(function () {
  'use strict'

  // ── PDF Detection ────────────────────────────────────────────────

  /**
   * Detect if the current page is displaying a PDF.
   * Returns { isPdf, pdfUrl } — pdfUrl is the direct URL to the PDF binary.
   */
  function detectPdfPage() {
    const url = window.location.href

    // 1. URL ending in .pdf (with optional query/hash)
    if (/\.pdf(\?[^#]*)?($|#)/i.test(url)) {
      return { isPdf: true, pdfUrl: url }
    }

    // 2. document.contentType (set by Chrome for directly-navigated PDFs)
    if (document.contentType === 'application/pdf') {
      return { isPdf: true, pdfUrl: url }
    }

    // 3. Chrome's built-in PDF viewer plugin embed
    const chromeEmbed = document.querySelector('embed#plugin')
    if (chromeEmbed && chromeEmbed.type === 'application/x-google-chrome-pdf') {
      return { isPdf: true, pdfUrl: chromeEmbed.src || url }
    }

    // 4. Standard <embed type="application/pdf">
    const embed = document.querySelector('embed[type="application/pdf"]')
    if (embed) {
      return { isPdf: true, pdfUrl: embed.src || url }
    }

    // 5. Standard <object type="application/pdf">
    const obj = document.querySelector('object[type="application/pdf"]')
    if (obj) {
      return { isPdf: true, pdfUrl: obj.data || url }
    }

    return { isPdf: false, pdfUrl: null }
  }

  // ── Floating Button ──────────────────────────────────────────────

  let buttonHost = null
  let shadowRoot = null

  function createFloatingButton(pdfUrl) {
    // Don't create duplicate buttons
    if (buttonHost) return

    // Create isolated Shadow DOM host
    buttonHost = document.createElement('div')
    buttonHost.id = 'wa-pdf-docIntel-host'
    buttonHost.style.cssText =
      'all:initial; position:fixed; z-index:2147483646; pointer-events:none;'
    document.body.appendChild(buttonHost)

    shadowRoot = buttonHost.attachShadow({ mode: 'closed' })

    const style = document.createElement('style')
    style.textContent = getButtonStyles()
    shadowRoot.appendChild(style)

    const container = document.createElement('div')
    container.className = 'wa-pdf-btn-container'
    container.innerHTML = getButtonHTML()
    shadowRoot.appendChild(container)

    // Bind events
    const btn = container.querySelector('.wa-pdf-btn')
    const dismissBtn = container.querySelector('.wa-pdf-dismiss')

    if (btn) {
      btn.addEventListener('click', () => openInWorkspaceViewer(pdfUrl))
    }

    if (dismissBtn) {
      dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        removeFloatingButton()
        // Remember dismissal for this session
        sessionStorage.setItem('wa-pdf-dismissed', 'true')
      })
    }
  }

  function removeFloatingButton() {
    if (buttonHost) {
      buttonHost.remove()
      buttonHost = null
      shadowRoot = null
    }
  }

  function getButtonHTML() {
    return `
      <button class="wa-pdf-btn" title="Open in Workspace Doc Intel viewer for Grammarly-style analysis">
        <span class="wa-pdf-btn-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
        </span>
        <span class="wa-pdf-btn-label">Analyze PDF</span>
        <span class="wa-pdf-btn-badge">Doc Intel</span>
      </button>
      <button class="wa-pdf-dismiss" title="Dismiss">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `
  }

  function getButtonStyles() {
    return `
      .wa-pdf-btn-container {
        position: fixed;
        bottom: 24px;
        right: 24px;
        display: flex;
        align-items: center;
        gap: 6px;
        pointer-events: auto;
        animation: wa-pdf-fade-in 0.3s ease-out;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      @keyframes wa-pdf-fade-in {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .wa-pdf-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        background: linear-gradient(135deg, #7c3aed, #6d28d9);
        color: #fff;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 12px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        line-height: 1;
        box-shadow: 0 4px 20px rgba(124, 58, 237, 0.4), 0 2px 8px rgba(0,0,0,0.3);
        transition: all 0.15s ease;
        white-space: nowrap;
      }

      .wa-pdf-btn:hover {
        background: linear-gradient(135deg, #8b5cf6, #7c3aed);
        box-shadow: 0 6px 24px rgba(124, 58, 237, 0.5), 0 3px 10px rgba(0,0,0,0.4);
        transform: translateY(-1px);
      }

      .wa-pdf-btn:active {
        transform: translateY(0);
      }

      .wa-pdf-btn-icon {
        display: flex;
        align-items: center;
        opacity: 0.9;
      }

      .wa-pdf-btn-label {
        font-size: 13px;
      }

      .wa-pdf-btn-badge {
        font-size: 10px;
        padding: 2px 6px;
        background: rgba(255,255,255,0.2);
        border-radius: 6px;
        font-weight: 600;
        letter-spacing: 0.02em;
      }

      .wa-pdf-dismiss {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        background: rgba(39, 39, 42, 0.9);
        border: 1px solid rgba(63, 63, 70, 0.8);
        border-radius: 50%;
        cursor: pointer;
        color: #a1a1aa;
        transition: all 0.15s ease;
        padding: 0;
      }

      .wa-pdf-dismiss:hover {
        background: rgba(63, 63, 70, 0.9);
        color: #e4e4e7;
      }
    `
  }

  // ── Open in Workspace Viewer ─────────────────────────────────────

  async function openInWorkspaceViewer(pdfUrl) {
    let config = {}
    try {
      config = await chrome.storage.local.get(['apiUrl'])
    } catch {
      // Extension context may be invalidated
    }

    // Derive the webapp URL from the API URL (default: localhost:3000)
    const apiUrl = config.apiUrl || 'http://localhost:3001'
    // The webapp runs on port 3000 while the API runs on 3001 in dev
    const webappBase = apiUrl.replace(':3001', ':3000').replace(/\/api\/?$/, '')

    const viewerUrl =
      webappBase +
      '/pdf-viewer?url=' +
      encodeURIComponent(pdfUrl) +
      '&name=' +
      encodeURIComponent(fileNameFromUrl(pdfUrl))

    // Open in new tab
    window.open(viewerUrl, '_blank')
  }

  function fileNameFromUrl(url) {
    try {
      const pathname = new URL(url).pathname
      const segments = pathname.split('/')
      const last = segments[segments.length - 1]
      if (last && last.toLowerCase().endsWith('.pdf')) {
        return decodeURIComponent(last)
      }
    } catch {
      // ignore
    }
    return 'Document.pdf'
  }

  // ── Message Listener ─────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'openPdfInViewer') {
      const detection = detectPdfPage()
      if (detection.isPdf && detection.pdfUrl) {
        openInWorkspaceViewer(detection.pdfUrl)
        sendResponse({ ok: true })
      } else {
        sendResponse({ ok: false, error: 'Not a PDF page' })
      }
      return false
    }

    if (msg.type === 'isPdfPage') {
      const detection = detectPdfPage()
      sendResponse(detection)
      return false
    }

    // Pass through to other listeners
    return false
  })

  // ── Initialization ──────────────────────────────────────────────

  function init() {
    // Check if dismissed this session
    if (sessionStorage.getItem('wa-pdf-dismissed') === 'true') return

    const detection = detectPdfPage()
    if (detection.isPdf && detection.pdfUrl) {
      // Small delay to let the page fully render
      setTimeout(() => {
        createFloatingButton(detection.pdfUrl)
      }, 500)
    }
  }

  // Run detection
  if (document.readyState === 'complete') {
    init()
  } else {
    window.addEventListener('load', init, { once: true })
  }
})()
