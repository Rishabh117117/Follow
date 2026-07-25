'use client'

// Generic iOS-style slide toggle. The whole row is labeled "Auto-update" in
// callsites; this component just paints + announces the state.
export function ToggleSwitch({
  on,
  disabled,
  busy,
  onChange,
  testId,
  label,
  title,
  onColor = '#2d8a4e',
}: {
  on: boolean
  disabled?: boolean
  busy?: boolean
  onChange: (next: boolean) => void
  testId?: string
  label: string
  title?: string
  onColor?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title ?? label}
      disabled={disabled || busy}
      onClick={() => onChange(!on)}
      data-testid={testId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '3px 10px 3px 4px',
        border: '1px solid ' + (on ? onColor : 'var(--n200,#d8d4cf)'),
        borderRadius: 999,
        background: on ? 'rgba(45,138,78,0.10)' : 'var(--n50,#fafafa)',
        cursor: disabled || busy ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'relative',
          width: 26,
          height: 14,
          background: on ? onColor : 'var(--n200,#d8d4cf)',
          borderRadius: 999,
          transition: 'background 150ms ease',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 1,
            left: on ? 13 : 1,
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
            transition: 'left 150ms ease',
          }}
        />
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: on ? onColor : 'var(--n600,#6b6358)',
          whiteSpace: 'nowrap',
          fontFamily: 'ui-monospace,monospace',
        }}
      >
        {busy ? '…' : label}
      </span>
    </button>
  )
}
