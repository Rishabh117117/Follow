/**
 * Document Activation popup content.
 * Shown in the extension popup when the user wants to activate a document.
 * This is a reusable component — also used inline in the content script.
 */

import React, { useState } from 'react'
import { COLORS } from '@/lib/constants'

interface ActivationPopupProps {
  title: string
  onActivate: (strandId?: string) => void
  isLoading?: boolean
}

export function ActivationPopup({ title, onActivate, isLoading }: ActivationPopupProps) {
  const [selectedStrand, setSelectedStrand] = useState<string | undefined>(undefined)

  return (
    <div style={{ padding: 16 }}>
      {/* Document info */}
      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: COLORS.text, marginBottom: 4 }}>
          {title}
        </p>
        <p style={{ fontSize: 12, color: COLORS.textSecondary }}>
          This document is not yet a tracked Document.
        </p>
      </div>

      {/* Activate button */}
      <button
        onClick={() => onActivate(selectedStrand)}
        disabled={isLoading}
        style={{
          width: '100%',
          padding: '10px 16px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 500,
          background: COLORS.primary,
          color: '#fff',
          cursor: isLoading ? 'wait' : 'pointer',
          opacity: isLoading ? 0.7 : 1,
          border: 'none',
          marginBottom: 12,
        }}
      >
        {isLoading ? 'Activating...' : 'Activate Document'}
      </button>

      {/* What happens list */}
      <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
        <p style={{ fontWeight: 500, marginBottom: 6, color: COLORS.text }}>What happens:</p>
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ color: COLORS.primary }}>+</span>
            Tracks edits and builds provenance
          </li>
          <li style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ color: COLORS.primary }}>+</span>
            AI gets full document context
          </li>
          <li style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ color: COLORS.primary }}>+</span>
            Threads form automatically
          </li>
          <li style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ color: COLORS.primary }}>+</span>
            Connected to your workspace strand
          </li>
        </ul>
      </div>
    </div>
  )
}
