'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, API_BASE } from '@/lib/api-client'

interface KeyRow {
  id: string
  name: string
  keyPrefix: string
  lastUsedAt: string | null
  createdAt: string
  expiresAt: string | null
}

interface MintedKey {
  id: string
  name: string
  keyPrefix: string
  rawKey: string
  createdAt: string
}

// The connector URL Claude (and other MCP clients) connect to. The query-key
// form is required for SSE clients that can't set Authorization headers.
function connectorUrl(rawKey: string): string {
  return `${API_BASE}/mcp?key=${rawKey}`
}

export default function ConnectorsPage() {
  const { data: keysResp, refetch } = useQuery({
    queryKey: ['mcp', 'keys'],
    queryFn: () => api.get<KeyRow[]>('/api/mcp/keys'),
  })
  const keys = keysResp?.data ?? []

  const [name, setName] = useState('')
  const [minting, setMinting] = useState(false)
  const [minted, setMinted] = useState<MintedKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'url' | 'key' | null>(null)

  async function mint() {
    setMinting(true)
    setError(null)
    try {
      const res = await api.post<MintedKey>('/api/mcp/keys', {
        name: name.trim() || 'MCP Key',
      })
      if (res.data) {
        setMinted(res.data)
        setName('')
        void refetch()
      } else {
        setError(res.error?.message ?? 'Failed to create key.')
      }
    } catch {
      setError('Could not reach the API. Try again.')
    } finally {
      setMinting(false)
    }
  }

  async function revoke(id: string) {
    await api.delete(`/api/mcp/keys/${id}`)
    if (minted?.id === id) setMinted(null)
    void refetch()
  }

  async function copy(text: string, which: 'url' | 'key') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // Clipboard blocked — user can select manually.
    }
  }

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
          Connectors
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--n500)' }}>
          Connect Claude (or any MCP client) to this workspace. Mint a key, copy the connector URL,
          and add it as a custom connector.
        </p>
      </header>

      {/* ── Mint a new key ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--n600)' }}>
              Key name (optional)
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Claude Desktop"
              className="w-full rounded-md border bg-white px-3 py-1.5 text-[13px] outline-none"
              style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
            />
          </label>
          <button
            onClick={() => void mint()}
            disabled={minting}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white transition-opacity disabled:opacity-50"
            style={{ backgroundColor: 'var(--n950)' }}
          >
            {minting ? 'Generating…' : 'Generate key'}
          </button>
        </div>
        {error && (
          <p className="text-[12px]" style={{ color: 'var(--danger, #DC2626)' }}>
            {error}
          </p>
        )}

        {/* Show the raw key + connector URL ONCE. */}
        {minted && (
          <div
            className="space-y-3 rounded-lg border p-4"
            style={{ borderColor: 'var(--n300)', backgroundColor: 'var(--n50, #FAFAF9)' }}
          >
            <p className="text-[12px]" style={{ color: 'var(--n700)' }}>
              Copy this now — the secret is shown <strong>once</strong> and can&apos;t be retrieved
              again.
            </p>

            <div>
              <span className="mb-1 block text-[11px]" style={{ color: 'var(--n500)' }}>
                Connector URL (paste into Claude)
              </span>
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border bg-white px-3 py-2 text-[12px]"
                  style={{ borderColor: 'var(--n200)', color: 'var(--n950)' }}
                >
                  {connectorUrl(minted.rawKey)}
                </code>
                <button
                  onClick={() => void copy(connectorUrl(minted.rawKey), 'url')}
                  className="shrink-0 rounded-md border bg-white px-3 py-2 text-[12px] font-medium hover:bg-gray-50"
                  style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
                >
                  {copied === 'url' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div>
              <span className="mb-1 block text-[11px]" style={{ color: 'var(--n500)' }}>
                Raw key (if you need just the secret)
              </span>
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border bg-white px-3 py-2 text-[12px]"
                  style={{ borderColor: 'var(--n200)', color: 'var(--n950)' }}
                >
                  {minted.rawKey}
                </code>
                <button
                  onClick={() => void copy(minted.rawKey, 'key')}
                  className="shrink-0 rounded-md border bg-white px-3 py-2 text-[12px] font-medium hover:bg-gray-50"
                  style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
                >
                  {copied === 'key' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <p className="text-[11px]" style={{ color: 'var(--n500)' }}>
              In Claude → Settings → Connectors → Add custom connector → paste the URL above.
            </p>
          </div>
        )}
      </section>

      {/* ── Existing keys ──────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-[13px] font-medium" style={{ color: 'var(--n700)' }}>
          Active keys
        </h2>
        <div className="rounded-lg border bg-white" style={{ borderColor: 'var(--n200)' }}>
          {keys.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px]" style={{ color: 'var(--n500)' }}>
              No keys yet. Generate one above to connect Claude.
            </div>
          ) : (
            keys.map((k, i) => (
              <div
                key={k.id}
                className="flex items-center justify-between px-4 py-3"
                style={i > 0 ? { borderTop: '1px solid var(--n150)' } : undefined}
              >
                <div>
                  <div className="text-[13px]" style={{ color: 'var(--n950)' }}>
                    {k.name}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--n500)' }}>
                    <code>{k.keyPrefix}…</code> · created{' '}
                    {new Date(k.createdAt).toLocaleDateString()}
                    {k.lastUsedAt
                      ? ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                      : ' · never used'}
                  </div>
                </div>
                <button
                  onClick={() => void revoke(k.id)}
                  className="rounded-md border bg-white px-3 py-1.5 text-[12px] font-medium hover:bg-gray-50"
                  style={{ borderColor: 'var(--n300)', color: 'var(--danger, #DC2626)' }}
                >
                  Revoke
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
