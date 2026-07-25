/**
 * StrandView — slide-out panel showing cross-mode strand activity.
 *
 * Sprint G8: Displays unified activity from native workspace + Google Workspace threads,
 * with source tags (G.DOCS, G.SHEETS, G.SLIDES, NATIVE, BROWSER).
 *
 * Accessible from: Floating Unit Memory mode → strand link, Document badge long-press.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { useSmartDocStore } from '@/stores/smart-doc-store'
import { sendToBackground } from '@/lib/message-passing'
import { COLORS } from '@/lib/constants'

// ─── Types ──────────────────────────────────────────────────────────────────

interface StrandActivity {
  id: string
  threadId: string
  time: string
  label: string
  type: string
  magnitude: string
  keyChange: boolean
  contextNotes?: string
  source: 'native' | 'google_workspace'
  sourceTag: string
  documentTitle: string
  threadType: string
}

interface StrandInfo {
  id: string
  name: string
  color: string
  summaryText?: string
}

interface ExternalDocInfo {
  id: string
  googleDocId: string
  docType: string
  title: string
  lastSyncAt: string
}

// ─── Source Tag Colors ──────────────────────────────────────────────────────

const SOURCE_TAG_STYLES: Record<string, { bg: string; text: string }> = {
  'G.DOCS': { bg: '#FEE2E2', text: '#DC2626' },
  'G.SHEETS': { bg: '#DCFCE7', text: '#16A34A' },
  'G.SLIDES': { bg: '#FEF3C7', text: '#D97706' },
  NATIVE: { bg: '#EEF2FF', text: '#6366F1' },
  BROWSER: { bg: '#FEF3C7', text: '#D97706' },
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface StrandViewProps {
  isOpen: boolean
  onClose: () => void
}

export function StrandView({ isOpen, onClose }: StrandViewProps) {
  const { strandId, strandName } = useSmartDocStore()

  const [strand, setStrand] = useState<StrandInfo | null>(null)
  const [activities, setActivities] = useState<StrandActivity[]>([])
  const [externalDocs, setExternalDocs] = useState<ExternalDocInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const fetchActivity = useCallback(
    async (cursor?: string) => {
      if (!strandId) return
      setLoading(true)

      try {
        const res = await sendToBackground<{
          data: StrandActivity[]
          strand: StrandInfo
          externalDocuments: ExternalDocInfo[]
          pagination: { hasMore: boolean; nextCursor: string | null }
        }>({
          type: 'FETCH_STRAND_ACTIVITY',
          payload: { strandId, limit: 50, before: cursor },
        })

        if (res.success && res.data) {
          const response = res.data as {
            data: StrandActivity[]
            strand: StrandInfo
            externalDocuments: ExternalDocInfo[]
            pagination: { hasMore: boolean; nextCursor: string | null }
          }
          setStrand(response.strand)
          setExternalDocs(response.externalDocuments ?? [])
          setActivities((prev) => (cursor ? [...prev, ...response.data] : response.data))
          setHasMore(response.pagination.hasMore)
          setNextCursor(response.pagination.nextCursor)
        }
      } catch {
        // Silent failure
      } finally {
        setLoading(false)
      }
    },
    [strandId]
  )

  useEffect(() => {
    if (isOpen && strandId) {
      setActivities([])
      fetchActivity()
    }
  }, [isOpen, strandId, fetchActivity])

  if (!isOpen) return null

  // Group activities by date
  const groupedByDate = activities.reduce<Record<string, StrandActivity[]>>((acc, activity) => {
    const dateKey = new Date(activity.time).toLocaleDateString()
    if (!acc[dateKey]) acc[dateKey] = []
    acc[dateKey]!.push(activity)
    return acc
  }, {})

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.1)',
          zIndex: 99,
        }}
      />

      {/* Panel */}
      <div
        className="follow-interactive"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 340,
          background: COLORS.surface,
          borderLeft: `1px solid ${COLORS.borderLight}`,
          boxShadow: '-4px 0 20px rgba(0,0,0,0.08)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideInRight 200ms cubic-bezier(0.16, 1, 0.3, 1)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 16px',
            borderBottom: `1px solid ${COLORS.borderLight}`,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: strand?.color ?? '#6366F1',
                }}
              />
              <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>
                {strand?.name ?? strandName ?? 'Strand'}
              </span>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.textSecondary} strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Strand stats row */}
          {strand && (
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <span style={{ fontSize: 11, color: COLORS.textTertiary }}>
                {activities.length} events
              </span>
              <span style={{ fontSize: 11, color: COLORS.textTertiary }}>
                {externalDocs.length} GWS doc{externalDocs.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Strand summary */}
          {strand?.summaryText && (
            <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 8, lineHeight: '16px' }}>
              {strand.summaryText}
            </div>
          )}
        </div>

        {/* External Documents */}
        {externalDocs.length > 0 && (
          <div
            style={{
              padding: '8px 16px',
              borderBottom: `1px solid ${COLORS.borderLight}`,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: '#A1A1AA',
                marginBottom: 6,
              }}
            >
              LINKED DOCUMENTS
            </div>
            {externalDocs.map((doc) => {
              const tagKey =
                doc.docType === 'google_docs'
                  ? 'G.DOCS'
                  : doc.docType === 'google_sheets'
                    ? 'G.SHEETS'
                    : 'G.SLIDES'
              const tagStyle = SOURCE_TAG_STYLES[tagKey]!
              return (
                <div
                  key={doc.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 0',
                  }}
                >
                  <SourceTag tag={tagKey} />
                  <span style={{ fontSize: 12, color: COLORS.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.title}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Activity Feed */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
          {loading && activities.length === 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  border: `2px solid ${COLORS.borderLight}`,
                  borderTopColor: '#6366F1',
                  borderRadius: '50%',
                  animation: 'spin 0.7s linear infinite',
                }}
              />
            </div>
          ) : activities.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: COLORS.textTertiary, fontSize: 12 }}>
              No activity recorded yet.
            </div>
          ) : (
            Object.entries(groupedByDate).map(([date, dayActivities]) => (
              <div key={date} style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: COLORS.textTertiary,
                    marginBottom: 6,
                    position: 'sticky',
                    top: 0,
                    background: COLORS.surface,
                    padding: '2px 0',
                    zIndex: 1,
                  }}
                >
                  {date}
                </div>

                {dayActivities.map((activity) => (
                  <div
                    key={activity.id}
                    style={{
                      padding: '6px 0',
                      borderBottom: `1px solid ${COLORS.borderLight}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <SourceTag tag={activity.sourceTag} />
                      <span style={{ fontSize: 10, color: COLORS.textTertiary }}>
                        {new Date(activity.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {activity.keyChange && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 600,
                            padding: '1px 4px',
                            borderRadius: 3,
                            color: '#B45309',
                            background: '#FEF3C7',
                          }}
                        >
                          KEY
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: COLORS.text, lineHeight: '16px' }}>
                      {activity.label}
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.textTertiary, marginTop: 1 }}>
                      {activity.documentTitle}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}

          {/* Load more */}
          {hasMore && (
            <button
              onClick={() => nextCursor && fetchActivity(nextCursor)}
              disabled={loading}
              style={{
                width: '100%',
                padding: '8px 0',
                fontSize: 12,
                color: '#6366F1',
                background: 'transparent',
                border: `1px solid ${COLORS.borderLight}`,
                borderRadius: 6,
                cursor: loading ? 'default' : 'pointer',
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? 'Loading...' : 'Load more'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Shared Components ──────────────────────────────────────────────────────

function SourceTag({ tag }: { tag: string }) {
  const style = SOURCE_TAG_STYLES[tag] ?? { bg: '#F4F4F5', text: '#71717A' }
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        padding: '1px 5px',
        borderRadius: 3,
        background: style.bg,
        color: style.text,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}
    >
      {tag}
    </span>
  )
}
