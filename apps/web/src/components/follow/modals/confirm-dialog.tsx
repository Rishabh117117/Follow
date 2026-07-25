'use client'

/**
 * ConfirmDialog (Sprint CTX-1)
 *
 * Centered modal card for confirming destructive actions.
 */
export interface ConfirmDialogProps {
  name: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ name, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      data-testid="confirm-dialog-overlay"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 15, 20, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        data-testid="confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          border: '1px solid var(--n150, #e5e2de)',
          borderRadius: 10,
          padding: 24,
          width: 420,
          maxWidth: '90vw',
          boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--n800, #332e25)',
            marginBottom: 8,
          }}
        >
          Forget this item?
        </div>
        <div
          data-testid="confirm-dialog-message"
          style={{
            fontSize: 13,
            color: 'var(--n600, #6b6358)',
            lineHeight: 1.5,
            marginBottom: 20,
          }}
        >
          <strong>{name}</strong> will be removed from your index. You can restore it from{' '}
          <em>Recently forgotten</em> for the next 30 days. Use <em>Erase permanently</em> instead
          if you need it gone now.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            data-testid="confirm-dialog-cancel"
            onClick={onCancel}
            style={{
              padding: '7px 14px',
              fontSize: 12,
              border: '1px solid var(--n200, #d8d4cf)',
              borderRadius: 6,
              background: '#fff',
              color: 'var(--n700, #494339)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            style={{
              padding: '7px 14px',
              fontSize: 12,
              border: '1px solid #c53030',
              borderRadius: 6,
              background: '#c53030',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}
