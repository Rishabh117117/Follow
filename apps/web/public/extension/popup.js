/**
 * Workspace Agent — Popup v12.0.0
 *
 * Compact settings & status popup. The primary chat experience
 * lives in the webapp's FloatingUnit — this popup only handles:
 * - Live recording toggle
 * - Connection status display
 * - Doc Intel trigger
 * - Settings (API URL, key, workspace ID, user ID)
 * - "Open Workspace" button
 */

const POPUP_VERSION = '12.0.0'
console.log(`[WorkspaceAgent] Popup v${POPUP_VERSION} loaded`)

// ─── Elements ────────────────────────────────────────────────────────

const $version = document.getElementById('wa-version')
const $mainView = document.getElementById('wa-main-view')
const $settingsView = document.getElementById('wa-settings-view')
const $settingsBtn = document.getElementById('wa-settings-btn')
const $settingsBack = document.getElementById('wa-settings-back')
const $liveDot = document.getElementById('wa-live-dot')
const $liveStatus = document.getElementById('wa-live-status')
const $liveToggle = document.getElementById('wa-live-toggle')
const $openBtn = document.getElementById('wa-open-btn')
const $docIntelBtn = document.getElementById('wa-doc-intel-btn')
const $connectionStatus = document.getElementById('wa-connection-status')
const $signalCount = document.getElementById('wa-signal-count')
const $apiUrl = document.getElementById('wa-api-url')
const $apiKey = document.getElementById('wa-api-key')
const $workspaceId = document.getElementById('wa-workspace-id')
const $userId = document.getElementById('wa-user-id')
const $saveSettings = document.getElementById('wa-save-settings')
const $cancelSettings = document.getElementById('wa-cancel-settings')

// ─── State ───────────────────────────────────────────────────────────

let isLive = false
let config = {}

// ─── Init ────────────────────────────────────────────────────────────

async function init() {
  $version.textContent = `v${POPUP_VERSION}`

  // Load config
  config = await chrome.storage.local.get(['apiUrl', 'apiKey', 'workspaceId', 'userId', 'liveEnabled'])
  isLive = !!config.liveEnabled

  // Populate settings fields
  $apiUrl.value = config.apiUrl || ''
  $apiKey.value = config.apiKey || ''
  $workspaceId.value = config.workspaceId || ''
  $userId.value = config.userId || ''

  updateLiveUI()
  checkConnection()
  getCaptureStatus()
}

// ─── Live Toggle ─────────────────────────────────────────────────────

function updateLiveUI() {
  if (isLive) {
    $liveDot.classList.add('active')
    $liveToggle.classList.add('active')
    $liveStatus.textContent = 'Recording...'
    $liveStatus.classList.add('active')
  } else {
    $liveDot.classList.remove('active')
    $liveToggle.classList.remove('active')
    $liveStatus.textContent = 'Off'
    $liveStatus.classList.remove('active')
  }
}

$liveToggle.addEventListener('click', () => {
  isLive = !isLive
  updateLiveUI()
  chrome.runtime.sendMessage({ type: 'setLiveEnabled', enabled: isLive })
})

// ─── Connection Check ────────────────────────────────────────────────

async function checkConnection() {
  const apiUrl = config.apiUrl
  if (!apiUrl) {
    $connectionStatus.textContent = 'Not configured'
    $connectionStatus.className = 'wa-status-value disconnected'
    return
  }

  try {
    const res = await fetch(`${apiUrl}/api/health`, { method: 'GET', signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      $connectionStatus.textContent = 'Connected'
      $connectionStatus.className = 'wa-status-value connected'
    } else {
      $connectionStatus.textContent = `Error (${res.status})`
      $connectionStatus.className = 'wa-status-value disconnected'
    }
  } catch {
    $connectionStatus.textContent = 'Offline'
    $connectionStatus.className = 'wa-status-value disconnected'
  }
}

// ─── Capture Status ──────────────────────────────────────────────────

function getCaptureStatus() {
  chrome.runtime.sendMessage({ type: 'getCaptureStatus' }, (response) => {
    if (response) {
      $signalCount.textContent = String(response.captureCount || 0)
    }
  })
}

// ─── Open Workspace ──────────────────────────────────────────────────

$openBtn.addEventListener('click', async () => {
  const apiUrl = config.apiUrl || 'http://localhost:3001'
  // Derive webapp URL from API URL
  const webappUrl = apiUrl.replace(':3001', ':3000').replace(/\/api\/?$/, '')
  const workspaceId = config.workspaceId

  if (workspaceId) {
    chrome.tabs.create({ url: `${webappUrl}/workspace/${workspaceId}` })
  } else {
    chrome.tabs.create({ url: webappUrl })
  }
  window.close()
})

// ─── Doc Intel ───────────────────────────────────────────────────────

$docIntelBtn.addEventListener('click', async () => {
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
  window.close()
})

// ─── Settings ────────────────────────────────────────────────────────

$settingsBtn.addEventListener('click', () => {
  $mainView.style.display = 'none'
  $settingsView.classList.add('open')
})

$settingsBack.addEventListener('click', closeSettings)
$cancelSettings.addEventListener('click', closeSettings)

function closeSettings() {
  $settingsView.classList.remove('open')
  $mainView.style.display = 'flex'
  // Reset fields
  $apiUrl.value = config.apiUrl || ''
  $apiKey.value = config.apiKey || ''
  $workspaceId.value = config.workspaceId || ''
  $userId.value = config.userId || ''
}

$saveSettings.addEventListener('click', async () => {
  const newConfig = {
    apiUrl: $apiUrl.value.trim().replace(/\/+$/, ''),
    apiKey: $apiKey.value.trim(),
    workspaceId: $workspaceId.value.trim(),
    userId: $userId.value.trim(),
  }
  await chrome.storage.local.set(newConfig)
  config = { ...config, ...newConfig }
  closeSettings()
  checkConnection()
})

// ─── Storage Change Listener ─────────────────────────────────────────

chrome.storage.onChanged.addListener((changes) => {
  if (changes.liveEnabled) {
    isLive = !!changes.liveEnabled.newValue
    updateLiveUI()
  }
})

// ─── Boot ────────────────────────────────────────────────────────────

init()
