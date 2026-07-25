'use client'

/**
 * EraseDialog (2026-04-29)
 *
 * Hard-confirm dialog for the GDPR-style erase action. Two guards:
 *   1. The user must type the literal word "ERASE" to enable the button.
 *   2. The user must enter a non-empty reason — it lands in evidence_records
 *      so an auditor can later see why something was erased.
 *
 * Posts to POST /api/index/items/:id/erase. The backend redacts the
 * audit row's contentBefore on success and the GC sweeps the row on
 * its next pass.
 */

import { useState } from 'react'
import { authFetch } from '@/lib/api-client'

const CONFIRM_TOKEN = 'ERASE'

export type EraseKind = 'conv' | 'file' | 'rawfile' | 'fact'

export interface EraseDialogProps {
  itemId: string
  itemName: string
  /** Routes the erase to the right backend. 'fact' goes through the new
   *  audited /api/index/items/:id/erase; the others hit their existing
   *  delete endpoints since they don't have an audit-row contract yet. */
  kind: EraseKind
  onClose: () => void
  onErased?: () => void
}

interface EraseRoute {
  url: string
  method: 'POST' | 'DELETE'
  bodyJson: boolean
  /** True when the backend writes a hash-chained audit row + redacts content.
   *  Only the 'fact' path does this today; other kinds are plain hard deletes
   *  via the existing endpoints. UI explains the difference inline. */
  audited: boolean
}

function routeFor(kind: EraseKind, itemId: string): EraseRoute {
  if (kind === 'fact') {
    return {
      url: `/api/index/items/${itemId}/erase`,
      method: 'POST',
      bodyJson: true,
      audited: true,
    }
  }
  if (kind === 'conv') {
    return {
      url: `/api/chat/conversations/${itemId}`,
      method: 'DELETE',
      bodyJson: false,
      audited: false,
    }
  }
  if (kind === 'rawfile') {
    return {
      url: `/api/raw-files/${itemId}`,
      method: 'DELETE',
      bodyJson: false,
      audited: false,
    }
  }
  // 'file'
  return {
    url: `/api/files/${itemId}`,
    method: 'DELETE',
    bodyJson: false,
    audited: false,
  }
}

export function EraseDialog({ itemId, itemName, kind, onClose, onErased }: EraseDialogProps) {
  const [reason, setReason] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const route = routeFor(kind, itemId)
  // Reason is only required for the audited (fact) path; for plain deletes
  // the typed-confirm token is enough.
  const reasonOk = !route.audited || reason.trim().length >= 4
  const tokenOk = token === CONFIRM_TOKEN
  const ready = reasonOk && tokenOk && !busy

  const submit = async () => {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const init: RequestInit = { method: route.method }
      if (route.bodyJson) {
        init.headers = { 'Content-Type': 'application/json' }
        init.body = JSON.stringify({ reason: reason.trim() })
      }
      const res = await authFetch(route.url, init)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error?.message ?? `Server returned ${res.status}`)
      }
      window.dispatchEvent(new Event('follow:items-changed'))
      onErased?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="erase-dialog-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 15, 20, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        data-testid="erase-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          border: '1px solid var(--n150, #e5e2de)',
          borderRadius: 10,
          padding: 24,
          width: 480,
          maxWidth: '92vw',
          boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: '#9b1c1c',
            marginBottom: 8,
          }}
        >
          Erase permanently?
        </div>
        <div
          style={{
            fontSize: 13,
            color: 'var(--n600, #6b6358)',
            lineHeight: 1.55,
            marginBottom: 16,
          }}
        >
          {route.audited ? (
            <>
              <strong>{itemName}</strong> will be removed and its content redacted from the audit
              trail. The hash chain stays intact so you can prove an item was here, but the content
              is gone. <strong>This cannot be undone.</strong>
            </>
          ) : (
            <>
              <strong>{itemName}</strong> will be permanently deleted. There is no soft-delete
              window for this item type — once erased, it is gone immediately.{' '}
              <strong>This cannot be undone.</strong>
            </>
          )}
        </div>

        {route.audited && (
          <>
            <label
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--n700, #494339)',
                marginBottom: 4,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
            >
              Reason for erasure
            </label>
            <textarea
              data-testid="erase-dialog-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. GDPR right-to-be-forgotten request from contributor"
              rows={2}
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: 12,
                border: '1px solid var(--n200, #d8d4cf)',
                borderRadius: 6,
                fontFamily: 'inherit',
                resize: 'vertical',
                marginBottom: 12,
              }}
            />
          </>
        )}

        <label
          style={{
            display: 'block',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--n700, #494339)',
            marginBottom: 4,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          Type <span style={{ fontFamily: 'monospace', color: '#9b1c1c' }}>{CONFIRM_TOKEN}</span> to
          confirm
        </label>
        <input
          data-testid="erase-dialog-token"
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          style={{
            width: '100%',
            padding: '8px 10px',
            fontSize: 12,
            fontFamily: 'monospace',
            border: '1px solid var(--n200, #d8d4cf)',
            borderRadius: 6,
            marginBottom: 16,
          }}
        />

        {error && (
          <div
            style={{
              padding: '8px 10px',
              fontSize: 12,
              color: '#9b1c1c',
              background: 'rgba(155,28,28,0.08)',
              borderRadius: 4,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            data-testid="erase-dialog-cancel"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: '7px 14px',
              fontSize: 12,
              border: '1px solid var(--n200, #d8d4cf)',
              borderRadius: 6,
              background: '#fff',
              color: 'var(--n700, #494339)',
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            data-testid="erase-dialog-confirm"
            onClick={() => void submit()}
            disabled={!ready}
            style={{
              padding: '7px 14px',
              fontSize: 12,
              border: '1px solid #9b1c1c',
              borderRadius: 6,
              background: ready ? '#9b1c1c' : 'rgba(155,28,28,0.4)',
              color: '#fff',
              cursor: ready ? 'pointer' : 'not-allowed',
              fontWeight: 500,
            }}
          >
            {busy ? 'Erasing…' : 'Erase permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}
