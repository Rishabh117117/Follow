'use client'

export function ConfidenceDot({ value }: { value: number }) {
  const color = value > 0.9 ? '#2d8a4e' : value > 0.8 ? '#b7791f' : '#c53030'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 10,
        color,
        fontFamily: 'monospace',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
        }}
      />
      {Math.round(value * 100)}%
    </span>
  )
}
