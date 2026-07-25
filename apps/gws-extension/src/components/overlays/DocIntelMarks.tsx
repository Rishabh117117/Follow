/**
 * Document Intelligence Marks — colored underlines on Google Docs text
 * based on AI analysis. Scroll-tracked via requestAnimationFrame.
 *
 * Each mark maps a text range (startPara/startChar → endPara/endChar)
 * to screen-space bounding rects via dom-bridge.getTextRangeRects().
 *
 * Colors per type:
 *   clarity:     #f59e0b (amber)
 *   conciseness: #3b82f6 (blue)
 *   tone:        #8b5cf6 (violet)
 *   grammar:     #10b981 (emerald)
 *   structure:   #f43f5e (rose)
 *
 * Hover → show PreviewCard; dimming for non-matching filter.
 */

import React, { useEffect, useRef, useCallback } from 'react'
import { getTextRangeRects } from '@/content/dom-bridge'
import { useOverlayStore, type DocIntelMark, type DocIntelType } from '@/stores/overlay-store'

const TYPE_COLORS: Record<DocIntelType, string> = {
  clarity: '#f59e0b',
  conciseness: '#3b82f6',
  tone: '#8b5cf6',
  grammar: '#10b981',
  structure: '#f43f5e',
}

export function DocIntelMarksOverlay() {
  const marks = useOverlayStore((s) => s.marks)
  const setMarks = useOverlayStore((s) => s.setMarks)
  const setHoveredMark = useOverlayStore((s) => s.setHoveredMark)
  const rafRef = useRef<number>(0)

  // Recalculate bounding rects for all marks (scroll/resize tracking)
  const recalculateRects = useCallback(() => {
    const updated = marks.map((mark) => {
      const rects = getTextRangeRects(mark.startPara, mark.startChar, mark.endPara, mark.endChar)
      return { ...mark, rects }
    })
    // Only update if rects actually changed (avoid infinite loop)
    const hasChanges = updated.some((m, i) => {
      const old = marks[i]
      if (m.rects.length !== old.rects.length) return true
      return m.rects.some((r, j) => {
        const o = old.rects[j]
        return !o || Math.abs(r.top - o.top) > 1 || Math.abs(r.left - o.left) > 1
      })
    })
    if (hasChanges) setMarks(updated)
  }, [marks, setMarks])

  // Track scroll on editor
  useEffect(() => {
    if (marks.length === 0) return

    // Initial rect calculation
    recalculateRects()

    const editorEl = document.querySelector('.kix-appview-editor')
    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(recalculateRects)
    }

    editorEl?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })

    return () => {
      editorEl?.removeEventListener('scroll', onScroll)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [marks.length, recalculateRects])

  if (marks.length === 0) return null

  return (
    <>
      {marks.map((mark) => (
        <MarkUnderlines key={mark.id} mark={mark} onHover={setHoveredMark} />
      ))}
    </>
  )
}

function MarkUnderlines({
  mark,
  onHover,
}: {
  mark: DocIntelMark
  onHover: (id: string | null) => void
}) {
  const color = TYPE_COLORS[mark.type] || '#6B7280'

  if (mark.rects.length === 0) return null

  return (
    <>
      {mark.rects.map((rect, i) => (
        <div
          key={`${mark.id}_${i}`}
          style={{
            position: 'fixed',
            top: rect.bottom - 2,
            left: rect.left,
            width: rect.width,
            height: 2.5,
            borderRadius: 1,
            background: color,
            opacity: mark.dimmed ? 0.25 : 0.8,
            cursor: 'pointer',
            pointerEvents: 'auto',
            transition: 'opacity 200ms ease',
            zIndex: 140,
          }}
          onMouseEnter={() => onHover(mark.id)}
          onMouseLeave={() => onHover(null)}
        />
      ))}
    </>
  )
}

/**
 * Filter bar for doc intelligence marks — renders above the document.
 * Shows type buttons to filter which underlines are visible.
 */
export function DocIntelFilterBar() {
  const marks = useOverlayStore((s) => s.marks)
  const activeFilter = useOverlayStore((s) => s.activeFilter)
  const setFilter = useOverlayStore((s) => s.setFilter)
  const clearMarks = useOverlayStore((s) => s.clearMarks)

  if (marks.length === 0) return null

  const typeCounts: Record<string, number> = {}
  for (const m of marks) {
    typeCounts[m.type] = (typeCounts[m.type] || 0) + 1
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        background: '#FFFFFF',
        border: '1px solid #E5E7EB',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        zIndex: 200,
        pointerEvents: 'auto',
      }}
    >
      <FilterBtn
        label={`All (${marks.length})`}
        active={activeFilter === 'all'}
        color="#6B7280"
        onClick={() => setFilter('all')}
      />
      {(Object.keys(TYPE_COLORS) as DocIntelType[]).map((type) =>
        typeCounts[type] ? (
          <FilterBtn
            key={type}
            label={`${type} (${typeCounts[type]})`}
            active={activeFilter === type}
            color={TYPE_COLORS[type]}
            onClick={() => setFilter(type)}
          />
        ) : null
      )}
      <button
        onClick={clearMarks}
        style={{
          padding: '2px 6px', borderRadius: 4, fontSize: 10, color: '#9CA3AF',
          background: 'transparent', border: 'none', cursor: 'pointer', marginLeft: 4,
        }}
      >
        Clear
      </button>
    </div>
  )
}

function FilterBtn({
  label,
  active,
  color,
  onClick,
}: {
  label: string
  active: boolean
  color: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 10,
        fontWeight: active ? 600 : 400,
        color: active ? '#FFFFFF' : color,
        background: active ? color : 'transparent',
        border: `1px solid ${active ? color : `${color}40`}`,
        cursor: 'pointer',
        textTransform: 'capitalize',
      }}
    >
      {label}
    </button>
  )
}
