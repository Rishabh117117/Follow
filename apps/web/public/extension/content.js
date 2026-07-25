/**
 * Workspace Agent — Content Script
 *
 * Lightweight content script for signal capture, doc-intel, and Live indicator.
 * The primary chat experience lives in the webapp's FloatingUnit.
 * This script no longer injects a chat panel — it only:
 * - Responds to page content / selection queries
 * - Emits signals for the threads pipeline (web_navigate, ai_turn_external)
 * - Shows a green Live indicator when recording is active
 * - Supports doc-intel integration
 */

// ─── State ──────────────────────────────────────────────────────────

let chatPanelHost = null
let shadowRoot = null
let isMinimized = false
let conversationId = null
let chatHistory = []
let isStreaming = false
let abortController = null

// ─── Message Listener ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'getSelection') {
    sendResponse({ text: window.getSelection()?.toString() || '' })
    return true
  }

  if (message.type === 'getPageContent') {
    const description =
      document.querySelector('meta[name="description"]')?.getAttribute('content') || ''
    const selection = window.getSelection()?.toString() || ''
    sendResponse({
      title: document.title,
      url: window.location.href,
      content: selection || description,
    })
    return true
  }

  // Chat panel toggle — no-op (primary chat is in webapp FloatingUnit)
  if (message.type === 'toggleChatPanel' || message.type === 'ensurePanelOpen') {
    sendResponse({ ok: true })
    return true
  }

  // Let other listeners (doc-intel-detector.js, etc.) handle unrecognized messages.
  // Return false so Chrome keeps the message channel open for them.
  return false
})

// ─── Toggle Panel ──────────────────────────────────────────────────

function toggleChatPanel() {
  if (chatPanelHost) {
    if (isMinimized) {
      expandPanel()
    } else {
      removeChatPanel()
    }
  } else {
    createChatPanel()
  }
}

// ─── Remove Panel ──────────────────────────────────────────────────

function removeChatPanel() {
  if (chatPanelHost) {
    savePanelStateImmediate({ panelOpen: false })
    chatPanelHost.remove()
    chatPanelHost = null
    shadowRoot = null
    isMinimized = false
  }
}

// ─── Create Chat Panel ─────────────────────────────────────────────

async function createChatPanel() {
  if (chatPanelHost) return

  // Auto-configure dev defaults if no settings exist
  // IDs match DEV_USER/DEV_WORKSPACE from @workspace/shared/constants/dev-user.ts
  const existingConfig = await chrome.storage.local.get(['apiUrl', 'workspaceId'])
  if (!existingConfig.apiUrl && !existingConfig.workspaceId) {
    await chrome.storage.local.set({
      apiUrl: 'http://localhost:3001',
      apiKey: 'dev-bypass',
      workspaceId: '00000000-0000-0000-0000-000000000002',
      userId: '00000000-0000-0000-0000-000000000001',
    })
  }

  // Read saved panel state for restoration
  const savedState = await chrome.storage.local.get([
    'panelPosition',
    'panelSize',
    'panelMinimized',
    'inputDraft',
    'settingsOpen',
  ])

  chatPanelHost = document.createElement('div')
  chatPanelHost.id = 'workspace-agent-host'
  chatPanelHost.style.cssText = 'all:initial; position:fixed; z-index:2147483646;'
  document.body.appendChild(chatPanelHost)

  shadowRoot = chatPanelHost.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = getPanelStyles()
  shadowRoot.appendChild(style)

  const panel = document.createElement('div')
  panel.id = 'wa-panel'
  // Use Trusted Types policy for Google Docs CSP compatibility
  if (window.__waDocIntelHelpers && window.__waDocIntelHelpers.safeSetInnerHTML) {
    window.__waDocIntelHelpers.safeSetInnerHTML(panel, getPanelHTML())
  } else {
    try { panel.innerHTML = getPanelHTML() }
    catch (e) {
      // Trusted Types fallback — create inline policy
      try {
        const p = trustedTypes.createPolicy('waContent', { createHTML: s => s })
        panel.innerHTML = p.createHTML(getPanelHTML())
      } catch (e2) { panel.innerHTML = getPanelHTML() }
    }
  }

  // Restore saved position
  if (savedState.panelPosition) {
    let { left, top } = savedState.panelPosition
    // Viewport clamping — ensure panel isn't off-screen
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pw = savedState.panelSize?.width || 400
    const ph = savedState.panelSize?.height || 520
    left = Math.max(0, Math.min(left, vw - Math.min(pw, 100)))
    top = Math.max(0, Math.min(top, vh - Math.min(ph, 60)))
    panel.style.left = left + 'px'
    panel.style.top = top + 'px'
    panel.style.right = 'auto'
    panel.style.bottom = 'auto'
  }

  // Restore saved size
  if (savedState.panelSize) {
    panel.style.width = savedState.panelSize.width + 'px'
    panel.style.height = savedState.panelSize.height + 'px'
  }

  shadowRoot.appendChild(panel)

  setupDrag(panel)
  setupResize(panel)
  bindEvents(panel)

  // Load chat history from storage (must await to ensure conversationId is set before user sends)
  await loadChatHistory()

  // Restore minimized state
  if (savedState.panelMinimized) {
    minimizePanel()
  }

  // Restore input draft
  if (savedState.inputDraft) {
    const input = panel.querySelector('#wa-input')
    if (input) {
      input.value = savedState.inputDraft
      input.style.height = 'auto'
      input.style.height = Math.min(input.scrollHeight, 100) + 'px'
    }
  }

  // Restore settings panel visibility
  if (savedState.settingsOpen) {
    openSettings(panel)
  }

  // Mark panel as open in storage
  chrome.storage.local.set({ panelOpen: true })
}

// ─── Panel HTML ────────────────────────────────────────────────────

function getPanelHTML() {
  return `
    <div class="wa-titlebar" id="wa-titlebar">
      <div class="wa-title-left">
        <span class="wa-logo">W</span>
        <span class="wa-title-text">Workspace Agent</span>
        <span class="wa-live-indicator" id="wa-live-indicator" title="Live recording"></span>
      </div>
      <div class="wa-title-actions">
        <button class="wa-btn-icon" id="wa-newchat-btn" title="New Chat">+</button>
        <button class="wa-btn-icon" id="wa-settings-btn" title="Settings">⚙</button>
        <button class="wa-btn-icon" id="wa-minimize-btn" title="Minimize">−</button>
        <button class="wa-btn-icon wa-close" id="wa-close-btn" title="Close">×</button>
      </div>
    </div>
    <div class="wa-messages" id="wa-messages">
      <div class="wa-welcome">
        <div class="wa-welcome-icon">W</div>
        <div class="wa-welcome-title">Workspace Agent</div>
        <div class="wa-welcome-text">Ask me anything about what you're working on. I can see your current page.</div>
      </div>
    </div>
    <div class="wa-input-area" id="wa-input-area">
      <div class="wa-input-top-row">
        <div class="wa-screenshot-indicator" id="wa-screenshot-indicator" style="display:none">
          📸 Page context will be attached
        </div>
        <button class="wa-live-toggle" id="wa-live-toggle" title="Toggle live recording">
          <span class="wa-live-dot" id="wa-live-dot"></span>
          <span class="wa-live-label" id="wa-live-label">Off</span>
        </button>
      </div>
      <div class="wa-input-row">
        <textarea class="wa-input" id="wa-input" placeholder="Ask about this page..." rows="1"></textarea>
        <button class="wa-send-btn" id="wa-send-btn" title="Send">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="wa-settings-panel" id="wa-settings-panel" style="display:none">
      <div class="wa-settings-title">Extension Settings</div>
      <div class="wa-field">
        <label>API URL</label>
        <input type="text" id="wa-api-url" placeholder="http://localhost:3001" />
      </div>
      <div class="wa-field">
        <label>API Key</label>
        <input type="password" id="wa-api-key" placeholder="wsp_..." />
      </div>
      <div class="wa-field">
        <label>Workspace ID</label>
        <input type="text" id="wa-workspace-id" placeholder="UUID" />
      </div>
      <div class="wa-field">
        <label>User ID</label>
        <input type="text" id="wa-user-id" placeholder="UUID (optional)" />
      </div>
      <div class="wa-field">
        <label style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="wa-live-enabled" />
          Enable live recording
        </label>
      </div>
      <div class="wa-field">
        <label style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="wa-doc-intel-enabled" />
          Enable Document Intelligence (Ctrl+Shift+G)
        </label>
      </div>
      <button class="wa-save-settings" id="wa-save-settings">Save</button>
      <button class="wa-cancel-settings" id="wa-cancel-settings">Cancel</button>
    </div>
    <div class="wa-resize-handle" id="wa-resize-handle"></div>
  `
}

// ─── Panel Styles ──────────────────────────────────────────────────

function getPanelStyles() {
  return `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      color: #e4e4e7;
    }

    #wa-panel {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 400px;
      height: 520px;
      background: #18181b;
      border: 1px solid #3f3f46;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,58,237,0.1);
      transition: opacity 0.15s ease, transform 0.15s ease;
    }

    #wa-panel.wa-minimized {
      width: 48px;
      height: 48px;
      border-radius: 24px;
      cursor: pointer;
      overflow: hidden;
    }

    #wa-panel.wa-minimized .wa-titlebar,
    #wa-panel.wa-minimized .wa-messages,
    #wa-panel.wa-minimized .wa-input-area,
    #wa-panel.wa-minimized .wa-settings-panel,
    #wa-panel.wa-minimized .wa-resize-handle {
      display: none;
    }

    #wa-panel.wa-minimized::before {
      content: 'W';
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      background: #7c3aed;
      color: white;
      font-size: 18px;
      font-weight: 700;
      border-radius: 24px;
    }

    .wa-titlebar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: #1f1f23;
      border-bottom: 1px solid #3f3f46;
      cursor: grab;
      user-select: none;
      flex-shrink: 0;
    }

    .wa-titlebar:active { cursor: grabbing; }

    .wa-title-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .wa-logo {
      width: 24px;
      height: 24px;
      background: #7c3aed;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      color: white;
      flex-shrink: 0;
    }

    .wa-title-text {
      font-size: 13px;
      font-weight: 600;
      color: #e4e4e7;
    }

    .wa-live-indicator {
      display: none;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      flex-shrink: 0;
    }
    .wa-live-indicator.active {
      display: block;
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7);
      animation: wa-live-glow 2s infinite;
    }
    @keyframes wa-live-glow {
      0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
      70% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
      100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
    }

    .wa-title-actions {
      display: flex;
      gap: 4px;
    }

    .wa-btn-icon {
      background: none;
      border: none;
      color: #71717a;
      font-size: 16px;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      cursor: pointer;
      padding: 0;
    }
    .wa-btn-icon:hover { background: #27272a; color: #a1a1aa; }
    .wa-close:hover { background: #7f1d1d; color: #fca5a5; }

    .wa-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .wa-messages::-webkit-scrollbar { width: 4px; }
    .wa-messages::-webkit-scrollbar-track { background: transparent; }
    .wa-messages::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 2px; }

    .wa-welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      text-align: center;
    }

    .wa-welcome-icon {
      width: 48px;
      height: 48px;
      background: #7c3aed;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: 700;
      color: white;
      margin-bottom: 12px;
    }

    .wa-welcome-title {
      font-size: 16px;
      font-weight: 600;
      color: #e4e4e7;
      margin-bottom: 6px;
    }

    .wa-welcome-text {
      font-size: 12px;
      color: #71717a;
      line-height: 1.5;
      max-width: 280px;
    }

    .wa-msg {
      max-width: 90%;
      padding: 8px 12px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
    }

    .wa-msg-user {
      align-self: flex-end;
      background: #7c3aed;
      color: white;
      border-bottom-right-radius: 4px;
    }

    .wa-msg-user .wa-msg-context {
      font-size: 10px;
      opacity: 0.7;
      margin-top: 4px;
    }

    .wa-msg-assistant {
      align-self: flex-start;
      background: #27272a;
      color: #e4e4e7;
      border-bottom-left-radius: 4px;
    }

    .wa-msg-assistant code {
      background: #3f3f46;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 12px;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
    }

    .wa-msg-assistant pre {
      background: #09090b;
      border: 1px solid #3f3f46;
      border-radius: 6px;
      padding: 8px;
      overflow-x: auto;
      margin: 6px 0;
    }

    .wa-msg-assistant pre code {
      background: none;
      padding: 0;
      font-size: 11px;
      line-height: 1.5;
    }

    .wa-msg-assistant a {
      color: #a78bfa;
      text-decoration: underline;
    }

    .wa-msg-assistant strong { color: #f4f4f5; }
    .wa-msg-assistant em { color: #a1a1aa; }

    .wa-msg-assistant ul, .wa-msg-assistant ol {
      margin: 4px 0;
      padding-left: 16px;
    }

    .wa-msg-assistant li {
      margin: 2px 0;
    }

    .wa-typing {
      align-self: flex-start;
      padding: 8px 12px;
    }

    .wa-typing-dots {
      display: flex;
      gap: 4px;
    }

    .wa-typing-dots span {
      width: 6px;
      height: 6px;
      background: #71717a;
      border-radius: 50%;
      animation: wa-pulse 1.2s ease-in-out infinite;
    }
    .wa-typing-dots span:nth-child(2) { animation-delay: 0.2s; }
    .wa-typing-dots span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes wa-pulse {
      0%, 100% { opacity: 0.3; }
      50% { opacity: 1; }
    }

    .wa-input-area {
      padding: 8px 12px;
      border-top: 1px solid #3f3f46;
      background: #1f1f23;
      flex-shrink: 0;
    }

    .wa-input-top-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }

    .wa-screenshot-indicator {
      font-size: 10px;
      color: #a78bfa;
      padding: 2px 0;
    }

    .wa-live-toggle {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border-radius: 999px;
      border: 1px solid #3f3f46;
      background: rgba(39,39,42,0.5);
      color: #71717a;
      font-size: 11px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-left: auto;
    }
    .wa-live-toggle:hover {
      background: #27272a;
      color: #a1a1aa;
    }
    .wa-live-toggle.active {
      border-color: rgba(22,101,52,0.5);
      background: rgba(20,83,45,0.3);
      color: #4ade80;
    }
    .wa-live-toggle.active:hover {
      background: rgba(20,83,45,0.5);
    }

    .wa-live-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #52525b;
      flex-shrink: 0;
      transition: all 0.2s ease;
    }
    .wa-live-toggle.active .wa-live-dot {
      background: #22c55e;
      box-shadow: 0 0 8px rgba(34,197,94,0.6);
      animation: wa-live-glow 2s infinite;
    }

    .wa-input-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    .wa-input {
      flex: 1;
      background: #27272a;
      border: 1px solid #3f3f46;
      color: #e4e4e7;
      padding: 8px 10px;
      border-radius: 8px;
      font-size: 13px;
      font-family: inherit;
      resize: none;
      max-height: 100px;
      overflow-y: auto;
      line-height: 1.4;
    }
    .wa-input:focus { outline: none; border-color: #7c3aed; }
    .wa-input::placeholder { color: #52525b; }

    .wa-send-btn {
      width: 32px;
      height: 32px;
      background: #7c3aed;
      border: none;
      border-radius: 8px;
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      padding: 0;
    }
    .wa-send-btn:hover { background: #6d28d9; }
    .wa-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .wa-send-btn.wa-stop { background: #dc2626; }
    .wa-send-btn.wa-stop:hover { background: #b91c1c; }

    .wa-settings-panel {
      position: absolute;
      inset: 0;
      background: #18181b;
      z-index: 10;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      overflow-y: auto;
    }

    .wa-settings-title {
      font-size: 14px;
      font-weight: 600;
      color: #a78bfa;
      margin-bottom: 4px;
    }

    .wa-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .wa-field label {
      font-size: 11px;
      color: #a1a1aa;
    }

    .wa-field input[type="text"],
    .wa-field input[type="password"] {
      background: #27272a;
      border: 1px solid #3f3f46;
      color: #e4e4e7;
      padding: 6px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-family: inherit;
    }
    .wa-field input:focus { outline: none; border-color: #7c3aed; }

    .wa-field input[type="checkbox"] {
      accent-color: #7c3aed;
    }

    .wa-save-settings, .wa-cancel-settings {
      padding: 8px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
    }

    .wa-save-settings {
      background: #7c3aed;
      color: white;
    }
    .wa-save-settings:hover { background: #6d28d9; }

    .wa-cancel-settings {
      background: #27272a;
      color: #a1a1aa;
      border: 1px solid #3f3f46;
    }
    .wa-cancel-settings:hover { background: #3f3f46; }

    .wa-resize-handle {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
    }

    .wa-resize-handle::before {
      content: '';
      position: absolute;
      bottom: 4px;
      right: 4px;
      width: 8px;
      height: 8px;
      border-right: 2px solid #52525b;
      border-bottom: 2px solid #52525b;
    }
  `
}

// ─── Drag Support ──────────────────────────────────────────────────

function setupDrag(panel) {
  const titlebar = panel.querySelector('#wa-titlebar')
  let isDragging = false
  let startX, startY, origX, origY

  titlebar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.wa-btn-icon')) return
    isDragging = true
    startX = e.clientX
    startY = e.clientY
    const rect = panel.getBoundingClientRect()
    origX = rect.left
    origY = rect.top

    const onMouseMove = (e) => {
      if (!isDragging) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      panel.style.left = origX + dx + 'px'
      panel.style.top = origY + dy + 'px'
      panel.style.right = 'auto'
      panel.style.bottom = 'auto'
    }

    const onMouseUp = () => {
      isDragging = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      savePanelState()
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  })
}

// ─── Resize Support ────────────────────────────────────────────────

function setupResize(panel) {
  const handle = panel.querySelector('#wa-resize-handle')
  let isResizing = false

  handle.addEventListener('mousedown', (e) => {
    isResizing = true
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startW = panel.offsetWidth
    const startH = panel.offsetHeight

    const onMouseMove = (e) => {
      if (!isResizing) return
      const w = Math.max(320, startW + (e.clientX - startX))
      const h = Math.max(300, startH + (e.clientY - startY))
      panel.style.width = w + 'px'
      panel.style.height = h + 'px'
    }

    const onMouseUp = () => {
      isResizing = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      savePanelState()
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  })
}

// ─── Minimize / Expand ─────────────────────────────────────────────

function minimizePanel() {
  const panel = shadowRoot?.querySelector('#wa-panel')
  if (!panel) return
  panel.classList.add('wa-minimized')
  isMinimized = true
  savePanelStateImmediate()

  // Click to expand
  panel.addEventListener('click', handleMinimizedClick)
}

function expandPanel() {
  const panel = shadowRoot?.querySelector('#wa-panel')
  if (!panel) return
  panel.classList.remove('wa-minimized')
  isMinimized = false
  savePanelStateImmediate()
  panel.removeEventListener('click', handleMinimizedClick)
}

function handleMinimizedClick() {
  expandPanel()
}

// ─── Bind UI Events ────────────────────────────────────────────────

function bindEvents(panel) {
  // Close
  panel.querySelector('#wa-close-btn').addEventListener('click', removeChatPanel)

  // Minimize
  panel.querySelector('#wa-minimize-btn').addEventListener('click', minimizePanel)

  // New Chat
  panel.querySelector('#wa-newchat-btn').addEventListener('click', () => startNewChat(panel))

  // Settings
  panel.querySelector('#wa-settings-btn').addEventListener('click', () => openSettings(panel))
  panel.querySelector('#wa-save-settings').addEventListener('click', () => saveSettings(panel))
  panel.querySelector('#wa-cancel-settings').addEventListener('click', () => closeSettings(panel))

  // Input auto-grow + save draft
  const input = panel.querySelector('#wa-input')
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = Math.min(input.scrollHeight, 100) + 'px'
    savePanelState()
  })

  // Enter to send
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(panel)
    }
  })

  // Send button
  panel.querySelector('#wa-send-btn').addEventListener('click', () => {
    if (isStreaming) {
      stopStreaming()
    } else {
      sendMessage(panel)
    }
  })

  // Show screenshot indicator on focus
  input.addEventListener('focus', () => {
    panel.querySelector('#wa-screenshot-indicator').style.display = 'block'
  })

  // Live toggle button
  panel.querySelector('#wa-live-toggle').addEventListener('click', () => {
    toggleLiveRecording()
  })
}

// ─── Settings ──────────────────────────────────────────────────────

async function openSettings(panel) {
  const config = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'getConfig' }, resolve)
  })
  const { liveEnabled, docIntelEnabled } = await chrome.storage.local.get(['liveEnabled', 'docIntelEnabled'])

  panel.querySelector('#wa-api-url').value = config?.apiUrl || ''
  panel.querySelector('#wa-api-key').value = config?.apiKey || ''
  panel.querySelector('#wa-workspace-id').value = config?.workspaceId || ''
  panel.querySelector('#wa-user-id').value = config?.userId || ''
  panel.querySelector('#wa-live-enabled').checked = !!liveEnabled
  panel.querySelector('#wa-doc-intel-enabled').checked = !!docIntelEnabled
  panel.querySelector('#wa-settings-panel').style.display = 'flex'
}

async function saveSettings(panel) {
  const apiUrl = panel.querySelector('#wa-api-url').value.trim()
  const apiKey = panel.querySelector('#wa-api-key').value.trim()
  const workspaceId = panel.querySelector('#wa-workspace-id').value.trim()
  const userId = panel.querySelector('#wa-user-id').value.trim()
  const liveEnabled = panel.querySelector('#wa-live-enabled').checked
  const docIntelEnabled = panel.querySelector('#wa-doc-intel-enabled').checked

  await chrome.storage.local.set({ apiUrl, apiKey, workspaceId, userId, docIntelEnabled })
  chrome.runtime.sendMessage({ type: 'setLiveEnabled', enabled: liveEnabled })

  panel.querySelector('#wa-settings-panel').style.display = 'none'
}

function closeSettings(panel) {
  panel.querySelector('#wa-settings-panel').style.display = 'none'
}

// ─── Chat Messages ─────────────────────────────────────────────────

function addMessageToUI(panel, role, content, contextLabel) {
  const messagesEl = panel.querySelector('#wa-messages')

  // Remove welcome message if present
  const welcome = messagesEl.querySelector('.wa-welcome')
  if (welcome) welcome.remove()

  const msg = document.createElement('div')
  msg.className = `wa-msg wa-msg-${role}`

  if (role === 'assistant') {
    msg.innerHTML = renderMarkdown(content)
  } else {
    msg.textContent = content
    if (contextLabel) {
      const ctx = document.createElement('div')
      ctx.className = 'wa-msg-context'
      ctx.textContent = contextLabel
      msg.appendChild(ctx)
    }
  }

  messagesEl.appendChild(msg)
  messagesEl.scrollTop = messagesEl.scrollHeight
  return msg
}

function showTypingIndicator(panel) {
  const messagesEl = panel.querySelector('#wa-messages')
  const typing = document.createElement('div')
  typing.className = 'wa-typing'
  typing.id = 'wa-typing'
  typing.innerHTML = '<div class="wa-typing-dots"><span></span><span></span><span></span></div>'
  messagesEl.appendChild(typing)
  messagesEl.scrollTop = messagesEl.scrollHeight
  return typing
}

function removeTypingIndicator(panel) {
  const typing = panel.querySelector('#wa-typing')
  if (typing) typing.remove()
}

// ─── Send Message (with auto-screenshot) ───────────────────────────

async function sendMessage(panel) {
  const input = panel.querySelector('#wa-input')
  const text = input.value.trim()
  if (!text || isStreaming) return

  input.value = ''
  input.style.height = 'auto'

  // Get config
  let config = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'getConfig' }, resolve)
  })

  // Auto-configure for local dev if no settings exist
  // IDs match DEV_USER/DEV_WORKSPACE from @workspace/shared/constants/dev-user.ts
  if (!config?.apiUrl || !config?.workspaceId) {
    const devDefaults = {
      apiUrl: 'http://localhost:3001',
      apiKey: 'dev-bypass',
      workspaceId: '00000000-0000-0000-0000-000000000002',
      userId: '00000000-0000-0000-0000-000000000001',
    }
    await chrome.storage.local.set(devDefaults)
    config = devDefaults
  }

  // Show user message with context label
  addMessageToUI(panel, 'user', text, '🖼 Page context attached')

  // Show screenshot indicator flash
  const indicator = panel.querySelector('#wa-screenshot-indicator')
  indicator.textContent = '📸 Capturing page context...'
  indicator.style.display = 'block'

  // Capture screenshot (Step 5: auto-attach on every message)
  let screenshot = null
  let tabInfo = null
  try {
    const [screenshotResult, tabResult] = await Promise.all([
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'captureScreenshot' }, resolve)
      }),
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'getTabInfo' }, resolve)
      }),
    ])
    screenshot = screenshotResult?.screenshot || null
    tabInfo = tabResult || {}
  } catch {
    // Screenshot capture failed — send without it
  }

  indicator.style.display = 'none'

  // Build payload — fallback ID matches DEV_USER.id from @workspace/shared/constants/dev-user.ts
  const payload = {
    workspaceId: config.workspaceId,
    userId: config.userId || '00000000-0000-0000-0000-000000000001',
    conversationId,
    message: text,
    source: 'web_extension',
    attachments: [],
  }

  if (screenshot) {
    payload.attachments.push({
      type: 'screenshot',
      data: screenshot,
      metadata: {
        url: tabInfo?.url || window.location.href,
        title: tabInfo?.title || document.title,
        capturedAt: new Date().toISOString(),
      },
    })
  }

  // Show typing indicator
  showTypingIndicator(panel)

  // Update send button to stop
  const sendBtn = panel.querySelector('#wa-send-btn')
  sendBtn.classList.add('wa-stop')
  sendBtn.innerHTML = '■'
  isStreaming = true
  abortController = new AbortController()

  try {
    // If no conversationId, create one first
    if (!conversationId) {
      const convResponse = await fetch(`${config.apiUrl}/api/chat/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          'x-user-id': payload.userId,
          'x-workspace-id': config.workspaceId,
        },
        body: JSON.stringify({
          workspaceId: config.workspaceId,
          title: text.slice(0, 50),
          type: 'standard',
        }),
      })
      const convData = await convResponse.json()
      conversationId = convData.data?.id
      payload.conversationId = conversationId
      // Persist conversationId immediately so it survives errors/page changes
      chrome.storage.local.set({ conversationId })
    }

    // Send message and stream response
    const response = await fetch(
      `${config.apiUrl}/api/chat/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          'x-user-id': payload.userId,
          'x-workspace-id': config.workspaceId,
        },
        body: JSON.stringify({
          content: text,
          attachments: payload.attachments.map((a) => ({
            imageData: a.data,
            imageSource: 'screenshot',
            metadata: a.metadata,
          })),
          source: 'web_extension',
        }),
        signal: abortController.signal,
      }
    )

    if (!response.ok) {
      // If conversation not found (e.g. DB reset), clear stale ID and retry
      if (response.status === 404) {
        conversationId = null
        chrome.storage.local.set({ conversationId: null })
        removeTypingIndicator(panel)
        addMessageToUI(
          panel,
          'assistant',
          'Previous session expired. Please send your message again.'
        )
        return
      }
      const errText = await response.text().catch(() => '')
      throw new Error(`Chat request failed (${response.status}): ${errText.slice(0, 200)}`)
    }

    // Remove typing, create assistant message
    removeTypingIndicator(panel)
    const assistantMsg = addMessageToUI(panel, 'assistant', '')

    // Parse SSE stream
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          if (parsed.type === 'token' && parsed.content) {
            fullText += parsed.content
            assistantMsg.innerHTML = renderMarkdown(fullText)
            const messagesEl = panel.querySelector('#wa-messages')
            messagesEl.scrollTop = messagesEl.scrollHeight
          }
        } catch {
          // Non-JSON line, skip
        }
      }
    }

    // Save to history
    chatHistory.push({ role: 'user', content: text }, { role: 'assistant', content: fullText })
    saveChatHistory()
  } catch (err) {
    removeTypingIndicator(panel)
    if (err.name !== 'AbortError') {
      addMessageToUI(panel, 'assistant', `Error: ${err.message}`)
    }
  } finally {
    isStreaming = false
    abortController = null
    sendBtn.classList.remove('wa-stop')
    sendBtn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13"/></svg>'
  }
}

function stopStreaming() {
  if (abortController) {
    abortController.abort()
  }
}

// ─── Markdown Rendering (lightweight) ──────────────────────────────

function renderMarkdown(text) {
  if (!text) return ''

  let html = text
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Headers
    .replace(/^### (.+)$/gm, '<strong>$1</strong>')
    .replace(/^## (.+)$/gm, '<strong style="font-size:14px">$1</strong>')
    .replace(/^# (.+)$/gm, '<strong style="font-size:15px">$1</strong>')
    // Unordered lists
    .replace(/^[*-] (.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')

  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>(?:<br>)?)+/g, (match) => {
    return '<ul>' + match.replace(/<br>/g, '') + '</ul>'
  })

  return '<p>' + html + '</p>'
}

// ─── Chat History Persistence ──────────────────────────────────────

async function loadChatHistory() {
  const result = await chrome.storage.local.get(['chatHistory', 'conversationId'])
  chatHistory = result.chatHistory || []
  conversationId = result.conversationId || null

  if (chatHistory.length > 0 && shadowRoot) {
    const panel = shadowRoot.querySelector('#wa-panel')
    // Hide welcome message when we have chat history
    const welcome = panel.querySelector('.wa-welcome')
    if (welcome) welcome.style.display = 'none'
    for (const msg of chatHistory.slice(-50)) {
      addMessageToUI(panel, msg.role, msg.content)
    }
  }

  // Load live indicator state
  updateLiveIndicator()
}

function saveChatHistory() {
  // Keep last 50 messages
  const trimmed = chatHistory.slice(-50)
  chrome.storage.local.set({ chatHistory: trimmed, conversationId })
}

function startNewChat(panel) {
  // Reset conversation state
  conversationId = null
  chatHistory = []
  chrome.storage.local.set({ chatHistory: [], conversationId: null })

  // Clear messages and show welcome screen
  const messagesEl = panel.querySelector('#wa-messages')
  messagesEl.innerHTML = `
    <div class="wa-welcome">
      <div class="wa-welcome-icon">W</div>
      <div class="wa-welcome-title">Workspace Agent</div>
      <div class="wa-welcome-text">Ask me anything about what you're working on. I can see your current page.</div>
    </div>
  `

  // Clear input
  const input = panel.querySelector('#wa-input')
  if (input) {
    input.value = ''
    input.style.height = 'auto'
  }
}

// ─── Live Recording Toggle ──────────────────────────────────────

async function toggleLiveRecording() {
  const { liveEnabled } = await chrome.storage.local.get('liveEnabled')
  const newState = !liveEnabled
  // Tell background service worker to start/stop capture loop
  chrome.runtime.sendMessage({ type: 'setLiveEnabled', enabled: newState })
  // Broadcast to the page so the webapp can pick up the live state change
  window.postMessage({ type: 'workspace-live-state', liveEnabled: newState }, '*')
  // UI updates happen via the storage.onChanged listener
}

async function updateLiveIndicator() {
  if (!shadowRoot) return

  const { liveEnabled } = await chrome.storage.local.get('liveEnabled')

  // Update title bar dot
  const indicator = shadowRoot.querySelector('#wa-live-indicator')
  if (indicator) {
    if (liveEnabled) {
      indicator.classList.add('active')
    } else {
      indicator.classList.remove('active')
    }
  }

  // Update toggle button
  const toggle = shadowRoot.querySelector('#wa-live-toggle')
  const label = shadowRoot.querySelector('#wa-live-label')
  if (toggle) {
    if (liveEnabled) {
      toggle.classList.add('active')
      toggle.title = 'Stop live recording'
    } else {
      toggle.classList.remove('active')
      toggle.title = 'Toggle live recording'
    }
  }
  if (label) {
    label.textContent = liveEnabled ? 'Live' : 'Off'
  }
}

// Listen for live state changes from popup or background
chrome.storage.onChanged.addListener((changes) => {
  if (changes.liveEnabled) {
    updateLiveIndicator()
    // Broadcast to page so webapp Zustand store can sync
    window.postMessage(
      {
        type: 'workspace-live-state',
        liveEnabled: !!changes.liveEnabled.newValue,
      },
      '*'
    )
  }
  // Sync conversation state from popup
  if (changes.conversationId && changes.conversationId.newValue !== conversationId) {
    conversationId = changes.conversationId.newValue
  }
})

// Listen for live state requests from the webapp
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.data?.type === 'workspace-get-live-state') {
    chrome.storage.local.get('liveEnabled', ({ liveEnabled }) => {
      window.postMessage(
        {
          type: 'workspace-live-state',
          liveEnabled: !!liveEnabled,
        },
        '*'
      )
    })
  }
  // Webapp can toggle live via extension
  if (event.data?.type === 'workspace-set-live-state') {
    chrome.runtime.sendMessage({
      type: 'setLiveEnabled',
      enabled: !!event.data.liveEnabled,
    })
  }

  // ─── Extension Delegation: Webapp → Extension ─────────────────
  // The webapp pings to check if the extension is installed
  if (event.data?.type === 'workspace-ping-extension') {
    window.postMessage({ type: 'workspace-extension-pong' }, '*')
  }

  // Webapp tells extension to start live capture with its sessionId
  // so the extension captures whichever tab is active (follows tab focus)
  if (event.data?.type === 'workspace-start-live') {
    chrome.runtime.sendMessage({
      type: 'webappStartLive',
      sessionId: event.data.sessionId,
      workspaceId: event.data.workspaceId,
      userId: event.data.userId,
    })
  }

  // Webapp tells extension to stop live capture
  if (event.data?.type === 'workspace-stop-live') {
    chrome.runtime.sendMessage({ type: 'webappStopLive' })
  }
})

// ─── Save State Before Navigation ──────────────────────────────────

window.addEventListener('beforeunload', () => {
  if (chatPanelHost) {
    savePanelStateImmediate()
  }
})

// ─── Auto-Inject Panel on Page Load ────────────────────────────────
// If the user had the panel open, recreate it automatically when the
// content script loads on a new page or tab.
;(async () => {
  try {
    const { panelOpen } = await chrome.storage.local.get('panelOpen')
    if (panelOpen && !chatPanelHost) {
      createChatPanel()
    }
  } catch {
    // Extension context may be invalidated — silently ignore
  }
})()

// ═══════════════════════════════════════════════════════════════════════
// ─── Signal Tracking (Threads & Strands) ─────────────────────────────
// Emits visibility, scroll, selection, and external AI turn signals
// to background.js for the signal capture pipeline. Does NOT touch
// the chat panel implementation above.
// ═══════════════════════════════════════════════════════════════════════

;(function initSignalTracking() {
  let pageEnteredAt = Date.now()
  let isVisible = !document.hidden
  let lastScrollDepth = 0

  // ─── Visibility tracking ─────────────────────────────────────────
  document.addEventListener('visibilitychange', () => {
    const nowVisible = !document.hidden
    if (!nowVisible && isVisible) {
      // Page hidden — emit duration
      const duration = Date.now() - pageEnteredAt
      sendSignalToBackground({
        type: 'visibility',
        url: location.href,
        domain: location.hostname,
        title: document.title,
        metadata: { state: 'hidden', duration_ms: duration, scroll_depth_pct: lastScrollDepth },
      })
    } else if (nowVisible && !isVisible) {
      pageEnteredAt = Date.now()
      sendSignalToBackground({
        type: 'visibility',
        url: location.href,
        domain: location.hostname,
        title: document.title,
        metadata: { state: 'visible' },
      })
    }
    isVisible = nowVisible
  })

  // ─── Scroll depth (throttled — max 1 per 5s) ────────────────────
  let scrollThrottle = null
  window.addEventListener('scroll', () => {
    if (scrollThrottle) return
    scrollThrottle = setTimeout(() => {
      scrollThrottle = null
      const depth = Math.round(
        ((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight) * 100
      )
      if (Math.abs(depth - lastScrollDepth) < 5) return // ignore tiny changes
      lastScrollDepth = depth
      sendSignalToBackground({
        type: 'scroll',
        url: location.href,
        metadata: { depth_pct: depth },
      })
    }, 5000)
  }, { passive: true })

  // ─── Text selection — boolean only, NO CONTENT CAPTURED ──────────
  let selectionTimeout = null
  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimeout)
    selectionTimeout = setTimeout(() => {
      const sel = window.getSelection()
      if (sel && sel.toString().length > 0) {
        sendSignalToBackground({
          type: 'selection',
          url: location.href,
          metadata: { occurred: true },
          // NOTE: sel.toString() is intentionally NOT included for privacy
        })
      }
    }, 1000)
  })

  function sendSignalToBackground(partial) {
    try {
      chrome.runtime.sendMessage({ action: 'EMIT_SIGNAL', signal: partial })
    } catch {
      // Extension context invalidated — silently ignore
    }
  }
})()

// ─── External AI Site Tracking (opt-in) ────────────────────────────
// Only runs if user has enabled external AI tracking in settings.
// IMPORTANT: We capture LENGTH of text only, never the content itself.

const AI_DOMAINS = {
  'chat.openai.com': observeChatGPT,
  'chatgpt.com': observeChatGPT,
  'claude.ai': observeClaude,
  'gemini.google.com': observeGemini,
}

const _aiObserverFn = AI_DOMAINS[location.hostname]
if (_aiObserverFn) {
  chrome.storage.local.get('externalAiTracking', (data) => {
    if (data.externalAiTracking === true) _aiObserverFn()
  })
}

function _sendAiSignalToBackground(partial) {
  try {
    chrome.runtime.sendMessage({ action: 'EMIT_SIGNAL', signal: partial })
  } catch {
    // Extension context invalidated
  }
}

function observeChatGPT() {
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue
        const msgEl = node.matches?.('[data-message-author-role]') ? node
          : node.querySelector?.('[data-message-author-role]')
        if (!msgEl) continue
        const role = msgEl.getAttribute('data-message-author-role') // 'user' | 'assistant'
        const textLength = msgEl.textContent?.length || 0
        _sendAiSignalToBackground({
          type: 'ai_turn_external',
          domain: 'chatgpt.com',
          metadata: { role, length: textLength }, // NO CONTENT
        })
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

function observeClaude() {
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue
        const streaming = node.querySelector?.('[data-is-streaming]')
        if (!streaming) continue
        const length = streaming.textContent?.length || 0
        _sendAiSignalToBackground({
          type: 'ai_turn_external',
          domain: 'claude.ai',
          metadata: { role: 'assistant', length },
        })
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

function observeGemini() {
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue
        const resp = node.querySelector?.('.model-response-text')
        if (!resp) continue
        _sendAiSignalToBackground({
          type: 'ai_turn_external',
          domain: 'gemini.google.com',
          metadata: { role: 'assistant', length: resp.textContent?.length || 0 },
        })
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}
