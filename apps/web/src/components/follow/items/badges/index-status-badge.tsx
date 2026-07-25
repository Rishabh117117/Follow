'use client'

import { useState } from 'react'
import { type IndexFileStatus, phaseLabel, phaseColor } from '../_shared'

export function IndexStatusBadge({
  fileId,
  status,
  onIndex,
  onCancel,
}: {
  fileId: string
  status: IndexFileStatus
  onIndex: (fileId: string) => void
  onCancel?: (jobId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const color = phaseColor(status)
  const label = phaseLabel(status)
  const canIndex = status.index === 'not_indexed' || status.index === 'failed'
  const active = status.index === 'queued' || status.index === 'indexing'
  const canCancel = active && !!status.jobId && !!onCancel

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        data-testid={`idx-upload-${fileId}`}
        style={{
          fontSize: 9,
          fontFamily: 'monospace',
          padding: '1px 6px',
          borderRadius: 4,
          background: 'rgba(45,138,78,0.12)',
          color: '#2d8a4e',
        }}
      >
        Uploaded
      </span>
      <button
        type="button"
        data-testid={`idx-badge-${fileId}`}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        style={{
          fontSize: 9,
          fontFamily: 'monospace',
          padding: '1px 6px',
          borderRadius: 4,
          background: color.bg,
          color: color.fg,
          border: 'none',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span>{label}</span>
        <span style={{ opacity: 0.6 }}>▾</span>
      </button>
      {canIndex && (
        <button
          type="button"
          data-testid={`idx-now-${fileId}`}
          disabled={busy}
          onClick={async (e) => {
            e.stopPropagation()
            setBusy(true)
            try {
              onIndex(fileId)
            } finally {
              setBusy(false)
            }
          }}
          style={{
            fontSize: 9,
            fontFamily: 'monospace',
            padding: '1px 7px',
            borderRadius: 4,
            border: `1px solid #6C63FF`,
            background: busy ? 'rgba(108,99,255,0.15)' : 'rgba(108,99,255,0.08)',
            color: '#6C63FF',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? '…' : 'Index'}
        </button>
      )}
      {open && (
        <div
          data-testid={`idx-popover-${fileId}`}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: '#fff',
            border: '1px solid var(--n150, #e5e2de)',
            borderRadius: 8,
            boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
            padding: 10,
            minWidth: 240,
            zIndex: 40,
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--n700, #4d473c)',
          }}
        >
          <div style={{ fontWeight: 500, marginBottom: 4, color: 'var(--n900, #1f1a11)' }}>
            Indexing status
          </div>
          <div>
            <strong>Upload:</strong> {status.upload}
          </div>
          <div>
            <strong>Index:</strong> {label}
          </div>
          {status.phase && (
            <div>
              <strong>Phase:</strong> {status.phase}
            </div>
          )}
          {typeof status.chunksTotal === 'number' && status.chunksTotal > 0 && (
            <div>
              <strong>Chunks:</strong> {status.chunksDone ?? 0} / {status.chunksTotal}
            </div>
          )}
          {typeof status.etaMs === 'number' && status.etaMs > 0 && (
            <div>
              <strong>ETA:</strong> {Math.max(1, Math.round(status.etaMs / 1000))}s
            </div>
          )}
          {status.jobId && (
            <div style={{ color: 'var(--n400, #9c968d)', fontFamily: 'monospace', marginTop: 4 }}>
              job {status.jobId}
            </div>
          )}
          {status.errorMessage && (
            <div
              style={{
                marginTop: 6,
                color: '#c53030',
                background: 'rgba(197,48,48,0.08)',
                padding: 6,
                borderRadius: 4,
              }}
            >
              {status.errorMessage}
            </div>
          )}
          {active && (
            <div style={{ marginTop: 6, color: 'var(--n500, #807a70)' }}>
              Refreshing automatically…
            </div>
          )}
          {canCancel && (
            <button
              type="button"
              data-testid={`idx-cancel-${fileId}`}
              disabled={cancelBusy}
              onClick={async (e) => {
                e.stopPropagation()
                if (!status.jobId || !onCancel) return
                setCancelBusy(true)
                try {
                  await onCancel(status.jobId)
                } finally {
                  setCancelBusy(false)
                  setOpen(false)
                }
              }}
              style={{
                marginTop: 8,
                width: '100%',
                fontSize: 10,
                fontFamily: 'monospace',
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid #c53030',
                background: cancelBusy ? 'rgba(197,48,48,0.1)' : 'transparent',
                color: '#c53030',
                cursor: cancelBusy ? 'default' : 'pointer',
              }}
            >
              {cancelBusy ? 'Cancelling…' : 'Cancel / Stop'}
            </button>
          )}
        </div>
      )}
    </span>
  )
}
