/**
 * ProvenancePanel v2 — right-side slide-out panel showing real provenance
 * for a Google Workspace Document.
 *
 * Sprint FE-3: Rewired to use episodes, contributors, shared state, AI state
 * via provenance-service.ts. Same structure as web app FE-1 but compressed for 320px.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { useFloatingUnitStore } from '@/stores/floating-unit-store'
import { useSmartDocStore } from '@/stores/smart-doc-store'
import { COLORS } from '@/lib/constants'
import {
  fetchProvenanceData,
  type ExtensionProvenanceData,
  type ExtensionEpisode,
} from '@/services/provenance-service'

// ─── Helpers ───

const USER_COLORS = ['#7C3AED', '#2563EB', '#059669', '#D97706']

function hashToColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return USER_COLORS[Math.abs(h) % USER_COLORS.length]!
}

function getInitials(name: string): string {
  const p = name.trim().split(/\s+/)
  if (p.length >= 2) return (p[0]![0]! + p[1]![0]!).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatTimeRange(s: string, e: string): string {
  return `${formatTime(s)} – ${formatTime(e)}`
}

const SURFACE_TAGS: Record<string, { icon: string; label: string; bg: string; color: string }> = {
  browser: { icon: '🧭', label: 'Browse', bg: '#EFF6FF', color: '#2563EB' },
  ai: { icon: '✨', label: 'AI', bg: '#F3EFFE', color: '#7C3AED' },
  doc: { icon: '✏️', label: 'Edit', bg: '#ECFDF5', color: '#059669' },
  user: { icon: '👤', label: 'User', bg: '#f5f5f5', color: '#525252' },
  import: { icon: '📥', label: 'Import', bg: '#f5f5f5', color: '#525252' },
}

const PHASE_ORDER = ['inception', 'exploration', 'convergence', 'stabilization', 'delivery']
const PHASE_LABELS = ['Inc', 'Exp', 'Conv', 'Stab', 'Del']

// ─── Main Component ───

export function ProvenancePanel() {
  const { activeMode, setActiveMode } = useFloatingUnitStore()
  const { followDocId, strandId } = useSmartDocStore()
  const isOpen = activeMode === 'memory'

  const [activeTab, setActiveTab] = useState<'history' | 'meaning'>('history')
  const [data, setData] = useState<ExtensionProvenanceData | null>(null)
  const [loading, setLoading] = useState(false)
  const [sectionFilter, setSectionFilter] = useState<string | null>(null)
  const [userFilter, setUserFilter] = useState<string | null>(null)
  const [expandedEpisodeId, setExpandedEpisodeId] = useState<string | null>(null)

  const workspaceId = useSmartDocStore.getState().strandId ? 'default' : ''

  const loadData = useCallback(async () => {
    if (!followDocId) return
    setLoading(true)
    try {
      // Read workspaceId from chrome storage
      const storage = await chrome.storage?.local?.get?.('follow_workspace_id').catch(() => ({}))
      const wsId = (storage as any)?.follow_workspace_id || 'default'
      const result = await fetchProvenanceData(wsId, followDocId, sectionFilter)
      setData(result)
    } catch {
      // Silent fail
    } finally {
      setLoading(false)
    }
  }, [followDocId, sectionFilter])

  useEffect(() => {
    if (isOpen) loadData()
    const interval = isOpen ? setInterval(loadData, 60_000) : null
    return () => { if (interval) clearInterval(interval) }
  }, [isOpen, loadData])

  if (!isOpen) return null

  const episodes = data?.episodes || []
  const sharedState = data?.sharedState
  const contributions = sharedState?.contributions || []
  const sectionNames = [...new Set(episodes.map((ep) => ep.primarySection).filter(Boolean))] as string[]

  return (
    <div
      className="follow-interactive"
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        width: 320,
        height: '100vh',
        background: '#fff',
        boxShadow: '-4px 0 20px rgba(0,0,0,0.08)',
        borderLeft: '1px solid #e5e5e5',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 2147483640,
        animation: 'slideInRight 200ms ease-out',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #e5e5e5' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12 }}>📊</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#262626' }}>Provenance</span>
        </div>
        <button
          onClick={() => setActiveMode('chat')}
          style={{ fontSize: 12, color: '#a3a3a3', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          ✕
        </button>
      </div>

      {/* Contributor Section */}
      <div style={{ background: '#fafafa', padding: '8px 12px', borderBottom: '1px solid #f5f5f5' }}>
        <div style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', color: '#d4d4d4', letterSpacing: '0.08em', marginBottom: 6 }}>
          CONTRIBUTORS
        </div>
        {contributions.length === 0 ? (
          <p style={{ fontSize: 10, color: '#a3a3a3', fontStyle: 'italic' }}>No contributors yet</p>
        ) : (
          contributions.slice(0, 4).map((c: any) => (
            <div
              key={c.userId}
              onClick={() => setUserFilter(userFilter === c.userId ? null : c.userId)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', cursor: 'pointer',
                borderLeft: userFilter === c.userId ? `2px solid ${hashToColor(c.userId)}` : '2px solid transparent',
                paddingLeft: userFilter === c.userId ? 4 : 0,
              }}
            >
              <div style={{ width: 18, height: 18, borderRadius: 9, background: hashToColor(c.userId), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 7, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: 'white' }}>{getInitials(c.userName)}</span>
              </div>
              <span style={{ fontSize: 10, fontWeight: 500, color: '#262626' }}>{c.userName}</span>
              <span style={{ fontSize: 8, color: '#a3a3a3' }}>
                {c.sections?.length > 0 ? `· ${c.sections.map((s: any) => s.sectionRef).slice(0, 2).join(', ')}` : ''}
              </span>
            </div>
          ))
        )}
        {contributions.length > 4 && (
          <span style={{ fontSize: 9, color: '#7C3AED' }}>+{contributions.length - 4} more</span>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e5e5' }}>
        {(['history', 'meaning'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, padding: '8px 0', fontSize: 11, fontWeight: 500,
              color: activeTab === tab ? '#262626' : '#a3a3a3',
              borderBottom: activeTab === tab ? '2px solid #262626' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer', textTransform: 'capitalize',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'history' ? (
          <div>
            {/* Section filter pills */}
            {sectionNames.length > 0 && (
              <div style={{ display: 'flex', gap: 4, padding: '6px 12px', borderBottom: '1px solid #f5f5f5', overflowX: 'auto' }}>
                <FilterPill label="All" active={!sectionFilter} onClick={() => setSectionFilter(null)} />
                {sectionNames.map((name) => (
                  <FilterPill key={name} label={name} active={sectionFilter === name} onClick={() => setSectionFilter(name)} />
                ))}
              </div>
            )}

            <div style={{ padding: '8px 12px' }}>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[1, 2, 3].map((i) => (
                    <div key={i} style={{ height: 50, background: '#f5f5f5', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
                  ))}
                </div>
              ) : episodes.length === 0 ? (
                <p style={{ fontSize: 11, color: '#a3a3a3', textAlign: 'center', padding: '20px 0' }}>
                  No episodes yet — activity will appear as you work
                </p>
              ) : (
                episodes.slice(0, 10).map((ep) => (
                  <ExtEpisodeCard
                    key={ep.id}
                    episode={ep}
                    isExpanded={expandedEpisodeId === ep.id}
                    onToggle={() => setExpandedEpisodeId(expandedEpisodeId === ep.id ? null : ep.id)}
                  />
                ))
              )}
            </div>
          </div>
        ) : (
          <div style={{ padding: '8px 12px' }}>
            <ExtMeaningTab sharedState={sharedState} />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Episode Card (compressed for 320px) ───

function ExtEpisodeCard({ episode, isExpanded, onToggle }: { episode: ExtensionEpisode; isExpanded: boolean; onToggle: () => void }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 6, marginBottom: 6, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ padding: '8px 10px', cursor: 'pointer' }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: '#171717', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {episode.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
          {episode.userNames.slice(0, 2).map((name, i) => (
            <div key={name} style={{ width: 14, height: 14, borderRadius: 7, background: hashToColor(name), display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: i > 0 ? -3 : 0, border: '1px solid white', zIndex: 2 - i }}>
              <span style={{ fontSize: 5, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: 'white' }}>{getInitials(name)}</span>
            </div>
          ))}
          <span style={{ fontSize: 9, color: '#737373' }}>
            {episode.userNames.join(', ')}{episode.startTime ? ` · ${formatTimeRange(episode.startTime, episode.endTime)}` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {episode.surfaces.map((s) => {
            const tag = SURFACE_TAGS[s] || SURFACE_TAGS.user!
            return (
              <span key={s} style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', padding: '1px 5px', borderRadius: 3, background: tag.bg, color: tag.color }}>
                {tag.icon} {tag.label}
              </span>
            )
          })}
          {episode.hasKeyChange && (
            <span style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', padding: '1px 5px', borderRadius: 3, background: '#FFFBEB', color: '#D97706' }}>⚡ Key</span>
          )}
          <span style={{ fontSize: 8, color: '#d4d4d4', marginLeft: 'auto' }}>{episode.eventCount} events {isExpanded ? '▾' : '▸'}</span>
        </div>
      </div>

      {isExpanded && (
        <div style={{ borderTop: '1px solid #f5f5f5', padding: '4px 10px' }}>
          {episode.events.map((ev, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, padding: '4px 0', borderBottom: i < episode.events.length - 1 ? '1px solid #fafafa' : 'none' }}>
              <span style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', color: '#d4d4d4', width: 28, flexShrink: 0 }}>
                {formatTime(ev.timestamp)}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: '#404040', lineHeight: 1.3 }}>{ev.label}</div>
                <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
                  {(() => { const t = SURFACE_TAGS[ev.threadType] || SURFACE_TAGS.user!; return (
                    <span style={{ fontSize: 7, fontFamily: 'JetBrains Mono, monospace', padding: '0 4px', borderRadius: 2, background: t.bg, color: t.color }}>{t.icon} {t.label}</span>
                  )})()}
                  {ev.isKeyChange && <span style={{ fontSize: 7, padding: '0 4px', borderRadius: 2, background: '#FFFBEB', color: '#D97706' }}>⚡</span>}
                  {ev.hasEvidence && <span style={{ fontSize: 8, color: '#a3a3a3', opacity: 0.5 }}>📄</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Meaning Tab (compressed for 320px) ───

function ExtMeaningTab({ sharedState }: { sharedState: any | null }) {
  const [aiExpanded, setAiExpanded] = useState(false)

  if (!sharedState) return <p style={{ fontSize: 10, color: '#a3a3a3', textAlign: 'center', padding: 16 }}>No shared state available</p>

  const { dynamics, knowledge = [], tensions = [], aiUsage } = sharedState
  const phase = dynamics?.documentPhase
  const phaseIdx = phase ? PHASE_ORDER.indexOf(phase) : -1
  const activeKnowledge = knowledge.filter((k: any) => k.status !== 'superseded')
  const activeTensions = tensions.filter((t: any) => !t.resolvedAt)

  return (
    <div>
      {/* Phase */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', color: '#d4d4d4', letterSpacing: '0.08em', marginBottom: 6 }}>PHASE</div>
        {phase && <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', padding: '2px 6px', borderRadius: 3, background: '#7C3AED', color: 'white', display: 'inline-block', marginBottom: 6 }}>{phase.toUpperCase()}</span>}
        <div style={{ display: 'flex', gap: 1.5, marginBottom: 3 }}>
          {PHASE_ORDER.map((p, i) => (
            <div key={p} style={{ flex: 1, height: 2.5, borderRadius: 1, background: i <= phaseIdx ? (i === phaseIdx ? '#7C3AED' : 'rgba(124,58,237,0.4)') : '#e5e5e5' }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 1.5 }}>
          {PHASE_LABELS.map((l, i) => (
            <span key={l} style={{ flex: 1, fontSize: 6, fontFamily: 'JetBrains Mono, monospace', color: i === phaseIdx ? '#7C3AED' : '#d4d4d4', textAlign: 'center' }}>{l}</span>
          ))}
        </div>
        {dynamics?.editVelocity && <p style={{ fontSize: 9, color: '#737373', marginTop: 4 }}>Velocity: {dynamics.editVelocity}</p>}
      </div>

      {/* Knowledge */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', color: '#d4d4d4', letterSpacing: '0.08em', marginBottom: 6 }}>TEAM KNOWLEDGE</div>
        {activeKnowledge.length === 0 ? (
          <p style={{ fontSize: 10, color: '#a3a3a3', fontStyle: 'italic' }}>No extracted knowledge</p>
        ) : (
          activeKnowledge.slice(0, 5).map((k: any) => (
            <div key={k.id} style={{ padding: '6px 8px', background: k.status === 'disputed' ? '#FFFBEB' : '#fafafa', border: k.status === 'disputed' ? '1px solid #FDE68A' : '1px solid transparent', borderRadius: 5, marginBottom: 4 }}>
              {k.status === 'disputed' && <div style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: '#D97706', marginBottom: 2 }}>⚠ DISPUTED</div>}
              <p style={{ fontSize: 10, color: '#262626', lineHeight: 1.3 }}>&ldquo;{k.fact}&rdquo;</p>
              <p style={{ fontSize: 8, color: '#a3a3a3', marginTop: 2 }}>via {k.contributedByName} · <span style={{ color: k.confidence > 0.7 ? '#059669' : k.confidence >= 0.5 ? '#D97706' : '#DC2626' }}>{Math.round(k.confidence * 100)}%</span></p>
            </div>
          ))
        )}
      </div>

      {/* Tensions */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', color: '#d4d4d4', letterSpacing: '0.08em', marginBottom: 6 }}>ACTIVE TENSIONS</div>
        {activeTensions.length === 0 ? (
          <p style={{ fontSize: 10, color: '#059669' }}>No active tensions ✓</p>
        ) : (
          activeTensions.slice(0, 5).map((t: any) => (
            <div key={t.id} style={{ padding: '6px 8px', borderRadius: 5, marginBottom: 4, background: t.severity === 'high' ? '#FEF2F2' : t.severity === 'medium' ? '#FFFBEB' : '#fafafa' }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 2 }}>
                <span style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: t.severity === 'high' ? '#DC2626' : t.severity === 'medium' ? '#D97706' : '#737373' }}>{t.severity.toUpperCase()}</span>
                <span style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', color: '#a3a3a3' }}>{t.type}</span>
              </div>
              <p style={{ fontSize: 10, color: '#404040', lineHeight: 1.3 }}>{t.description}</p>
            </div>
          ))
        )}
      </div>

      {/* AI Usage */}
      {aiUsage && (
        <div>
          <button onClick={() => setAiExpanded(!aiExpanded)} style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', color: '#d4d4d4', letterSpacing: '0.08em', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 4 }}>
            AI USAGE {aiExpanded ? '▾' : '▸'}
          </button>
          <p style={{ fontSize: 9, color: '#737373' }}>{aiUsage.totalInteractions} interactions, {Math.round(aiUsage.acceptanceRate)}% acceptance</p>
          {aiExpanded && aiUsage.byUser?.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {aiUsage.byUser.map((u: any) => (
                <div key={u.userId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#525252', padding: '2px 0' }}>
                  <span>{u.userName}</span>
                  <span style={{ color: '#a3a3a3' }}>{u.interactions} · {Math.round(u.acceptRate)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Filter Pill ───

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '2px 8px', borderRadius: 10, fontSize: 9,
        fontFamily: 'JetBrains Mono, monospace',
        background: active ? '#171717' : '#f5f5f5',
        color: active ? 'white' : '#737373',
        border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      {label}
    </button>
  )
}
