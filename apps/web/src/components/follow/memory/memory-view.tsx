'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useIndexStore } from '@/stores/index-store'
import { authFetch } from '@/lib/api-client'

// ─── Types ─────────────────────────────────────────────────────────────────

interface MemorySection {
  id: string
  key: string
  title: string
  content: string
  sortOrder: number
  versionId?: string | null
}

interface MemoryVersionSummary {
  id: string
  versionNumber: number
  createdBy: 'generate' | 'edit' | 'seed'
  generatedAt: string
  modelId: string | null
}

interface MemoryProfile {
  id: string
  slug: string
  name: string
  description: string
  isBuiltIn: boolean
  sortOrder: number
  sectionKeys: Array<{ key: string; title: string }>
  latestVersion: MemoryVersionSummary | null
}

interface VersionPage {
  version: MemoryVersionSummary & { indexId: string; profileId: string }
  sections: MemorySection[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.round(diffMs / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.round(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDay = Math.round(diffHr / 24)
    if (diffDay < 7) return `${diffDay}d ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

function createdByLabel(kind: MemoryVersionSummary['createdBy']): string {
  if (kind === 'edit') return 'Edit'
  if (kind === 'seed') return 'Seed'
  return 'Generated'
}

// ─── Component ─────────────────────────────────────────────────────────────

export function MemoryView() {
  const { activeIndexId } = useIndexStore()

  const [profiles, setProfiles] = useState<MemoryProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [versions, setVersions] = useState<MemoryVersionSummary[]>([])
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null)
  const [page, setPage] = useState<VersionPage | null>(null)
  const [flipDirection, setFlipDirection] = useState<1 | -1>(1)

  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [loadingPage, setLoadingPage] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId]
  )

  // ── Load profiles for the current index ─────────────────────────────────

  useEffect(() => {
    let cancelled = false
    setLoadingProfiles(true)
    authFetch(`/api/memory/profiles?indexId=${encodeURIComponent(activeIndexId)}`)
      .then((r) => r.json())
      .then((body: { data: MemoryProfile[] | null }) => {
        if (cancelled) return
        const list = body.data ?? []
        setProfiles(list)
        setActiveProfileId(list[0]?.id ?? null)
        setLoadingProfiles(false)
      })
      .catch(() => {
        if (!cancelled) setLoadingProfiles(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeIndexId])

  // ── Load versions when profile changes ──────────────────────────────────

  const refreshVersions = useCallback(
    async (profileId: string): Promise<MemoryVersionSummary[]> => {
      const r = await authFetch(`/api/memory/versions?profileId=${encodeURIComponent(profileId)}`)
      const body = (await r.json()) as { data: MemoryVersionSummary[] | null }
      return body.data ?? []
    },
    []
  )

  useEffect(() => {
    if (!activeProfileId) {
      setVersions([])
      setActiveVersionId(null)
      setPage(null)
      return
    }
    let cancelled = false
    refreshVersions(activeProfileId).then((list) => {
      if (cancelled) return
      setVersions(list)
      setActiveVersionId(list[0]?.id ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [activeProfileId, refreshVersions])

  // ── Load a specific version's sections ──────────────────────────────────

  useEffect(() => {
    if (!activeVersionId) {
      setPage(null)
      return
    }
    let cancelled = false
    setLoadingPage(true)
    authFetch(`/api/memory/versions/${encodeURIComponent(activeVersionId)}`)
      .then((r) => r.json())
      .then((body: { data: VersionPage | null }) => {
        if (cancelled) return
        setPage(body.data)
        setLoadingPage(false)
      })
      .catch(() => {
        if (!cancelled) setLoadingPage(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeVersionId])

  // ── Actions ─────────────────────────────────────────────────────────────

  const handleRegenerate = useCallback(async () => {
    if (!activeProfile) return
    setRegenerating(true)
    try {
      const res = await authFetch(
        `/api/memory/profiles/${encodeURIComponent(activeProfile.id)}/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ indexId: activeIndexId }),
        }
      )
      const body = (await res.json()) as { data: { versionId: string } | null }
      const newVersionId = body.data?.versionId
      const list = await refreshVersions(activeProfile.id)
      setVersions(list)
      setFlipDirection(1)
      setActiveVersionId(newVersionId ?? list[0]?.id ?? null)
    } finally {
      setRegenerating(false)
    }
  }, [activeProfile, activeIndexId, refreshVersions])

  const isLatestVersion = activeVersionId != null && activeVersionId === versions[0]?.id

  const startEdit = (section: MemorySection) => {
    if (!isLatestVersion) return
    setEditingKey(section.key)
    setEditContent(section.content)
  }

  const cancelEdit = () => {
    setEditingKey(null)
    setEditContent('')
  }

  const saveEdit = async (section: MemorySection) => {
    const snapshot = editContent
    setEditingKey(null)
    setEditContent('')

    const res = await authFetch(`/api/memory/sections/${encodeURIComponent(section.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: snapshot }),
    })
    const body = (await res.json()) as {
      data: { versionId?: string; versionNumber?: number; section?: MemorySection } | null
    }
    const newVersionId = body.data?.versionId ?? null

    if (activeProfile) {
      const list = await refreshVersions(activeProfile.id)
      setVersions(list)
      setFlipDirection(1)
      setActiveVersionId(newVersionId ?? list[0]?.id ?? activeVersionId)
    }
  }

  const goPrev = () => {
    if (!activeVersionId) return
    const idx = versions.findIndex((v) => v.id === activeVersionId)
    if (idx < versions.length - 1) {
      setFlipDirection(-1)
      setActiveVersionId(versions[idx + 1]!.id)
    }
  }

  const goNext = () => {
    if (!activeVersionId) return
    const idx = versions.findIndex((v) => v.id === activeVersionId)
    if (idx > 0) {
      setFlipDirection(1)
      setActiveVersionId(versions[idx - 1]!.id)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (loadingProfiles) {
    return (
      <div className="flex flex-1 items-center justify-center" data-testid="memory-view-loading">
        <div className="text-[12px]" style={{ color: 'var(--n400, #a3a3a3)' }}>
          Loading memory...
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col" data-testid="memory-view">
      {/* ── Profile tabs ──────────────────────────────────────────────── */}
      <div
        className="flex flex-shrink-0 items-center gap-1 border-b px-6 py-3"
        style={{ borderColor: 'var(--n150, #e5e5e5)', background: 'var(--n50, #fafafa)' }}
      >
        {profiles.map((p) => (
          <button
            key={p.id}
            onClick={() => setActiveProfileId(p.id)}
            className="rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              background: p.id === activeProfileId ? '#6C63FF' : 'transparent',
              color: p.id === activeProfileId ? '#fff' : 'var(--n600, #525252)',
            }}
            data-testid={`profile-tab-${p.slug}`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* ── Book card ────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[780px] px-10 py-8">
          {activeProfile && (
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div
                  className="text-[18px] font-semibold"
                  style={{ color: 'var(--n800, #262626)' }}
                >
                  {activeProfile.name}
                </div>
                {activeProfile.description && (
                  <div className="mt-1 text-[12px]" style={{ color: 'var(--n500, #737373)' }}>
                    {activeProfile.description}
                  </div>
                )}
              </div>

              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-opacity disabled:opacity-50"
                style={{
                  background: '#6C63FF',
                  color: '#fff',
                }}
                data-testid="memory-regenerate-btn"
              >
                {regenerating ? 'Generating…' : 'Regenerate'}
              </button>
            </div>
          )}

          {/* Version picker strip */}
          <div
            className="mb-4 flex items-center gap-2 rounded-lg border px-3 py-2"
            style={{
              borderColor: 'var(--n150, #e5e5e5)',
              background: '#fff',
            }}
          >
            <button
              onClick={goPrev}
              disabled={
                !activeVersionId ||
                versions.findIndex((v) => v.id === activeVersionId) >= versions.length - 1
              }
              className="rounded px-2 py-1 text-[14px] disabled:opacity-30"
              aria-label="Previous page"
              style={{ color: 'var(--n600, #525252)' }}
            >
              ‹
            </button>

            <select
              value={activeVersionId ?? ''}
              onChange={(e) => {
                const idx = versions.findIndex((v) => v.id === e.target.value)
                const curIdx = versions.findIndex((v) => v.id === activeVersionId)
                setFlipDirection(idx < curIdx ? 1 : -1)
                setActiveVersionId(e.target.value)
              }}
              className="flex-1 bg-transparent text-[12px] outline-none"
              style={{ color: 'var(--n700, #404040)' }}
              data-testid="memory-version-picker"
            >
              {versions.length === 0 && <option value="">No versions yet</option>}
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNumber} · {createdByLabel(v.createdBy)} ·{' '}
                  {formatTimestamp(v.generatedAt)}
                </option>
              ))}
            </select>

            <button
              onClick={goNext}
              disabled={
                !activeVersionId || versions.findIndex((v) => v.id === activeVersionId) <= 0
              }
              className="rounded px-2 py-1 text-[14px] disabled:opacity-30"
              aria-label="Next page"
              style={{ color: 'var(--n600, #525252)' }}
            >
              ›
            </button>
          </div>

          {/* Animated page */}
          <div className="relative" style={{ minHeight: 280, perspective: '1400px' }}>
            <AnimatePresence mode="wait" initial={false} custom={flipDirection}>
              <motion.div
                key={activeVersionId ?? 'empty'}
                custom={flipDirection}
                initial={{
                  opacity: 0,
                  rotateY: flipDirection === 1 ? 25 : -25,
                  x: flipDirection === 1 ? 20 : -20,
                }}
                animate={{ opacity: 1, rotateY: 0, x: 0 }}
                exit={{
                  opacity: 0,
                  rotateY: flipDirection === 1 ? -25 : 25,
                  x: flipDirection === 1 ? -20 : 20,
                }}
                transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
                style={{ transformStyle: 'preserve-3d' }}
                data-testid="memory-page"
              >
                {loadingPage && !page ? (
                  <div
                    className="rounded-xl border p-6 text-[12px]"
                    style={{
                      borderColor: 'var(--n150, #e5e5e5)',
                      background: '#fff',
                      color: 'var(--n400, #a3a3a3)',
                    }}
                  >
                    Loading page...
                  </div>
                ) : !page ? (
                  <div
                    className="rounded-xl border p-6 text-[12px]"
                    style={{
                      borderColor: 'var(--n150, #e5e5e5)',
                      background: '#fff',
                      color: 'var(--n400, #a3a3a3)',
                    }}
                  >
                    No version yet. Click Regenerate to create the first page.
                  </div>
                ) : (
                  <div
                    className="rounded-xl border p-6"
                    style={{
                      borderColor: 'var(--n150, #e5e5e5)',
                      background: '#fff',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    }}
                  >
                    {/* Page header */}
                    <div
                      className="mb-4 flex items-center justify-between border-b pb-3"
                      style={{ borderColor: 'var(--n150, #e5e5e5)' }}
                    >
                      <div
                        className="font-mono text-[10px] tracking-[1.5px]"
                        style={{ color: 'var(--n400, #a3a3a3)' }}
                      >
                        PAGE {page.version.versionNumber} ·{' '}
                        {createdByLabel(page.version.createdBy).toUpperCase()} ·{' '}
                        {formatTimestamp(page.version.generatedAt)}
                      </div>
                      {!isLatestVersion && (
                        <div
                          className="rounded-full px-2 py-0.5 text-[10px]"
                          style={{
                            background: 'var(--n100, #f5f5f5)',
                            color: 'var(--n500, #737373)',
                          }}
                        >
                          Read-only
                        </div>
                      )}
                    </div>

                    {page.sections.map((sec) => (
                      <div key={sec.id} className="mb-6 last:mb-0">
                        <div className="mb-2 flex items-center gap-2">
                          <h3
                            className="text-[14px] font-semibold"
                            style={{ color: 'var(--n800, #262626)' }}
                          >
                            {sec.title}
                          </h3>
                          {isLatestVersion && editingKey !== sec.key && (
                            <button
                              onClick={() => startEdit(sec)}
                              className="text-[12px] opacity-60 transition-opacity hover:opacity-100"
                              style={{ color: 'var(--n400, #a3a3a3)' }}
                              data-testid={`edit-btn-${sec.key}`}
                            >
                              ✎
                            </button>
                          )}
                        </div>

                        {editingKey === sec.key ? (
                          <div>
                            <textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="w-full rounded-lg border p-3 text-[13px] outline-none"
                              style={{
                                borderColor: '#6C63FF',
                                color: 'var(--n700, #404040)',
                                minHeight: 120,
                                lineHeight: 1.6,
                              }}
                              data-testid="edit-textarea"
                            />
                            <div
                              className="mt-2 text-[10px]"
                              style={{ color: 'var(--n500, #737373)' }}
                            >
                              Saving will create a new page.
                            </div>
                            <div className="mt-2 flex gap-2">
                              <button
                                onClick={() => saveEdit(sec)}
                                className="rounded px-3 py-1 text-[11px] font-medium text-white"
                                style={{ background: '#34d399' }}
                                data-testid="save-btn"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEdit}
                                className="rounded px-3 py-1 text-[11px]"
                                style={{ color: 'var(--n500, #737373)' }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className="whitespace-pre-line text-[13px]"
                            style={{
                              color: 'var(--n700, #404040)',
                              lineHeight: 1.65,
                            }}
                          >
                            {sec.content}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}
