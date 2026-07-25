/**
 * Settle Animation overlay — shows a green tint that fades out over 3 seconds
 * on paragraphs where ghost drafts were committed or revisions were accepted.
 *
 * Tracks paragraph positions via getParagraphBounds() from dom-bridge.
 * Scroll-tracked with requestAnimationFrame.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { getParagraphBounds } from '@/content/dom-bridge'
import { useOverlayStore } from '@/stores/overlay-store'

export function SettleAnimationOverlay() {
  const settleAnchors = useOverlayStore((s) => s.settleAnchors)
  const clearExpiredSettles = useOverlayStore((s) => s.clearExpiredSettles)

  // Periodically clear expired settle animations
  useEffect(() => {
    if (settleAnchors.length === 0) return
    const timer = setInterval(clearExpiredSettles, 500)
    return () => clearInterval(timer)
  }, [settleAnchors.length, clearExpiredSettles])

  if (settleAnchors.length === 0) return null

  return (
    <>
      {settleAnchors.map((anchor) => (
        <SettleHighlight key={anchor.id} paragraphIndex={anchor.paragraphIndex} expiresAt={anchor.expiresAt} />
      ))}
    </>
  )
}

function SettleHighlight({ paragraphIndex, expiresAt }: { paragraphIndex: number; expiresAt: number }) {
  const [bounds, setBounds] = useState<DOMRect | null>(null)
  const [opacity, setOpacity] = useState(1)
  const rafRef = useRef<number>(0)

  const updatePosition = useCallback(() => {
    const rect = getParagraphBounds(paragraphIndex)
    if (rect) setBounds(rect)

    // Fade opacity based on time remaining
    const remaining = expiresAt - Date.now()
    const total = 3000 // 3 second total
    setOpacity(Math.max(0, remaining / total))
  }, [paragraphIndex, expiresAt])

  useEffect(() => {
    updatePosition()

    const editorEl = document.querySelector('.kix-appview-editor')
    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(updatePosition)
    }

    // Update frequently for smooth fade
    const fadeTimer = setInterval(updatePosition, 100)

    editorEl?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      editorEl?.removeEventListener('scroll', onScroll)
      window.removeEventListener('scroll', onScroll)
      clearInterval(fadeTimer)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [updatePosition])

  if (!bounds || opacity <= 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: bounds.top,
        left: bounds.left,
        width: bounds.width,
        height: bounds.height,
        borderLeft: `2px solid rgba(22,163,74,${0.4 * opacity})`,
        background: `rgba(22,163,74,${0.03 * opacity})`,
        pointerEvents: 'none',
        transition: 'opacity 200ms ease',
        zIndex: 130,
      }}
    />
  )
}
