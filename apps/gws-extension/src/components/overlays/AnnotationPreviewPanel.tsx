/**
 * Annotation system — two parts:
 *
 * 1. AnnotationNavigator — slim right-side panel (like Google Docs Find bar)
 *    listing all highlights with up/down arrows and current position indicator.
 *
 * 2. AnnotationHoverCard — Grammarly-style popover that appears when hovering
 *    over highlighted text in the document. Shows insight, category, rating.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useOverlayStore, type PendingAnnotation } from '@/stores/overlay-store'
import { scrollToTextInGoogleDoc, clearHighlightsFromGoogleDoc } from '@/lib/google-docs-api'
import { COLORS } from '@/lib/constants'

// ─── Category Config ────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  'key-concept':  { bg: '#FEF9C3', text: '#854D0E', dot: '#EAB308', label: 'Key Concept' },
  insight:        { bg: '#EDE9FE', text: '#5B21B6', dot: '#8B5CF6', label: 'Insight' },
  strength:       { bg: '#DCFCE7', text: '#166534', dot: '#22C55E', label: 'Strength' },
  weakness:       { bg: '#FEE2E2', text: '#991B1B', dot: '#EF4444', label: 'Weakness' },
  comparison:     { bg: '#DBEAFE', text: '#1E40AF', dot: '#3B82F6', label: 'Comparison' },
  evidence:       { bg: '#DCFCE7', text: '#166534', dot: '#22C55E', label: 'Evidence' },
  risk:           { bg: '#FEE2E2', text: '#991B1B', dot: '#EF4444', label: 'Risk' },
  opportunity:    { bg: '#FFF7ED', text: '#9A3412', dot: '#F97316', label: 'Opportunity' },
  definition:     { bg: '#DBEAFE', text: '#1E40AF', dot: '#3B82F6', label: 'Definition' },
  'action-item':  { bg: '#FFF7ED', text: '#9A3412', dot: '#F97316', label: 'Action Item' },
  question:       { bg: '#F3F4F6', text: '#374151', dot: '#6B7280', label: 'Question' },
  important:      { bg: '#FEF9C3', text: '#854D0E', dot: '#EAB308', label: 'Important' },
  conclusion:     { bg: '#EDE9FE', text: '#5B21B6', dot: '#8B5CF6', label: 'Conclusion' },
  argument:       { bg: '#DBEAFE', text: '#1E40AF', dot: '#3B82F6', label: 'Argument' },
}

const DEFAULT_CONFIG = { bg: '#F3F4F6', text: '#374151', dot: '#6B7280', label: 'Note' }

// ─── Rating Dots ────────────────────────────────────────────────────────

function RatingDots({ rating }: { rating: number }) {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            width: 5, height: 5, borderRadius: '50%',
            background: i <= rating ? '#6366F1' : '#E5E7EB',
          }}
        />
      ))}
      <span style={{ fontSize: 9, color: '#6B7280', marginLeft: 2 }}>{rating}/5</span>
    </div>
  )
}

// ─── Hover Card (Grammarly-style) ───────────────────────────────────────

interface AnnotationHoverCardProps {
  annotation: PendingAnnotation
  position: { top: number; left: number }
  onClose: () => void
}

export function AnnotationHoverCard({ annotation, position, onClose }: AnnotationHoverCardProps) {
  const config = CATEGORY_CONFIG[annotation.category] || DEFAULT_CONFIG
  const cardRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 50)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={cardRef}
      className="follow-interactive"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: 280,
        background: '#FFFFFF',
        border: `1px solid ${COLORS.borderLight}`,
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
        zIndex: 200,
        overflow: 'hidden',
        animation: 'followFadeIn 150ms ease',
      }}
    >
      {/* Category badge */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '6px 10px',
        background: config.bg,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: config.dot, flexShrink: 0,
        }} />
        <span style={{
          fontSize: 10, fontWeight: 700, color: config.text,
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {config.label}
        </span>
        {annotation.rating != null && annotation.rating > 0 && (
          <div style={{ marginLeft: 'auto' }}>
            <RatingDots rating={annotation.rating} />
          </div>
        )}
      </div>

      {/* Insight text */}
      <div style={{ padding: '8px 10px' }}>
        <p style={{
          fontSize: 12, lineHeight: 1.55,
          color: COLORS.text, margin: 0,
        }}>
          {annotation.insight}
        </p>
      </div>
    </div>
  )
}

// ─── Navigator Panel (right side, like Find bar) ────────────────────────

interface AnnotationNavigatorProps {
  googleDocId: string
}

function NavItem({
  annotation,
  isActive,
  onClick,
}: {
  annotation: PendingAnnotation
  isActive: boolean
  onClick: () => void
}) {
  const config = CATEGORY_CONFIG[annotation.category] || DEFAULT_CONFIG

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 8px',
        border: 'none',
        borderRadius: 6,
        background: isActive ? `${config.bg}` : 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        outline: isActive ? `2px solid ${config.dot}50` : 'none',
        outlineOffset: -1,
        transition: 'background 120ms ease',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: config.dot, flexShrink: 0,
      }} />
      <span style={{
        fontSize: 11, color: COLORS.text,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        flex: 1,
      }}>
        {annotation.spanText.length > 45
          ? annotation.spanText.slice(0, 45) + '...'
          : annotation.spanText}
      </span>
    </button>
  )
}

export function AnnotationNavigator({ googleDocId }: AnnotationNavigatorProps) {
  const annotations = useOverlayStore((s) => s.pendingAnnotations)
  const activeIndex = useOverlayStore((s) => s.activeAnnotationIndex)
  const setActiveIndex = useOverlayStore((s) => s.setActiveAnnotationIndex)
  const clearAnnotations = useOverlayStore((s) => s.clearAnnotations)
  const [clearing, setClearing] = useState(false)

  const navigateTo = useCallback((index: number) => {
    const ann = annotations[index]
    if (!ann) return
    setActiveIndex(index)
    scrollToTextInGoogleDoc(ann.spanText)
  }, [annotations, setActiveIndex])

  const handlePrev = useCallback(() => {
    const newIdx = activeIndex > 0 ? activeIndex - 1 : annotations.length - 1
    navigateTo(newIdx)
  }, [activeIndex, annotations.length, navigateTo])

  const handleNext = useCallback(() => {
    const newIdx = activeIndex < annotations.length - 1 ? activeIndex + 1 : 0
    navigateTo(newIdx)
  }, [activeIndex, annotations.length, navigateTo])

  const handleClear = useCallback(async () => {
    setClearing(true)
    // Remove highlights from the actual doc via Google Docs API
    try {
      const spans = annotations.map((a) => a.spanText)
      await clearHighlightsFromGoogleDoc(googleDocId, spans)
    } catch (err) {
      console.error('[Follow] Failed to clear highlights from doc:', err)
    }
    clearAnnotations()
    setClearing(false)
  }, [annotations, googleDocId, clearAnnotations])

  if (annotations.length === 0) return null

  return (
    <div
      className="follow-interactive"
      style={{
        position: 'fixed',
        top: 72,
        right: 8,
        width: 260,
        maxHeight: 'calc(100vh - 144px)',
        display: 'flex',
        flexDirection: 'column',
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 10,
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        zIndex: 190,
        overflow: 'hidden',
      }}
    >
      {/* Header with counter + nav arrows */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '7px 8px', gap: 4,
        borderBottom: `1px solid ${COLORS.borderLight}`,
        flexShrink: 0,
      }}>
        {/* Search icon */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={COLORS.primary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>

        {/* Position indicator */}
        <span style={{
          fontSize: 11, color: COLORS.text, fontWeight: 600,
          flex: 1,
        }}>
          {activeIndex + 1} of {annotations.length}
        </span>

        {/* Up arrow */}
        <button onClick={handlePrev} style={{
          border: 'none', background: 'none', cursor: 'pointer',
          padding: '2px 4px', color: COLORS.textSecondary, fontSize: 16,
          lineHeight: 1, borderRadius: 4, display: 'flex',
        }} title="Previous">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>

        {/* Down arrow */}
        <button onClick={handleNext} style={{
          border: 'none', background: 'none', cursor: 'pointer',
          padding: '2px 4px', color: COLORS.textSecondary, fontSize: 16,
          lineHeight: 1, borderRadius: 4, display: 'flex',
        }} title="Next">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Clear all */}
        <button
          onClick={handleClear}
          disabled={clearing}
          style={{
            border: 'none', background: 'none', cursor: clearing ? 'default' : 'pointer',
            padding: '2px 4px', color: clearing ? COLORS.textTertiary : COLORS.textSecondary,
            fontSize: 10, lineHeight: 1, borderRadius: 4,
          }}
          title="Clear all highlights"
        >
          {clearing ? '...' : '✕'}
        </button>
      </div>

      {/* Annotation list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
        {annotations.map((ann, i) => (
          <NavItem
            key={ann.id}
            annotation={ann}
            isActive={i === activeIndex}
            onClick={() => navigateTo(i)}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Legacy export (backwards compat with App.tsx import) ───────────────

export function AnnotationPreviewPanel({ googleDocId }: { googleDocId: string }) {
  return <AnnotationNavigator googleDocId={googleDocId} />
}
