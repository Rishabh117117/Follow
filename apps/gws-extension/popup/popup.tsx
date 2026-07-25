/**
 * Extension Popup — EXT-1 Redesign
 *
 * New layout:
 *   ┌──────────────────────────────────┐
 *   │ [RS avatar] Rishabh Salian       │
 *   │ salir225@newschool.edu     ● on  │
 *   ├──────────────────────────────────┤
 *   │ [Index Selector dropdown]        │
 *   ├──────────────────────────────────┤
 *   │ CURRENT PAGE                     │
 *   │ 🌐 Page title · domain          │
 *   │ ● Following your browsing        │
 *   ├──────────────────────────────────┤
 *   │ CURRENT DOCUMENT (if on GWS)     │
 *   │ 📄 Doc title · Following         │
 *   ├──────────────────────────────────┤
 *   │ Follow Chat       [toggle]       │
 *   │ Write & Analyze   [toggle]       │
 *   │ Follow on Web     [toggle]       │
 *   ├──────────────────────────────────┤
 *   │   247f     89fi     34c          │
 *   ├──────────────────────────────────┤
 *   │ v0.4.0              [Logout]     │
 *   └──────────────────────────────────┘
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import {
  STORAGE_KEYS,
  DEFAULT_API_BASE_URL,
  EXTENSION_VERSION,
  FEATURES,
  type FeatureKey,
} from '../src/lib/constants'
import { parseGoogleDocUrl } from '../src/lib/google-doc-utils'
import type { ExtensionMessage, ExtensionResponse } from '../src/lib/message-passing'

function sendMessage<T = unknown>(msg: ExtensionMessage): Promise<ExtensionResponse<T>> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res: ExtensionResponse<T>) => {
        resolve(res ?? { success: false, error: 'No response' })
      })
    } catch (err) {
      resolve({ success: false, error: (err as Error).message })
    }
  })
}

// ─── Seed indexes ─────────────────────────────────────────────────────────────
const SEED_INDEXES = [
  { id: 'personal', name: 'Personal', type: 'personal', facts: 247, files: 89, chats: 34 },
  { id: 'capstone', name: 'Capstone Thesis', type: 'project', facts: 112, files: 44, chats: 18 },
  { id: 'follow-dev', name: 'Follow Development', type: 'project', facts: 91, files: 32, chats: 12 },
]

// ─── Toggle component ─────────────────────────────────────────────────────────
function Toggle({ on, color }: { on: boolean; color: string }) {
  return (
    <div style={{
      width: 44, height: 24, borderRadius: 12,
      background: on ? color : '#D1D5DB',
      position: 'relative', flexShrink: 0, cursor: 'pointer',
      transition: 'background 0.15s ease',
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: 10,
        background: '#fff', position: 'absolute',
        top: 2, left: on ? 22 : 2,
        transition: 'left 0.15s ease',
        boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
      }} />
    </div>
  )
}

// ─── Main popup ──────────────────────────────────────────────────────────────

interface DocInfo {
  title: string | null
  isActivated: boolean
  isRecording: boolean
  signalCount: number
  lastSignalAt: string | null
}

function Popup() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)
  const [isOnDocPage, setIsOnDocPage] = useState(false)
  const [pageTitle, setPageTitle] = useState('')
  const [pageDomain, setPageDomain] = useState('')
  const [docInfo, setDocInfo] = useState<DocInfo>({
    title: null, isActivated: false, isRecording: false, signalCount: 0, lastSignalAt: null,
  })
  const [toggles, setToggles] = useState({
    followChat: true,
    writeAnalyze: false,
    followWeb: false,
  })
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_BASE_URL)

  // Index state
  const [activeIndexId, setActiveIndexId] = useState('personal')
  const [indexDropdownOpen, setIndexDropdownOpen] = useState(false)
  const activeIndex = SEED_INDEXES.find(i => i.id === activeIndexId) ?? SEED_INDEXES[0]

  useEffect(() => { init() }, [])

  // Persist toggle states
  useEffect(() => {
    chrome.storage.local.set({ followToggles: toggles, activeIndexId })
  }, [toggles, activeIndexId])

  // Load persisted states
  useEffect(() => {
    chrome.storage.local.get(['followToggles', 'activeIndexId'], (result) => {
      if (result.followToggles) setToggles(result.followToggles)
      if (result.activeIndexId) setActiveIndexId(result.activeIndexId)
    })
  }, [])

  async function init() {
    const authResult = await sendMessage<{ token?: string }>({ type: 'AUTH_TOKEN_GET' })
    if (!authResult.data?.token) { setIsLoggedIn(false); return }
    setIsLoggedIn(true)

    // Get active tab info
    const tabResult = await sendMessage<{ url?: string; title?: string }>({ type: 'GET_ACTIVE_TAB_DOC' })
    if (tabResult.data?.title) setPageTitle(tabResult.data.title)
    if (tabResult.data?.url) {
      try {
        const url = new URL(tabResult.data.url)
        setPageDomain(url.hostname)
      } catch {}
    }

    const parsed = tabResult.data?.url ? parseGoogleDocUrl(tabResult.data.url) : null
    setIsOnDocPage(!!parsed)

    if (parsed) {
      const res = await sendMessage<DocInfo>({ type: 'GET_SMART_DOC_INFO' })
      if (res.success && res.data) setDocInfo(res.data)
    }
  }

  async function handleLogin() {
    await sendMessage({
      type: 'AUTH_TOKEN_SET',
      payload: { token: 'dev-token', userId: '00000000-0000-0000-0000-000000000001', workspaceId: '00000000-0000-0000-0000-000000000002', apiBaseUrl: apiUrl },
    })
    init()
  }

  async function handleLogout() {
    await sendMessage({ type: 'AUTH_TOKEN_CLEAR' })
    setIsLoggedIn(false)
  }

  // ─── Unauthenticated ─────────────────────────────────────────────────────
  if (isLoggedIn === false) {
    return (
      <div style={{ width: 340, fontFamily: "'IBM Plex Sans', -apple-system, sans-serif", padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: '#0A0A0A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>F</span>
          </div>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#0A0A0A' }}>Follow</span>
        </div>
        <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 14, lineHeight: 1.5 }}>
          AI-native knowledge platform. Connect your conversations and documents.
        </p>
        <button onClick={handleLogin} style={{
          width: '100%', padding: '10px', borderRadius: 6, background: '#6C63FF',
          color: '#fff', fontSize: 12, fontWeight: 500, border: 'none', cursor: 'pointer',
        }}>Sign in to get started</button>
        <div style={{ textAlign: 'center', marginTop: 10, fontSize: 9, color: '#9CA3AF', fontFamily: "'IBM Plex Mono', monospace" }}>v{EXTENSION_VERSION}</div>
      </div>
    )
  }

  if (isLoggedIn === null) {
    return <div style={{ width: 340, padding: 40, textAlign: 'center', color: '#9CA3AF' }}>Loading...</div>
  }

  // ─── Authenticated ───────────────────────────────────────────────────────
  const dotColor = activeIndex?.type === 'personal' ? '#6C63FF' : '#34d399'

  return (
    <div style={{ width: 340, fontFamily: "'IBM Plex Sans', -apple-system, sans-serif" }}>
      {/* Profile header */}
      <div style={{ padding: '16px 20px', background: '#fafafa' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 24, background: 'rgba(108,99,255,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#6C63FF', fontSize: 16, fontWeight: 600,
          }}>RS</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#0A0A0A' }} data-testid="popup-name">Rishabh Salian</div>
            <div style={{ fontSize: 11, color: '#6B7280' }} data-testid="popup-email">salir225@newschool.edu</div>
          </div>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: '#34d399' }} />
        </div>
      </div>

      {/* Index selector */}
      <div style={{ padding: '12px 20px', position: 'relative' }}>
        <button
          onClick={() => setIndexDropdownOpen(!indexDropdownOpen)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px', borderRadius: 8, background: 'rgba(108,99,255,0.04)',
            border: '1px solid rgba(108,99,255,0.2)', cursor: 'pointer',
          }}
          data-testid="popup-index-selector"
        >
          <span style={{ width: 8, height: 8, borderRadius: 4, background: dotColor }} />
          <span style={{ flex: 1, textAlign: 'left', fontSize: 13, fontWeight: 500, color: '#0A0A0A' }}>
            {activeIndex?.name}
          </span>
          <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: '#9CA3AF' }}>
            {activeIndex?.facts}f · {activeIndex?.files}fi
          </span>
          <span style={{ fontSize: 10, color: '#9CA3AF' }}>▾</span>
        </button>

        {indexDropdownOpen && (
          <div style={{
            position: 'absolute', left: 20, right: 20, top: '100%', zIndex: 50,
            background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }} data-testid="popup-index-dropdown">
            {SEED_INDEXES.map(idx => (
              <button
                key={idx.id}
                onClick={() => { setActiveIndexId(idx.id); setIndexDropdownOpen(false) }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', border: 'none', background: idx.id === activeIndexId ? 'rgba(108,99,255,0.06)' : 'transparent',
                  cursor: 'pointer', fontSize: 12,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: 3, background: idx.type === 'personal' ? '#6C63FF' : '#34d399' }} />
                <span style={{ flex: 1, textAlign: 'left', color: '#404040' }}>{idx.name}</span>
                <span style={{ fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", color: '#9CA3AF' }}>{idx.facts}f</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Current Page */}
      <div style={{ padding: '8px 20px' }}>
        <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: '#9CA3AF', letterSpacing: 1.5, marginBottom: 6 }}>CURRENT PAGE</div>
        <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13 }}>🌐</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#0A0A0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pageTitle || 'No page detected'}
              </div>
              <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: '#9CA3AF' }}>
                {pageDomain}
              </div>
            </div>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: '#34d399' }} />
          </div>
          {toggles.followWeb && (
            <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: '#34d399', marginTop: 6 }}>
              ● Following your browsing
            </div>
          )}
        </div>
      </div>

      {/* Current Document (only on GWS) */}
      {isOnDocPage && (
        <div style={{ padding: '8px 20px' }}>
          <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: '#9CA3AF', letterSpacing: 1.5, marginBottom: 6 }}>CURRENT DOCUMENT</div>
          <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13 }}>📄</span>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: '#0A0A0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {docInfo.title || 'Untitled Document'}
            </span>
            <span style={{ fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", color: '#34d399', fontWeight: 500 }}>Following</span>
          </div>
        </div>
      )}

      <div style={{ margin: '8px 20px', height: 1, background: '#E5E7EB' }} />

      {/* Toggles */}
      <div style={{ padding: '8px 20px' }}>
        {[
          { key: 'followChat', label: 'Follow Chat', color: '#6C63FF', dot: toggles.followChat ? '#6C63FF' : '#D1D5DB' },
          { key: 'writeAnalyze', label: 'Write & Analyze', color: '#6B7280', dot: '#D1D5DB' },
          { key: 'followWeb', label: 'Follow on Web', color: '#22d3ee', dot: toggles.followWeb ? '#22d3ee' : '#D1D5DB' },
        ].map(item => (
          <div
            key={item.key}
            onClick={() => setToggles(prev => ({ ...prev, [item.key]: !prev[item.key as keyof typeof prev] }))}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', cursor: 'pointer' }}
            data-testid={`toggle-${item.key}`}
          >
            <span style={{ width: 8, height: 8, borderRadius: 4, background: item.dot }} />
            <span style={{ flex: 1, fontSize: 13, color: '#0A0A0A' }}>{item.label}</span>
            <Toggle on={toggles[item.key as keyof typeof toggles]} color={item.color} />
          </div>
        ))}
      </div>

      {/* Quick stats bar */}
      <div style={{ display: 'flex', padding: '12px 20px', borderTop: '1px solid #E5E7EB' }}>
        {[
          { value: activeIndex?.facts ?? 0, label: 'facts' },
          { value: activeIndex?.files ?? 0, label: 'files' },
          { value: activeIndex?.chats ?? 0, label: 'chats' },
        ].map(stat => (
          <div key={stat.label} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontFamily: "'IBM Plex Mono', monospace", color: '#6C63FF', fontWeight: 500 }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 9, color: '#9CA3AF' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 20px', borderTop: '1px solid #E5E7EB' }}>
        <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: '#9CA3AF' }}>v0.4.0</span>
        <button
          onClick={handleLogout}
          style={{
            padding: '4px 12px', borderRadius: 4, background: 'transparent',
            color: '#6B7280', fontSize: 11, border: '1px solid #E5E7EB', cursor: 'pointer',
          }}
        >Logout</button>
      </div>
    </div>
  )
}

// Mount
const root = document.getElementById('popup-root')
if (root) {
  createRoot(root).render(<Popup />)
}
