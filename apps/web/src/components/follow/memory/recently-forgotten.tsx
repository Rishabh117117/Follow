'use client'

/**
 * Recently Forgotten Bin (2026-04-29)
 *
 * Lists tombstoned index_records for the current user, with a Restore
 * button that brings them back. Powered by:
 *   GET  /api/index/items/tombstoned
 *   POST /api/index/items/:id/restore
 *
 * Erased (GDPR-style) items are excluded server-side — the API filters by
 * retentionPolicy != 'redacted'. So everything shown here is restorable.
 *
 * Auto-refreshes when `follow:items-changed` fires, so a forget elsewhere
 * in the UI flows in here without a manual reload.
 */

import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '@/lib/api-client'

interface ForgottenItem {
  id: string
  documentTitle: string | null
  sectionAlias: string | null
  embeddingText: string
  deletedAt: string | null
  deletedByName: string | null
  deletionReason: string | null
  deletionScope: string | null
  retentionPolicy: string
  expiresAt: string | null
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = now - t
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function fmtExpiresIn(iso: string | null): string {
  if (!iso) return '—'
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const days = Math.round(ms / (24 * 60 * 60 * 1000))
  if (days <= 1) return 'expires today'
  return `expires in ${days}d`
}

export function RecentlyForgottenBin() {
  const [items, setItems] = useState<ForgottenItem[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/index/items/tombstoned?limit=100')
      const json = await res.json()
      if (json.error) {
        setError(json.error.message ?? 'Failed to load')
        return
      }
      setItems((json.data as ForgottenItem[]) ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
    const onChanged = () => void load()
    window.addEventListener('follow:items-changed', onChanged)
    return () => window.removeEventListener('follow:items-changed', onChanged)
  }, [load])

  const restore = useCallback(async (id: string) => {
    setBusy(id)
    try {
      await authFetch(`/api/index/items/${id}/restore`, { method: 'POST' })
      // Optimistically drop the row + ping the rest of the items view to refresh.
      setItems((prev) => prev.filter((i) => i.id !== id))
      window.dispatchEvent(new Event('follow:items-changed'))
    } catch {
      /* leave the row visible if restore failed */
    } finally {
      setBusy(null)
    }
  }, [])

  if (items.length === 0 && !error) return null

  return (
    <div
      style={{
        marginTop: 16,
        borderTop: '1px dashed var(--n200, #d4cfc6)',
        paddingTop: 12,
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '8px 12px',
          background: 'transparent',
          border: '1px solid var(--n200, #d4cfc6)',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 11,
          color: 'var(--n500, #666)',
          fontFamily: 'monospace',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
        data-testid="recently-forgotten-toggle"
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>Recently forgotten ({items.length})</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--n400, #9c968d)' }}>
          restore within 30 days · then permanent
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 8 }}>
          {error && (
            <div
              style={{
                padding: '6px 10px',
                fontSize: 11,
                color: '#b91c1c',
                background: 'rgba(185,28,28,0.06)',
                borderRadius: 4,
                marginBottom: 8,
              }}
            >
              {error}
            </div>
          )}
          {items.map((it) => (
            <div
              key={it.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '8px 12px',
                borderBottom: '1px solid var(--n100, #f0eeeb)',
                fontSize: 12,
                opacity: 0.85,
              }}
              data-testid="recently-forgotten-row"
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: 'var(--n600, #333)',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {it.documentTitle || it.embeddingText.slice(0, 80) || '(no title)'}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--n400, #9c968d)',
                    fontFamily: 'monospace',
                    marginTop: 2,
                  }}
                >
                  forgotten {fmtRelative(it.deletedAt)}
                  {it.deletedByName ? ` by ${it.deletedByName}` : ''}
                  {it.deletionScope === 'source' ? ' · whole source' : ''}
                  {' · '}
                  {fmtExpiresIn(it.expiresAt)}
                </div>
              </div>
              <button
                onClick={() => void restore(it.id)}
                disabled={busy === it.id}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  borderRadius: 4,
                  border: '1px solid var(--n300, #b0a99c)',
                  background: '#fff',
                  cursor: busy === it.id ? 'wait' : 'pointer',
                  fontFamily: 'monospace',
                  color: 'var(--n600, #333)',
                  flexShrink: 0,
                }}
                data-testid="recently-forgotten-restore"
                title="Restore this item"
              >
                {busy === it.id ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
