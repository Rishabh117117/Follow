'use client'

/**
 * DragDropOverlay (Sprint CTX-1)
 *
 * Full-screen fixed overlay shown while files are being dragged over the app.
 */
export function DragDropOverlay() {
  return (
    <div
      data-testid="drag-drop-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(108, 99, 255, 0.12)',
        border: '3px dashed #6C63FF',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 900,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          fontSize: 42,
          marginBottom: 12,
          color: '#6C63FF',
          fontFamily: 'monospace',
        }}
      >
        ⬇
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: '#6C63FF',
          marginBottom: 6,
        }}
      >
        Drop files to add to your index
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--n600, #6b6358)',
        }}
      >
        Documents, images, code, PDFs — any file type
      </div>
    </div>
  )
}
