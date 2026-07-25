'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { api } from '@/lib/api-client'

interface AccountRow {
  provider: string
  type: string
}

export default function ConnectedPage() {
  const { data: accountsResp } = useQuery({
    queryKey: ['me', 'accounts'],
    queryFn: () => api.get<AccountRow[]>('/api/users/me/accounts'),
  })
  const accounts = accountsResp?.data ?? []

  const [extensionDetected, setExtensionDetected] = useState<boolean | null>(null)
  useEffect(() => {
    // Ping extension
    let gotReply = false
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window) return
      if (e.data?.type === 'FOLLOW_EXTENSION_PONG') {
        gotReply = true
        setExtensionDetected(true)
      }
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ type: 'FOLLOW_EXTENSION_PING' }, '*')
    const timer = setTimeout(() => {
      if (!gotReply) setExtensionDetected(false)
    }, 500)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
    }
  }, [])

  const googleConnected = accounts.some((a) => a.provider === 'google')

  return (
    <div className="space-y-10">
      <header>
        <h1
          className="text-[28px] leading-tight"
          style={{
            fontFamily: 'Newsreader, Georgia, serif',
            color: 'var(--n950)',
            fontWeight: 500,
          }}
        >
          Connected Apps
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--n500)' }}>
          Manage apps and services linked to your Follow account.
        </p>
      </header>

      <section>
        <div
          className="rounded-lg border bg-white"
          style={{ borderColor: 'var(--n200)' }}
        >
          {/* Google Workspace */}
          <div className="flex items-center justify-between px-4 py-4">
            <div className="flex items-center gap-3">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor: googleConnected ? 'var(--ok, #22C55E)' : 'var(--n300)',
                }}
              />
              <div>
                <div className="text-[13px]" style={{ color: 'var(--n950)' }}>
                  Google Workspace
                </div>
                <div className="text-[11px]" style={{ color: 'var(--n500)' }}>
                  {googleConnected
                    ? 'Google Docs, Sheets, and Drive integration.'
                    : 'Connect to track Google Docs as Smart Documents.'}
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                if (!googleConnected) signIn('google')
              }}
              disabled={googleConnected}
              className="rounded-md border bg-white px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-gray-50 disabled:opacity-50"
              style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
            >
              {googleConnected ? 'Disconnect' : 'Connect'}
            </button>
          </div>

          {/* Chrome Extension */}
          <div
            className="flex items-center justify-between px-4 py-4"
            style={{ borderTop: '1px solid var(--n150)' }}
          >
            <div className="flex items-center gap-3">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor:
                    extensionDetected === true
                      ? 'var(--ok, #22C55E)'
                      : extensionDetected === false
                        ? 'var(--n300)'
                        : 'var(--n200)',
                }}
              />
              <div>
                <div className="text-[13px]" style={{ color: 'var(--n950)' }}>
                  Follow Chrome Extension
                </div>
                <div className="text-[11px]" style={{ color: 'var(--n500)' }}>
                  {extensionDetected === true
                    ? 'Extension detected and active.'
                    : extensionDetected === false
                      ? 'Install the extension to capture web content.'
                      : 'Checking…'}
                </div>
              </div>
            </div>
            {extensionDetected === false && (
              <a
                href="#"
                className="rounded-md border bg-white px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-gray-50"
                style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
              >
                Install
              </a>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
