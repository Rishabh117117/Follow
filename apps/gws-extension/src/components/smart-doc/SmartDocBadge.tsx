/**
 * Document Badge — injected near Google Docs toolbar area.
 * Shows recording status, strand name, quick actions.
 *
 * Position: fixed near top-right of viewport (below Google's toolbar).
 * Rendered inside shadow DOM.
 */

import React, { useState } from 'react'
import { useSmartDocStore } from '@/stores/smart-doc-store'
import { useFloatingUnitStore } from '@/stores/floating-unit-store'
import { COLORS } from '@/lib/constants'

export function SmartDocBadge() {
  const { isActivated, isRecording, strandName, signalCount, setRecording } = useSmartDocStore()
  const { setActiveMode, expand } = useFloatingUnitStore()
  const [isHovered, setIsHovered] = useState(false)

  if (!isActivated) return null

  const handleClick = () => {
    setActiveMode('memory')
    expand()
  }

  return (
    <div
      className="follow-interactive"
      style={{
        position: 'fixed',
        top: 8,
        right: 200, // Positioned to the left of Google's Share button
        zIndex: 50,
      }}
    >
      <button
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="follow-animate-fade-in"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 99,
          fontSize: 11,
          fontWeight: 500,
          background: isRecording ? COLORS.greenBg : '#F5F5F5',
          color: isRecording ? COLORS.green : COLORS.textSecondary,
          border: `1px solid ${isRecording ? '#C8E6C9' : COLORS.borderLight}`,
          cursor: 'pointer',
          transition: 'all 200ms ease',
          whiteSpace: 'nowrap',
        }}
      >
        {/* Status indicator dot */}
        <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8 }}>
          {isRecording && (
            <span
              className="follow-animate-ping"
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                background: '#4CAF50',
                opacity: 0.75,
              }}
            />
          )}
          <span
            style={{
              position: 'relative',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isRecording ? '#4CAF50' : '#9E9E9E',
            }}
          />
        </span>

        {/* Label */}
        <span>{isRecording ? 'Document' : 'Paused'}</span>

        {/* Expanded hover state */}
        {isHovered && (
          <span style={{ color: COLORS.textTertiary, fontSize: 10 }}>
            {strandName ? `| ${strandName}` : ''} | {signalCount} events
          </span>
        )}
      </button>
    </div>
  )
}
