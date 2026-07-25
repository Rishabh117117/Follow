/**
 * FloatingUnit — 3-state floating chat widget.
 *
 * States: dot (38x38 circle) → collapsed (680px input bar) → expanded (full chat panel)
 */

import React from 'react'
import { useFloatingUnitStore } from '../../stores/floating-unit-store'
import { UnitChatPanel } from './UnitChatPanel'
import { COLORS } from '../../lib/constants'

export function FloatingUnit() {
  const { panelState, restore } = useFloatingUnitStore()

  // ─── Dot state ───
  if (panelState === 'dot') {
    return (
      <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 2147483646 }}>
        <button
          onClick={() => restore()}
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: COLORS.primary,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(99,102,241,0.4)',
            border: 'none',
            cursor: 'pointer',
            transition: 'transform 150ms ease',
            fontSize: 13,
            fontWeight: 700,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.10)' }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
          title="Open Follow (Ctrl+J)"
        >
          F
        </button>
      </div>
    )
  }

  // ─── Collapsed / Expanded ───
  return <UnitChatPanel />
}
