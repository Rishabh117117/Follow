/**
 * Popup — extension popup with Google OAuth, user profile, document context,
 * collaborator toggle, and consolidated feature toggles.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { FEATURES, DEFAULT_WEB_APP_URL, type FeatureKey } from '../src/lib/constants'

const DEFAULT_API_URL = 'http://localhost:3001'

function sendMessage<T = unknown>(msg: { type: string; payload?: Record<string, unknown> }): Promise<{ success: boolean; data?: T; error?: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => resolve(res ?? { success: false, error: 'No response' }))
  })
}

function Toggle({ on, color, small }: { on: boolean; color: string; small?: boolean }) {
  const w = small ? 28 : 32
  const h = small ? 16 : 18
  const r = h / 2
  const knob = small ? 12 : 14
  return (
    <div style={{
      width: w, height: h, borderRadius: r,
      background: on ? color : '#D1D5DB',
      position: 'relative', flexShrink: 0, cursor: 'pointer',
      transition: 'background 0.15s ease',
    }}>
      <div style={{
        width: knob, height: knob, borderRadius: knob / 2,
        background: '#fff', position: 'absolute',
        top: (h - knob) / 2, left: on ? w - knob - 2 : 2,
        transition: 'left 0.15s ease',
        boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
      }} />
    </div>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" style={{
      transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
      transition: 'transform 0.15s ease',
    }}>
      <path d="M3 4.5L6 7.5L9 4.5" stroke="#9CA3AF" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function Popup() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)
  const [isOnDocPage, setIsOnDocPage] = useState(false)
  const [isOnWebPage, setIsOnWebPage] = useState(false)
  const [webPageTitle, setWebPageTitle] = useState('')
  const [webPageDomain, setWebPageDomain] = useState('')
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL)
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [userAvatar, setUserAvatar] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [loginError, setLoginError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [docTitle, setDocTitle] = useState('')
  const [collaborators, setCollaborators] = useState<string[]>([])
  const [showCollaborators, setShowCollaborators] = useState(false)

  useEffect(() => { initPopup() }, [])

  // Poll collaborators while popup is open on a doc page
  useEffect(() => {
    if (!isOnDocPage || !isLoggedIn) return
    fetchCollaborators()
    const interval = setInterval(fetchCollaborators, 10000)
    return () => clearInterval(interval)
  }, [isOnDocPage, isLoggedIn])

  async function fetchCollaborators() {
    const result = await sendMessage<{ collaborators: string[] }>({ type: 'GET_COLLABORATORS' })
    if (result.success && result.data?.collaborators) {
      setCollaborators(result.data.collaborators)
    }
  }

  async function initPopup() {
    const authResult = await sendMessage<{
      token?: string; userId?: string; workspaceId?: string; apiBaseUrl?: string
      email?: string; name?: string; avatarUrl?: string
    }>({ type: 'AUTH_TOKEN_GET' })
    const authData = authResult.data || {}

    if (!authData.token) {
      setIsLoggedIn(false)
      if (authData.apiBaseUrl) setApiUrl(authData.apiBaseUrl)
      return
    }

    setIsLoggedIn(true)
    if (authData.name) setUserName(authData.name)
    if (authData.email) setUserEmail(authData.email)
    if (authData.avatarUrl) setUserAvatar(authData.avatarUrl)
    if (authData.apiBaseUrl) setApiUrl(authData.apiBaseUrl)
    if (authData.workspaceId) setWorkspaceId(authData.workspaceId as string)

    // Check active tab
    const tabResult = await sendMessage<{ url?: string; title?: string }>({ type: 'GET_ACTIVE_TAB_DOC' })
    if (tabResult.data?.url) {
      const url = tabResult.data.url
      const isDoc = /docs\.google\.com\/(document|spreadsheets|presentation)/.test(url)
      setIsOnDocPage(isDoc)
      if (isDoc && tabResult.data.title) {
        // Clean up Google Docs title (remove " - Google Docs" suffix)
        setDocTitle(tabResult.data.title.replace(/ - Google (Docs|Sheets|Slides)$/, ''))
      }
      // Detect any non-chrome, non-extension web page
      const isWeb = !isDoc && /^https?:\/\//.test(url) && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://')
      setIsOnWebPage(isWeb)
      if (isWeb) {
        try {
          const parsed = new URL(url)
          setWebPageDomain(parsed.hostname)
          setWebPageTitle(tabResult.data.title?.replace(/ ?[-–|] .*$/, '') || parsed.hostname)
        } catch {
          setWebPageDomain(url)
          setWebPageTitle(tabResult.data.title || 'Web Page')
        }
      }
    }

    // Load toggles
    const toggleResult = await sendMessage<Record<string, boolean>>({ type: 'FEATURE_TOGGLES_GET' })
    if (toggleResult.success && toggleResult.data) {
      setToggles(prev => ({ ...prev, ...toggleResult.data }))
    }
  }

  const handleToggle = useCallback(async (key: FeatureKey) => {
    const feat = FEATURES.find(f => f.key === key)
    if (feat?.docOnly && !isOnDocPage) return

    const newValue = !toggles[key]
    setToggles(prev => ({ ...prev, [key]: newValue }))
    await sendMessage({ type: 'FEATURE_TOGGLE_CHANGED', payload: { feature: key, enabled: newValue } })
  }, [toggles, isOnDocPage])

  async function handleGoogleLogin() {
    setLoginError('')
    setIsLoggingIn(true)

    try {
      const tokenResult = await sendMessage<{ token: string }>({ type: 'GET_GOOGLE_AUTH_TOKEN' })
      if (!tokenResult.success || !tokenResult.data?.token) {
        setLoginError('Google sign-in was cancelled or failed.')
        setIsLoggingIn(false)
        return
      }

      const res = await fetch(`${apiUrl}/api/auth/extension-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ googleAccessToken: tokenResult.data.token }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: 'Login failed' } }))
        setLoginError((err as any).error?.message ?? 'Login failed')
        setIsLoggingIn(false)
        return
      }

      const result = (await res.json()) as { data: { userId: string; workspaceId: string; email: string; name: string; avatarUrl?: string } }
      const { userId, workspaceId, email, name, avatarUrl } = result.data

      await sendMessage({
        type: 'AUTH_TOKEN_SET',
        payload: {
          token: tokenResult.data.token,
          userId, workspaceId, apiBaseUrl: apiUrl,
          email, name, avatarUrl: avatarUrl ?? '',
        },
      })

      setIsLoggingIn(false)
      initPopup()
    } catch {
      setLoginError('Connection failed. Check API URL.')
      setIsLoggingIn(false)
    }
  }

  async function handleLogout() {
    await sendMessage({ type: 'REVOKE_GOOGLE_AUTH_TOKEN' })
    await sendMessage({ type: 'AUTH_TOKEN_CLEAR' })
    setIsLoggedIn(false)
    setToggles({})
    setUserName('')
    setUserEmail('')
    setUserAvatar('')
  }

  const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

  // ─── Login Screen ───
  if (isLoggedIn === false) {
    return (
      <div style={{ width: 260, fontFamily: font }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 20, height: 20, borderRadius: 6, background: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>F</span>
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#0A0A0A' }}>Follow</span>
          <span style={{ fontSize: 9, color: '#9CA3AF', marginLeft: 'auto', background: '#F0FDF4', padding: '1px 5px', borderRadius: 8 }}>v2.0</span>
        </div>
        <div style={{ padding: '20px 16px' }}>
          <p style={{ fontSize: 11, color: '#6B7280', marginBottom: 14, lineHeight: 1.5, textAlign: 'center' }}>
            Sign in with Google to enable Follow on your documents.
          </p>

          {/* API URL config */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 10, color: '#9CA3AF', display: 'block', marginBottom: 3 }}>API URL</label>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid #D1D5DB', borderRadius: 5, fontSize: 11, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {/* Google Sign-In */}
          <button
            onClick={handleGoogleLogin}
            disabled={isLoggingIn}
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 6, border: '1px solid #DADCE0',
              background: '#fff', color: '#3C4043', fontSize: 12, fontWeight: 500,
              cursor: isLoggingIn ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: isLoggingIn ? 0.6 : 1,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            {isLoggingIn ? 'Signing in...' : 'Sign in with Google'}
          </button>

          {/* Dev Mode Login — bypasses Google OAuth for local development */}
          <button
            onClick={async () => {
              setIsLoggingIn(true)
              try {
                await sendMessage({
                  type: 'AUTH_TOKEN_SET',
                  payload: {
                    token: 'dev-token',
                    userId: '00000000-0000-0000-0000-000000000001',
                    workspaceId: '00000000-0000-0000-0000-000000000001',
                    apiBaseUrl: apiUrl,
                    email: 'dev@follow.app',
                    name: 'Dev User',
                    avatarUrl: '',
                  },
                })
                setIsLoggingIn(false)
                initPopup()
              } catch {
                setLoginError('Dev login failed')
                setIsLoggingIn(false)
              }
            }}
            disabled={isLoggingIn}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px dashed #9CA3AF',
              background: 'transparent', color: '#6B7280', fontSize: 11,
              cursor: isLoggingIn ? 'wait' : 'pointer', marginTop: 8,
            }}
          >
            Dev Login (no OAuth)
          </button>

          {loginError && (
            <p style={{ fontSize: 10, color: '#DC2626', marginTop: 8, lineHeight: 1.3, textAlign: 'center' }}>
              {loginError}
            </p>
          )}
        </div>
      </div>
    )
  }

  // ─── Loading ───
  if (isLoggedIn === null) {
    return (
      <div style={{ width: 260, padding: 24, textAlign: 'center', fontFamily: font }}>
        <div style={{ fontSize: 12, color: '#9CA3AF' }}>Loading...</div>
      </div>
    )
  }

  const trackingOn = !!toggles.track_document

  // ─── Main Panel ───
  return (
    <div style={{ width: 260, fontFamily: font }}>
      {/* ── User Profile Section ── */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #E5E7EB' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          {userAvatar ? (
            <img src={userAvatar} alt="" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
          ) : (
            <div style={{
              width: 32, height: 32, borderRadius: '50%', background: '#6366F1',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 600, color: '#fff', flexShrink: 0,
            }}>
              {userName ? userName[0]?.toUpperCase() : '?'}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0A0A0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {userName || 'User'}
            </div>
            <div style={{ fontSize: 10, color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {userEmail || ''}
            </div>
          </div>
        </div>
        {/* CTA buttons */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => chrome.tabs.create({ url: workspaceId ? `${DEFAULT_WEB_APP_URL}/workspace/${workspaceId}` : `${DEFAULT_WEB_APP_URL}/workspace` })}
            style={{
              flex: 1, padding: '5px 0', borderRadius: 5, border: '1px solid #E0E0E0',
              background: '#6366F1', color: '#fff',
              fontSize: 10, fontWeight: 500, cursor: 'pointer',
            }}
          >Workspace</button>
          <button
            onClick={() => chrome.tabs.create({ url: workspaceId ? `${DEFAULT_WEB_APP_URL}/workspace/${workspaceId}/docs` : `${DEFAULT_WEB_APP_URL}/workspace` })}
            style={{
              flex: 1, padding: '5px 0', borderRadius: 5, border: '1px solid #E0E0E0',
              background: '#fff', color: '#6B7280',
              fontSize: 10, fontWeight: 500, cursor: 'pointer',
            }}
          >Documents</button>
        </div>
      </div>

      {/* ── Current Document Section ── */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #E5E7EB' }}>
        <div style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          Current Document
        </div>

        {isOnDocPage ? (
          <>
            {/* Doc title + tracking toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
                <path d="M4 1h5.586L13 4.414V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="none" stroke={trackingOn ? '#7C3AED' : '#9CA3AF'} strokeWidth="1.2" />
                <path d="M9 1v4h4" fill="none" stroke={trackingOn ? '#7C3AED' : '#9CA3AF'} strokeWidth="1.2" />
              </svg>
              <span style={{
                flex: 1, fontSize: 11, fontWeight: 500,
                color: '#0A0A0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {docTitle || 'Untitled Document'}
              </span>
              <div onClick={() => handleToggle('track_document')}>
                <Toggle on={trackingOn} color="#7C3AED" small />
              </div>
            </div>

            {/* Tracking status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
              <div style={{
                width: 5, height: 5, borderRadius: '50%',
                background: trackingOn ? '#16A34A' : '#D1D5DB',
              }} />
              <span style={{ fontSize: 9, color: trackingOn ? '#16A34A' : '#9CA3AF' }}>
                {trackingOn ? 'Tracking active' : 'Tracking off'}
              </span>
            </div>

            {/* Collaborators toggle */}
            <div
              onClick={() => setShowCollaborators(!showCollaborators)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 6px', borderRadius: 5, cursor: 'pointer',
                background: showCollaborators ? '#F5F3FF' : 'transparent',
                transition: 'background 0.15s ease',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
                <circle cx="6" cy="5" r="2.5" fill="none" stroke="#7C3AED" strokeWidth="1.2" />
                <path d="M1 14c0-2.76 2.24-5 5-5s5 2.24 5 5" fill="none" stroke="#7C3AED" strokeWidth="1.2" />
                <circle cx="11" cy="5" r="2" fill="none" stroke="#7C3AED" strokeWidth="1" opacity="0.5" />
                <path d="M12 9c1.66 0 3 1.34 3 3v2" fill="none" stroke="#7C3AED" strokeWidth="1" opacity="0.5" />
              </svg>
              <span style={{ flex: 1, fontSize: 10, color: '#6B7280', fontWeight: 500 }}>
                Collaborators {collaborators.length > 0 && `(${collaborators.length})`}
              </span>
              <ChevronIcon open={showCollaborators} />
            </div>

            {/* Collaborator list */}
            {showCollaborators && (
              <div style={{ padding: '4px 0 0 20px' }}>
                {collaborators.length === 0 ? (
                  <div style={{ fontSize: 10, color: '#9CA3AF', fontStyle: 'italic', padding: '2px 0' }}>
                    No collaborators active
                  </div>
                ) : (
                  collaborators.map((name, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#16A34A', flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: '#0A0A0A' }}>{name}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic', padding: '4px 0' }}>
            No document open
          </div>
        )}
      </div>

      {/* ── Web Following Section ── */}
      {isOnWebPage && !isOnDocPage && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Current Page
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
              <circle cx="8" cy="8" r="6.5" fill="none" stroke={toggles.follow_web ? '#0EA5E9' : '#9CA3AF'} strokeWidth="1.2" />
              <path d="M8 1.5C8 1.5 4 5 4 8s4 6.5 4 6.5M8 1.5C8 1.5 12 5 12 8s-4 6.5-4 6.5M2 8h12" fill="none" stroke={toggles.follow_web ? '#0EA5E9' : '#9CA3AF'} strokeWidth="1" />
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 11, fontWeight: 500, color: '#0A0A0A',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {webPageTitle}
              </div>
              <div style={{ fontSize: 9, color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {webPageDomain}
              </div>
            </div>
            <div onClick={() => handleToggle('follow_web')}>
              <Toggle on={!!toggles.follow_web} color="#0EA5E9" small />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: toggles.follow_web ? '#0EA5E9' : '#D1D5DB',
            }} />
            <span style={{ fontSize: 9, color: toggles.follow_web ? '#0EA5E9' : '#9CA3AF' }}>
              {toggles.follow_web ? 'Following your browsing' : 'Web follow off'}
            </span>
          </div>
        </div>
      )}

      {/* ── Feature Toggles ── */}
      <div style={{ padding: '6px 10px 8px' }}>
        {FEATURES.filter(f => f.key !== 'track_document').map(feat => {
          const on = !!toggles[feat.key]
          const disabled = feat.docOnly && !isOnDocPage
          return (
            <div
              key={feat.key}
              onClick={() => !disabled && handleToggle(feat.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 8px', borderRadius: 6,
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.35 : 1,
                background: on ? feat.colorBg : 'transparent',
                transition: 'background 0.15s ease',
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: on ? feat.color : '#D1D5DB', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 11, color: on ? '#0A0A0A' : '#6B7280', fontWeight: on ? 600 : 400 }}>{feat.label}</span>
              <Toggle on={on} color={feat.color} />
            </div>
          )
        })}
      </div>

      {/* ── Footer ── */}
      <div style={{ borderTop: '1px solid #E5E7EB', padding: '6px 14px', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={handleLogout}
          style={{
            padding: '4px 10px', borderRadius: 5, border: '1px solid #E0E0E0',
            background: 'transparent', color: '#6B7280',
            fontSize: 10, fontWeight: 500, cursor: 'pointer',
          }}
        >Logout</button>
      </div>
    </div>
  )
}

const root = document.getElementById('popup-root')
if (root) {
  createRoot(root).render(<Popup />)
}
