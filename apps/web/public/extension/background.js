/**
 * Workspace Agent — Background Service Worker
 *
 * 1. Context menu capture (existing)
 * 2. Signal-based tracking: emits typed signals (tab_switch, page_navigate,
 *    idle_state, web_navigate) instead of screen recording. Signals are buffered
 *    and flushed every 5 seconds to the capture API.
 *    - Controlled by `liveEnabled` toggle (default: off)
 * 3. Keyboard command (Alt+W) → toggle content-script floating chat panel
 * 4. Badge indicator: green dot when live, clear when off
 */

// ─── State ──────────────────────────────────────────────────────────

let captureIntervalId = null
let liveActive = false
let captureCount = 0
const SESSION_ID = crypto.randomUUID()

// Signal buffer — signals are pushed here and flushed every 5 seconds
const signalBuffer = []

// Webapp delegation — when the webapp starts Live via the extension,
// it sends its own sessionId so all captures land in the same recording session.
let webappSessionId = null
let webappWorkspaceId = null
let webappUserId = null

// ─── Context Menu ──────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'captureToWorkspace',
    title: 'Capture to Workspace',
    contexts: ['page', 'selection', 'link'],
  })
  chrome.contextMenus.create({
    id: 'analyzePdfDocIntel',
    title: 'Analyze PDF with Doc Intel',
    contexts: ['page'],
  })
  // Check if live was enabled before restart
  chrome.storage.local.get('liveEnabled', ({ liveEnabled }) => {
    if (liveEnabled) {
      startCaptureLoop()
      updateBadge(true)
    }
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // ─── Analyze PDF with Doc Intel ──────────────────────────────
  if (info.menuItemId === 'analyzePdfDocIntel') {
    if (!tab?.id) return
    try {
      // Ask the content script if this is a PDF page and open the viewer
      await chrome.tabs.sendMessage(tab.id, { type: 'openPdfInViewer' })
    } catch {
      // Content script not loaded — try opening the tab URL directly
      const tabUrl = tab.url || info.pageUrl
      if (tabUrl) {
        const config = await chrome.storage.local.get(['apiUrl'])
        const apiUrl = config.apiUrl || 'http://localhost:3001'
        const webappBase = apiUrl.replace(':3001', ':3000').replace(/\/api\/?$/, '')
        const viewerUrl = webappBase + '/pdf-viewer?url=' + encodeURIComponent(tabUrl)
        chrome.tabs.create({ url: viewerUrl })
      }
    }
    return
  }

  if (info.menuItemId !== 'captureToWorkspace') return

  const config = await chrome.storage.local.get(['apiUrl', 'apiKey', 'workspaceId'])
  if (!config.apiUrl || !config.apiKey || !config.workspaceId) return

  const content = info.selectionText || ''
  const sourceUrl = info.linkUrl || info.pageUrl || tab?.url || ''
  const title = tab?.title || 'Untitled'

  try {
    const response = await fetch(`${config.apiUrl}/api/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        workspaceId: config.workspaceId,
        sourceUrl,
        title,
        content,
        source: 'extension',
        tags: [],
        analyze: true,
      }),
    })
    const data = await response.json()
    if (data.data) {
      chrome.action.setBadgeText({ text: '\u2713', tabId: tab?.id })
      chrome.action.setBadgeBackgroundColor({ color: '#34d399', tabId: tab?.id })
      setTimeout(() => {
        if (liveActive) {
          updateBadge(true)
        } else {
          chrome.action.setBadgeText({ text: '', tabId: tab?.id })
        }
      }, 3000)
    }
  } catch (err) {
    console.error('[Workspace] Capture error:', err)
    chrome.action.setBadgeText({ text: '!', tabId: tab?.id })
    chrome.action.setBadgeBackgroundColor({ color: '#f87171', tabId: tab?.id })
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab?.id }), 3000)
  }
})

// ─── Badge Management ───────────────────────────────────────────────

function updateBadge(isLive) {
  if (isLive) {
    chrome.action.setBadgeText({ text: '\u2022' }) // bullet dot
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' }) // green-500
  } else {
    chrome.action.setBadgeText({ text: '' })
  }
}

// ─── Signal Helpers ──────────────────────────────────────────────────

function extractDomain(url) {
  try { return new URL(url).hostname } catch { return '' }
}

/**
 * Read Zustand-persisted state from chrome.storage.local.
 * Returns { isLive, sessionId, workspaceId, userId }.
 */
async function getStoreState() {
  const config = await chrome.storage.local.get([
    'liveEnabled',
    'workspaceId',
    'userId',
    'apiUrl',
    'apiKey',
  ])
  return {
    isLive: !!config.liveEnabled,
    sessionId: webappSessionId || SESSION_ID,
    workspaceId: webappWorkspaceId || config.workspaceId,
    userId: webappUserId || config.userId || '00000000-0000-0000-0000-000000000001',
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
  }
}

/**
 * Emit a signal to the buffer. Only works when live tracking is active.
 */
async function emitSignal(partial) {
  const store = await getStoreState()
  if (!store.isLive || !store.sessionId) return
  const signal = {
    ...partial,
    sessionId: store.sessionId,
    workspaceId: store.workspaceId,
    userId: store.userId,
    timestamp: new Date().toISOString(),
    metadata: partial.metadata || {},
  }
  signalBuffer.push(signal)
}

/**
 * Flush buffered signals to the capture API.
 * Called every 5 seconds by the signal flush loop.
 */
async function flushSignals() {
  if (signalBuffer.length === 0) return
  const toFlush = [...signalBuffer]
  signalBuffer.length = 0

  const store = await getStoreState()
  if (!store.apiUrl || !store.workspaceId) return

  try {
    const response = await fetch(`${store.apiUrl}/api/capture/realtime`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${store.apiKey}`,
        'x-user-id': store.userId,
        'x-workspace-id': store.workspaceId,
      },
      body: JSON.stringify({
        workspaceId: store.workspaceId,
        userId: store.userId,
        sessionId: store.sessionId,
        source: 'web_extension',
        timestamp: new Date().toISOString(),
        signals: toFlush,
      }),
    })

    if (response.ok) {
      captureCount += toFlush.length
      console.log(`[Workspace] Flushed ${toFlush.length} signals (total: ${captureCount})`)
    } else {
      const text = await response.text().catch(() => '')
      console.error(`[Workspace] Signal flush failed (${response.status}):`, text.substring(0, 200))
      // Re-buffer signals on failure (prepend so order is preserved)
      signalBuffer.unshift(...toFlush)
    }
  } catch (err) {
    console.error('[Workspace] Signal flush network error:', err?.message || err)
    // Re-buffer signals on failure
    signalBuffer.unshift(...toFlush)
  }
}

// ─── Signal Emitters (Chrome Event Listeners) ───────────────────────

// Tab switch signal
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId)
    if (!tab.url || tab.url.startsWith('chrome://')) return
    await emitSignal({
      type: 'tab_switch',
      url: tab.url,
      domain: extractDomain(tab.url),
      title: tab.title || '',
      metadata: { tabId: activeInfo.tabId },
    })
  } catch (e) { /* tab may have closed */ }
})

// Page navigation complete
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return
  if (!tab.url || tab.url.startsWith('chrome://')) return
  await emitSignal({
    type: 'page_navigate',
    url: tab.url,
    domain: extractDomain(tab.url),
    title: tab.title || '',
    metadata: { tabId },
  })
})

// Idle state change
chrome.idle.onStateChanged.addListener(async (state) => {
  await emitSignal({
    type: 'idle_state',
    metadata: { state }, // 'active' | 'idle' | 'locked'
  })
})

// Web navigation (catches SPA navigations that tabs.onUpdated misses)
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (!details.url || details.url.startsWith('chrome://')) return
  await emitSignal({
    type: 'web_navigate',
    url: details.url,
    domain: extractDomain(details.url),
    metadata: { tabId: details.tabId, frameId: details.frameId },
  })
})

// ─── Live Signal Flush Loop ─────────────────────────────────────────

function startCaptureLoop() {
  if (captureIntervalId) return
  liveActive = true
  captureCount = 0
  console.log('[Workspace] Starting 5-second signal flush loop (session:', SESSION_ID, ')')

  // Do an immediate flush (in case there are buffered signals)
  flushSignals().catch((err) => {
    console.error('[Workspace] Initial signal flush failed:', err)
  })

  captureIntervalId = setInterval(async () => {
    if (!liveActive) return
    try {
      await flushSignals()
    } catch (err) {
      console.error('[Workspace] Signal flush cycle failed:', err)
    }
  }, 5_000)
}

function stopCaptureLoop() {
  if (captureIntervalId) {
    clearInterval(captureIntervalId)
    captureIntervalId = null
  }
  liveActive = false
  // Final flush of any remaining signals
  flushSignals().catch(() => {})
  console.log('[Workspace] Signal flush loop stopped after', captureCount, 'signals')
}

// ─── Extension Icon Click — No-op (popup handles UI) ────────────────
// With default_popup set in manifest.json, the popup opens on icon click.
// No additional floating panel toggling needed — the webapp's FloatingUnit
// is the primary chat interface.

// ─── Keyboard Commands ──────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-doc-intel') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'toggleDocIntel' })
    } catch {
      // Content script not loaded — inject and retry
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js', 'doc-intel-detector.js', 'doc-intel-overlay.js', 'doc-intel-card-web.js', 'doc-intel-toolbar.js'],
        })
        setTimeout(async () => {
          try { await chrome.tabs.sendMessage(tab.id, { type: 'toggleDocIntel' }) } catch {}
        }, 500)
      } catch (e) {
        console.warn('[Workspace] Failed to inject doc-intel scripts:', e)
      }
    }
    return
  }
})

// ─── Service Worker Startup ─────────────────────────────────────────

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get('liveEnabled', ({ liveEnabled }) => {
    if (liveEnabled) {
      startCaptureLoop()
      updateBadge(true)
    }
  })
})

// ─── Message Handler ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Config request (from popup or content script)
  if (message.type === 'getConfig') {
    chrome.storage.local.get(['apiUrl', 'apiKey', 'workspaceId', 'userId'], (config) =>
      sendResponse(config)
    )
    return true
  }

  // Screenshot capture (for chat auto-attach)
  if (message.type === 'captureScreenshot') {
    chrome.tabs
      .captureVisibleTab(null, { format: 'png' })
      .then((dataUrl) => sendResponse({ screenshot: dataUrl }))
      .catch((err) => sendResponse({ error: err.message }))
    return true
  }

  // Tab info
  if (message.type === 'getTabInfo') {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => sendResponse({ url: tab?.url, title: tab?.title }))
      .catch(() => sendResponse({ url: '', title: '' }))
    return true
  }

  // Live toggle (from popup or content script)
  if (message.type === 'setLiveEnabled') {
    console.log('[Workspace] Live toggle:', message.enabled)
    chrome.storage.local.set({ liveEnabled: message.enabled })
    if (message.enabled) {
      startCaptureLoop()
      updateBadge(true)
    } else {
      stopCaptureLoop()
      updateBadge(false)

      // End session on backend
      endBackendSession().catch(() => {})
    }
    sendResponse({ ok: true })
    return true
  }

  // Legacy: setCaptureEnabled maps to setLiveEnabled
  if (message.type === 'setCaptureEnabled') {
    chrome.storage.local.set({ liveEnabled: message.enabled })
    if (message.enabled) {
      startCaptureLoop()
      updateBadge(true)
    } else {
      stopCaptureLoop()
      updateBadge(false)
    }
    sendResponse({ ok: true })
    return true
  }

  // ─── Signal relay from content script ────────────────────────────
  if (message.action === 'EMIT_SIGNAL') {
    // Add tab context to signal
    const enriched = {
      ...message.signal,
      url: message.signal.url || sender.tab?.url,
      domain: message.signal.domain || (sender.tab?.url ? extractDomain(sender.tab.url) : ''),
    }
    signalBuffer.push(enriched)
    // Don't sendResponse — fire-and-forget from content script
    return false
  }

  // ─── Webapp Delegation: Start/Stop Live via extension ──────────
  if (message.type === 'webappStartLive') {
    console.log(
      '[Workspace] Webapp delegation: starting live capture, sessionId:',
      message.sessionId
    )
    webappSessionId = message.sessionId
    webappWorkspaceId = message.workspaceId
    webappUserId = message.userId
    // Ensure config is available for captureCurrentTab
    chrome.storage.local.set({
      liveEnabled: true,
      workspaceId: message.workspaceId,
      userId: message.userId,
    })
    startCaptureLoop()
    updateBadge(true)
    sendResponse({ ok: true })
    return true
  }

  if (message.type === 'webappStopLive') {
    console.log('[Workspace] Webapp delegation: stopping live capture')
    // Flush any remaining signals before stopping
    flushSignals().catch(() => {})
    // Don't call endBackendSession — the webapp handles that itself
    webappSessionId = null
    webappWorkspaceId = null
    webappUserId = null
    stopCaptureLoop()
    updateBadge(false)
    chrome.storage.local.set({ liveEnabled: false })
    sendResponse({ ok: true })
    return true
  }

  // ─── Doc Intelligence API Proxy ─────────────────────────────────
  // Content scripts on HTTPS pages (e.g. Google Docs) cannot fetch
  // http://localhost due to mixed-content blocking. The background
  // service worker is not subject to this restriction.
  if (message.type === 'docIntelRequest') {
    const { apiUrl, endpoint, headers, body } = message
    fetch(`${apiUrl}/api/doc-intelligence-web/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          sendResponse({ error: err?.error?.message || `HTTP ${res.status}` })
        } else {
          const json = await res.json()
          sendResponse({ data: json })
        }
      })
      .catch((err) => sendResponse({ error: err.message || 'Network error' }))
    return true // keep sendResponse channel open for async
  }

  // ─── Shared: wait for tab to finish loading (max 12s) ─────────────
  function waitForTabLoad(tabId) {
    return new Promise((resolve) => {
      let resolved = false
      const done = () => { if (!resolved) { resolved = true; resolve() } }

      const listener = (id, changeInfo) => {
        if (id === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener)
          console.log('[Workspace] Tab loaded:', tabId)
          done()
        }
      }
      chrome.tabs.onUpdated.addListener(listener)

      // Guard: tab may already be complete before listener was added
      chrome.tabs.get(tabId, (currentTab) => {
        if (chrome.runtime.lastError) return
        if (currentTab && currentTab.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener)
          console.log('[Workspace] Tab already complete:', tabId)
          done()
        }
      })

      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener)
        console.log('[Workspace] Tab load timeout (12s) for tab:', tabId)
        done()
      }, 12000)
    })
  }

  // ─── Shared: inject spotlight with retry + text-fragment fallback ──
  async function injectSpotlightWithRetry(tabId, spotlightText, url) {
    console.log('[Workspace] Injecting spotlight for:', spotlightText)

    // Try executeScript with one retry
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: spotlightSectionInPage,
          args: [spotlightText],
        })
        console.log('[Workspace] Spotlight injected (attempt', attempt + 1, ')')
        return true
      } catch (e) {
        console.warn('[Workspace] executeScript attempt', attempt + 1, 'failed:', e.message || e)
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500))
        }
      }
    }

    // Fallback: text fragment navigation (strip any existing hash first)
    try {
      const baseUrl = url.split('#')[0]
      const fragmentUrl = `${baseUrl}#:~:text=${encodeURIComponent(spotlightText)}`
      console.log('[Workspace] Trying text fragment fallback:', fragmentUrl)
      await chrome.tabs.update(tabId, { url: fragmentUrl })
    } catch (e2) {
      console.warn('[Workspace] Text fragment fallback also failed:', e2)
    }
    return false
  }

  // ─── Navigate + Spotlight (from popup) ────────────────────────────
  // Popup closes when a new tab opens, so it delegates to background
  // which persists and can wait for the page to load before injecting.
  if (message.type === 'navigateAndSpotlight') {
    const { url, section } = message
    console.log('[Workspace] navigateAndSpotlight received:', { url, section })
    ;(async () => {
      try {
        console.log('[Workspace] Creating tab:', url)
        const tab = await chrome.tabs.create({ url, active: true })
        console.log('[Workspace] Tab created:', tab.id, '— waiting for load...')

        await waitForTabLoad(tab.id)
        await new Promise((r) => setTimeout(r, 1500))

        const spotlightText = section || extractPageNameFromUrl(url)
        if (spotlightText) {
          await injectSpotlightWithRetry(tab.id, spotlightText, url)
        }
        sendResponse({ ok: true, tabId: tab.id })
      } catch (err) {
        console.error('[Workspace] Navigate+spotlight failed:', err)
        sendResponse({ error: err.message })
      }
    })()
    return true // async sendResponse
  }

  // ─── Playwright navigate + spotlight (from popup) ─────────────────
  if (message.type === 'playwrightNavigateAndSpotlight') {
    const { url, action, section } = message
    ;(async () => {
      try {
        const config = await chrome.storage.local.get([
          'apiUrl',
          'apiKey',
          'workspaceId',
          'userId',
        ])

        const response = await fetch(`${config.apiUrl}/api/browser-nav/navigate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
            'x-user-id': config.userId || 'extension-user',
            'x-workspace-id': config.workspaceId,
          },
          body: JSON.stringify({
            workspaceId: config.workspaceId,
            url,
            textFragment: action || section,
            sectionTarget: action || section,
            query: action || section,
            targetDescription: action || section,
            confidence: 0.7,
          }),
        })

        const json = await response.json()
        const result = json.data
        const finalUrl = result?.finalUrl || url
        const spotlightText = action || section

        // Now open tab + spotlight (same robust logic as navigateAndSpotlight)
        const tab = await chrome.tabs.create({ url: finalUrl, active: true })
        await waitForTabLoad(tab.id)
        await new Promise((r) => setTimeout(r, 1500))

        if (spotlightText) {
          await injectSpotlightWithRetry(tab.id, spotlightText, finalUrl)
        }
        sendResponse({ ok: true, tabId: tab.id })
      } catch (err) {
        console.error('[Workspace] PW navigate failed:', err)
        // Fallback: open the URL directly with spotlight
        try {
          const tab = await chrome.tabs.create({ url, active: true })
          await waitForTabLoad(tab.id)
          await new Promise((r) => setTimeout(r, 1500))
          if (action || section) {
            await injectSpotlightWithRetry(tab.id, action || section, url)
          }
          sendResponse({ ok: true, tabId: tab.id })
        } catch (fallbackErr) {
          sendResponse({ error: fallbackErr.message })
        }
      }
    })()
    return true // async sendResponse
  }

  // Debug: get capture status
  if (message.type === 'getCaptureStatus') {
    sendResponse({
      liveActive,
      captureCount,
      sessionId: SESSION_ID,
      hasInterval: !!captureIntervalId,
      signalBufferSize: signalBuffer.length,
    })
    return true
  }

  // Catch-all: prevent "message port closed" errors for unhandled message types
  // (e.g., messages intended for offscreen doc or other contexts)
  return false
})

// ─── URL → Page Name Helper ──────────────────────────────────────────

/**
 * Extracts a human-readable page name from a URL path as a last-resort section text.
 * e.g. "https://en.wikipedia.org/wiki/Japan" → "Japan"
 * e.g. "https://docs.example.com/getting-started" → "getting started"
 */
function extractPageNameFromUrl(url) {
  try {
    const pathname = new URL(url).pathname
    // Grab last meaningful segment
    const segments = pathname.split('/').filter(Boolean)
    if (segments.length === 0) return ''
    const last = segments[segments.length - 1]
    // Decode URI, replace hyphens/underscores with spaces
    return decodeURIComponent(last).replace(/[-_]/g, ' ').trim()
  } catch {
    return ''
  }
}

// ─── Spotlight Function (injected into target page) ─────────────────

/**
 * Injected into the target tab via chrome.scripting.executeScript.
 * Finds the section heading and scrolls + highlights it with a yellow pulse.
 * Uses 5 strategies: ID match → heading text (with reverse partial) → ARIA landmarks → bold/title → text walker.
 * Falls back to h1 page title if nothing matches.
 */
function spotlightSectionInPage(sectionText) {
  if (!sectionText) return

  console.log('[Workspace Spotlight] Looking for:', sectionText)
  const lower = sectionText.toLowerCase().trim()

  // Generate shorter search terms for fuzzy matching
  const words = lower.split(/\s+/)
  const shortTerms = [lower]
  // First 2-3 words as alternative
  if (words.length > 3) shortTerms.push(words.slice(0, 3).join(' '))
  if (words.length > 2) shortTerms.push(words.slice(0, 2).join(' '))
  // Strip prepositional phrases: "East Coast of the United States" → "East Coast"
  // Strip prepositional phrases: "East Coast of the United States" → "East Coast"
  const ofMatch = lower.match(/^(.+?)\s+of\s+/)
  if (ofMatch && ofMatch[1].length >= 3 && !shortTerms.includes(ofMatch[1].trim())) {
    shortTerms.push(ofMatch[1].trim())
  }
  // Add individual words (4+ chars) — "Feudal Japan" → also try "feudal", "japan"
  if (words.length >= 2) {
    for (const w of words) {
      if (w.length >= 4 && !shortTerms.includes(w)) shortTerms.push(w)
    }
  }
  // Also extract URL hash as additional search hint
  const urlHash = window.location.hash.replace(/^#/, '').split('#')[0].replace(/:~:text=.*/, '')
  if (urlHash) {
    const hashText = decodeURIComponent(urlHash).replace(/[_-]/g, ' ').toLowerCase().trim()
    if (hashText && !shortTerms.includes(hashText)) shortTerms.push(hashText)
  }

  const strategies = [
    // Strategy 0: URL hash → direct getElementById (browser's own anchor)
    () => {
      if (urlHash) {
        const el = document.getElementById(urlHash) || document.getElementById(decodeURIComponent(urlHash))
        if (el) { console.log('[Spotlight] Found by URL hash:', urlHash); return el }
      }
      return null
    },
    // Strategy 1: ID match (exact, hyphenated, underscored)
    () => {
      for (const term of [sectionText, ...shortTerms]) {
        const variants = [
          term,
          term.replace(/\s+/g, '-'),
          term.replace(/\s+/g, '_'),
          term.replace(/\s+/g, ''),
          // Wikipedia style
          term.replace(/\s+/g, '_').replace(/^./, c => c.toUpperCase()),
        ]
        for (const id of variants) {
          const el = document.getElementById(id)
          if (el) { console.log('[Spotlight] Found by ID:', id); return el }
        }
      }
      return null
    },
    // Strategy 2: Heading text match (h1–h6) — try exact then partial
    () => {
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6')
      // Exact match first
      for (const h of headings) {
        const text = h.textContent.toLowerCase().trim()
        if (text === lower || text.includes(lower)) {
          console.log('[Spotlight] Found heading (exact):', h.textContent.trim())
          return h
        }
      }
      // Partial: check if heading text contains any of the short terms
      for (const term of shortTerms) {
        for (const h of headings) {
          if (h.textContent.toLowerCase().trim().includes(term)) {
            console.log('[Spotlight] Found heading (partial "' + term + '"):', h.textContent.trim())
            return h
          }
        }
      }
      // Reverse partial: if heading "East Coast" is contained within search "East Coast of the United States"
      for (const h of headings) {
        const hText = h.textContent.toLowerCase().trim()
        if (hText.length >= 3 && lower.includes(hText)) {
          console.log('[Spotlight] Found heading (reverse partial):', h.textContent.trim())
          return h
        }
      }
      return null
    },
    // Strategy 3: ARIA landmarks + section/article elements
    () => {
      const els = document.querySelectorAll('[role="heading"], [aria-label], section[id], article[id]')
      for (const term of shortTerms) {
        for (const el of els) {
          const label = el.getAttribute('aria-label') || el.getAttribute('id') || el.textContent || ''
          if (label.toLowerCase().trim().includes(term)) {
            console.log('[Spotlight] Found ARIA/section:', label.substring(0, 60))
            return el
          }
        }
      }
      return null
    },
    // Strategy 4: Bold/strong/dt elements that contain the text
    () => {
      const candidates = document.querySelectorAll('strong, b, dt, th, [class*="title"], [class*="header"], [class*="heading"]')
      for (const term of shortTerms) {
        for (const el of candidates) {
          if (el.textContent.toLowerCase().includes(term)) {
            console.log('[Spotlight] Found bold/title element:', el.textContent.substring(0, 60))
            return el
          }
        }
      }
      return null
    },
    // Strategy 5: Text walker — find first significant element containing text
    () => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      )
      for (const term of shortTerms) {
        walker.currentNode = document.body
        while (walker.nextNode()) {
          const node = walker.currentNode
          if (node.textContent.toLowerCase().includes(term)) {
            const parent = node.parentElement
            if (parent && !['BODY', 'HTML', 'SCRIPT', 'STYLE'].includes(parent.tagName)) {
              console.log('[Spotlight] Found via text walk:', parent.tagName, parent.textContent.substring(0, 60))
              return parent
            }
          }
        }
      }
      return null
    },
  ]

  let target = null
  for (let i = 0; i < strategies.length; i++) {
    target = strategies[i]()
    if (target) {
      console.log('[Spotlight] Strategy', i + 1, 'matched')
      break
    }
  }

  if (!target) {
    console.warn('[Workspace Spotlight] No element found for:', sectionText)
    console.warn('[Workspace Spotlight] Short terms tried:', shortTerms)
    // Fallback: first h2 content section (more useful than h1 which is at the top)
    target = document.querySelector('h2') || document.querySelector('h1')
    if (target) {
      console.log('[Spotlight] Falling back to first content section:', target.textContent?.substring(0, 60))
    } else {
      console.log('[Spotlight] No headings found — scrolling to top')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
  }

  // Scroll so heading is ~100px from top of viewport (natural reading position)
  const rect = target.getBoundingClientRect()
  const absoluteTop = window.pageYOffset + rect.top
  const offset = Math.max(0, absoluteTop - 100)
  window.scrollTo({ top: offset, behavior: 'smooth' })

  // Apply spotlight animation
  const style = document.createElement('style')
  style.textContent = `
    @keyframes wa-spotlight-pulse {
      0%   { outline-color: rgba(250, 204, 21, 0.95); background-color: rgba(250, 204, 21, 0.18); box-shadow: 0 0 20px rgba(250, 204, 21, 0.4); }
      40%  { outline-color: rgba(250, 204, 21, 0.6); background-color: rgba(250, 204, 21, 0.10); box-shadow: 0 0 10px rgba(250, 204, 21, 0.2); }
      100% { outline-color: transparent; background-color: transparent; box-shadow: none; }
    }
    .wa-spotlight-active {
      outline: 3px solid rgba(250, 204, 21, 0.95) !important;
      outline-offset: 6px !important;
      border-radius: 6px !important;
      animation: wa-spotlight-pulse 2s ease-out forwards !important;
      position: relative !important;
      z-index: 99999 !important;
    }
  `
  document.head.appendChild(style)
  target.classList.add('wa-spotlight-active')
  console.log('[Spotlight] Animation applied to:', target.tagName, target.textContent?.substring(0, 40))

  setTimeout(() => {
    target.classList.remove('wa-spotlight-active')
    style.remove()
  }, 2500)
}

// ─── End Backend Session ────────────────────────────────────────────

async function endBackendSession() {
  const config = await chrome.storage.local.get(['apiUrl', 'apiKey', 'workspaceId', 'userId'])
  if (!config.apiUrl || !config.apiKey || !config.workspaceId) return

  // Fallback ID matches DEV_USER.id from @workspace/shared/constants/dev-user.ts
  const userId = config.userId || '00000000-0000-0000-0000-000000000001'
  const activeSessionId = webappSessionId || SESSION_ID

  await fetch(`${config.apiUrl}/api/capture/realtime/end-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'x-user-id': userId,
      'x-workspace-id': config.workspaceId,
    },
    body: JSON.stringify({
      workspaceId: config.workspaceId,
      userId,
      sessionId: activeSessionId,
    }),
  })
}

// ─── Storage Change Listener (sync live state) ──────────────────────

chrome.storage.onChanged.addListener((changes) => {
  if (changes.liveEnabled) {
    const isLive = !!changes.liveEnabled.newValue
    console.log('[Workspace] Storage change: liveEnabled =', isLive)
    if (isLive && !liveActive) {
      startCaptureLoop()
      updateBadge(true)
    } else if (!isLive && liveActive) {
      stopCaptureLoop()
      updateBadge(false)
    }
  }
})
