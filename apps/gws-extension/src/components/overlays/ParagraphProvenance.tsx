/**
 * ParagraphProvenance — shadow DOM popover on Google Docs text selection.
 * Shows who wrote the selected text, source attribution, and AI involvement.
 * Positioned near the selection via getBoundingClientRect.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useSmartDocStore } from '@/stores/smart-doc-store'
import { fetchExtensionParagraphProvenance, type ParagraphProvenanceResult } from '@/services/provenance-service'

const USER_COLORS = ['#7C3AED', '#2563EB', '#059669', '#D97706']

function hashToColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return USER_COLORS[Math.abs(h) % USER_COLORS.length]!
}

function getInitials(name: string): string {
  const p = name.trim().split(/\s+/)
  if (p.length >= 2) return (p[0]![0]! + p[1]![0]!).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(diffMs / 3600000)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(diffMs / 86400000)}d ago`
}

export function ParagraphProvenance() {
  const { followDocId } = useSmartDocStore()
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [data, setData] = useState<ParagraphProvenanceResult | null>(null)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const handleSelectionChange = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setVisible(false)
      setData(null)
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      if (!followDocId) return

      // Get selection position
      try {
        const range = sel.getRangeAt(0)
        const rect = range.getBoundingClientRect()

        // Extract heading context — walk up from the selection
        let heading = 'Document-wide'
        let el: Element | null = range.startContainer.parentElement
        while (el) {
          const tag = el.tagName?.toLowerCase()
          if (tag && /^h[1-6]$/.test(tag)) {
            heading = el.textContent || heading
            break
          }
          // Google Docs headings use spans with heading styles
          const style = el.getAttribute?.('style') || ''
          if (style.includes('font-size') && style.includes('font-weight')) {
            const text = el.textContent?.trim()
            if (text && text.length < 100) {
              heading = text
              break
            }
          }
          el = el.parentElement
        }

        // Position the card
        const left = rect.right + 8
        const top = rect.top
        const viewW = window.innerWidth
        setPosition({
          top,
          left: left + 240 > viewW ? rect.left - 248 : left,
        })
        setVisible(true)
        setLoading(true)

        const storage = await chrome.storage?.local?.get?.('follow_workspace_id').catch(() => ({}))
        const wsId = (storage as any)?.follow_workspace_id || 'default'
        const result = await fetchExtensionParagraphProvenance(wsId, followDocId, heading)
        setData(result)
        setLoading(false)
      } catch {
        setVisible(false)
      }
    }, 600)
  }, [followDocId])

  useEffect(() => {
    document.addEventListener('mouseup', handleSelectionChange)
    document.addEventListener('scroll', () => setVisible(false), true)
    return () => {
      document.removeEventListener('mouseup', handleSelectionChange)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [handleSelectionChange])

  if (!visible || !position) return null

  return (
    <div
      className="follow-interactive"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: 240,
        background: 'white',
        border: '1px solid #D4D3CF',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
        padding: 12,
        zIndex: 2147483645,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(4px)',
        transition: 'opacity 200ms ease-out, transform 200ms ease-out',
      }}
    >
      <div style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: '#d4d4d4', letterSpacing: '0.06em', marginBottom: 8 }}>
        PROVENANCE
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ height: 10, background: '#f5f5f5', borderRadius: 3, animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
      ) : data && (data.lastEditor || data.source || data.aiInvolvement) ? (
        <>
          {data.lastEditor && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <div style={{ width: 16, height: 16, borderRadius: 8, background: hashToColor(data.lastEditor.name), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 6, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: 'white' }}>{getInitials(data.lastEditor.name)}</span>
              </div>
              <span style={{ fontSize: 11, fontWeight: 500, color: '#262626' }}>{data.lastEditor.name}</span>
              <span style={{ fontSize: 9, color: '#a3a3a3' }}>{formatRelativeTime(data.lastEditor.timestamp)}</span>
            </div>
          )}

          {data.source && (
            <div style={{ padding: '5px 7px', background: '#EFF6FF', borderRadius: 5, marginBottom: 6, display: 'flex', gap: 5 }}>
              <span style={{ fontSize: 10 }}>📎</span>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, color: '#2563EB' }}>{data.source.title}</div>
                {data.source.browseDuration && <div style={{ fontSize: 9, color: '#737373' }}>Browsed {data.source.browseDuration}s</div>}
              </div>
            </div>
          )}

          {data.aiInvolvement && (
            <div style={{ padding: '5px 7px', background: '#F3EFFE', borderRadius: 5, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 10 }}>🤖</span>
              <span style={{ fontSize: 10, color: '#7C3AED' }}>AI assisted — {data.aiInvolvement.detail}</span>
            </div>
          )}

          <div style={{ borderTop: '1px solid #f5f5f5', paddingTop: 6, fontSize: 9, color: '#737373', display: 'flex', alignItems: 'center', gap: 4 }}>
            {data.evidenceVerified ? (
              <><span style={{ color: '#059669' }}>✓</span> Evidence verified</>
            ) : 'No evidence for this selection'}
          </div>

          <a
            href={`${window.location.origin}/workspace/default/editor/${followDocId}`}
            target="_blank"
            rel="noopener"
            style={{ display: 'block', textAlign: 'center', marginTop: 8, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: '#7C3AED', textDecoration: 'none' }}
          >
            View in Follow →
          </a>
        </>
      ) : (
        <p style={{ fontSize: 10, color: '#a3a3a3' }}>No provenance for this selection</p>
      )}
    </div>
  )
}
