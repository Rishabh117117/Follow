'use client'

/**
 * Desktop Agent onboarding + source management (STABILIZE-2 / Pattern B).
 *
 * Flow:
 *   1. "Connect Desktop Agent" → POST /api/agents/provision (API at :3001)
 *      returns { apiUrl, apiKey, workspaceId }. The raw apiKey is shown
 *      exactly once in the success banner.
 *   2. We also POST the same payload to the local launcher at
 *      :4000/api/agent/config. If the launcher is running, the agent
 *      config file on disk is updated automatically. If not, the user
 *      copies the values manually.
 *   3. Sources panel — add/remove folders the agent watches, with a
 *      per-source "keep cloud copy" toggle. Dropped files are always
 *      cloud copies (bytes came through the browser).
 *
 * PAGE-SHAPE-CLEANUP-1 (2026-04-23): body extracted from
 * `./page.tsx` into this private sibling. Next 14's App Router
 * page contract forbids named exports alongside the default; the
 * ConfigHub Agents tab (gated, `dev-config-hub: false`) imports
 * `AgentSettingsBody` from here now.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, authFetch } from '@/lib/api-client'

const LAUNCHER_URL = 'http://localhost:4000'

interface ProvisionResponse {
  apiUrl: string
  apiKey: string
  workspaceId: string
  keyPrefix: string
  rotated: boolean
}

interface StatusResponse {
  connected: boolean
  keyPrefix?: string
  createdAt?: string
  lastUsedAt?: string | null
}

interface WatchFolder {
  path: string
  preset: 'open' | 'balanced' | 'private'
  recursive: boolean
  includePatterns?: string[]
  excludePatterns?: string[]
  cloudCopy?: boolean
  indexId?: string // STABILIZE-3 — bind this folder to a project index
}

interface IndexOption {
  id: string
  name: string
  type: 'personal' | 'project'
}

async function launcherFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${LAUNCHER_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) throw new Error(`Launcher ${res.status}`)
  return res.json() as Promise<T>
}

export function AgentSettingsBody() {
  const qc = useQueryClient()
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // ─── Agent status (from API) ───────────────────────────────────────
  const status = useQuery({
    queryKey: ['agent', 'status'],
    queryFn: () => api.get<StatusResponse>('/api/agents/status'),
    refetchInterval: 10_000,
  })

  // ─── Launcher reachability ────────────────────────────────────────
  const launcher = useQuery({
    queryKey: ['launcher', 'ping'],
    queryFn: () => launcherFetch<{ present: boolean }>('/api/agent/config'),
    refetchInterval: 15_000,
    retry: false,
  })
  const launcherUp = launcher.status === 'success'

  // ─── Watched sources (from launcher) ──────────────────────────────
  const sources = useQuery({
    queryKey: ['agent', 'sources'],
    queryFn: () => launcherFetch<{ folders: WatchFolder[] }>('/api/agent/sources'),
    enabled: launcherUp,
    retry: false,
  })

  // ─── Mutations ────────────────────────────────────────────────────
  const provision = useMutation({
    mutationFn: async () => {
      const res = await api.post<ProvisionResponse>('/api/agents/provision', {})
      const payload = res.data!
      // Best-effort write to launcher
      try {
        await launcherFetch('/api/agent/config', {
          method: 'POST',
          body: JSON.stringify({
            apiUrl: payload.apiUrl,
            apiKey: payload.apiKey,
            workspaceId: payload.workspaceId,
          }),
        })
      } catch {
        /* launcher might not be running — user still has the key */
      }
      return payload
    },
    onSuccess: (data) => {
      setRevealedKey(data.apiKey)
      qc.invalidateQueries({ queryKey: ['agent', 'status'] })
      qc.invalidateQueries({ queryKey: ['launcher', 'ping'] })
    },
  })

  const saveSources = useMutation({
    mutationFn: (folders: WatchFolder[]) =>
      launcherFetch<{ ok: boolean }>('/api/agent/sources', {
        method: 'PUT',
        body: JSON.stringify({ folders }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent', 'sources'] }),
  })

  // ─── Source editing ───────────────────────────────────────────────
  const [newPath, setNewPath] = useState('')
  const [newIndexId, setNewIndexId] = useState<string>('') // '' = workspace-level (no binding)
  const [advancedOpen, setAdvancedOpen] = useState<number | null>(null)
  const folders = sources.data?.folders ?? []

  // Load available indexes so the per-folder picker can show them.
  const indexesQ = useQuery({
    queryKey: ['agent-settings', 'indexes'],
    queryFn: () => api.get<IndexOption[]>('/api/indexes'),
  })
  const indexOptions = (indexesQ.data?.data ?? []).filter((i) => i.type === 'project')

  const indexName = (id?: string): string | null => {
    if (!id) return null
    return indexOptions.find((i) => i.id === id)?.name ?? null
  }

  const addFolderByPath = () => {
    const path = newPath.trim()
    if (!path) return
    const next: WatchFolder[] = [
      ...folders,
      {
        path,
        preset: 'open',
        recursive: true,
        includePatterns: ['**/*.ts', '**/*.tsx', '**/*.md', '**/*.json', '**/*.txt'],
        excludePatterns: ['node_modules/**', '.git/**', 'dist/**', '.next/**'],
        cloudCopy: false,
        indexId: newIndexId || undefined,
      },
    ]
    saveSources.mutate(next)
    setNewPath('')
    setNewIndexId('')
  }

  const removeFolder = (idx: number) => {
    saveSources.mutate(folders.filter((_, i) => i !== idx))
  }

  const toggleCloud = (idx: number) => {
    saveSources.mutate(folders.map((f, i) => (i === idx ? { ...f, cloudCopy: !f.cloudCopy } : f)))
  }

  const changeFolderIndex = (idx: number, id: string) => {
    saveSources.mutate(folders.map((f, i) => (i === idx ? { ...f, indexId: id || undefined } : f)))
  }

  // ─── Drop zone (files only, cloud-copy mode) ──────────────────────
  // Bytes came through the browser, so they must be uploaded — there's no
  // local path to reference. Each dropped file is POSTed to /api/raw-files/upload
  // (cloud copy), then registered as a source with path = "cloud://<name>".
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState<string[]>([])

  const uploadDropped = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      setUploading(files.map((f) => f.name))

      const uploaded: WatchFolder[] = []
      for (const f of files) {
        try {
          const fd = new FormData()
          fd.append('file', f)
          fd.append('sourceType', 'upload')
          fd.append('sourceRef', `web-drop:${f.name}`)
          // do NOT set Content-Type — browser picks the multipart boundary
          const res = await authFetch(`/api/raw-files/upload`, {
            method: 'POST',
            body: fd,
          })
          if (!res.ok) {
            console.error(`Upload failed for ${f.name}: ${res.status}`)
            continue
          }
          uploaded.push({
            path: `cloud://${f.name}`,
            preset: 'open',
            recursive: false,
            cloudCopy: true,
          })
        } catch (err) {
          console.error(`Upload error for ${f.name}`, err)
        }
      }
      setUploading([])
      if (uploaded.length) saveSources.mutate([...folders, ...uploaded])
    },
    [folders, saveSources]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length) void uploadDropped(files)
    },
    [uploadDropped]
  )

  const copyKey = async () => {
    if (!revealedKey) return
    await navigator.clipboard.writeText(revealedKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Hide revealed key after 5 min for safety
  useEffect(() => {
    if (!revealedKey) return
    const t = setTimeout(() => setRevealedKey(null), 5 * 60_000)
    return () => clearTimeout(t)
  }, [revealedKey])

  const connected = status.data?.data?.connected
  const keyPrefix = status.data?.data?.keyPrefix
  const agentState = useMemo(() => {
    if (!connected) return { dot: 'bg-gray-300', label: 'Not connected' }
    if (!launcherUp) return { dot: 'bg-amber-400', label: 'Key issued — launcher offline' }
    return { dot: 'bg-emerald-500', label: 'Connected' }
  }, [connected, launcherUp])

  return (
    <div className="space-y-10">
      {/* ── Header ───────────────────────────────────────────────── */}
      <header>
        <h1
          className="text-[28px] leading-tight"
          style={{
            fontFamily: 'Newsreader, Georgia, serif',
            color: 'var(--n950)',
            fontWeight: 500,
          }}
        >
          Desktop Agent
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--n500)' }}>
          Connect the local agent to index files from your workspace.
        </p>
      </header>

      {/* ── Connection status ────────────────────────────────────── */}
      <section className="rounded-lg border border-[var(--n200)] bg-white p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${agentState.dot}`} />
            <div>
              <div className="text-[14px] font-medium text-[var(--n950)]">{agentState.label}</div>
              <div className="text-[12px] text-[var(--n500)]">
                {connected
                  ? `Key ${keyPrefix}… · ${launcherUp ? 'config file synced' : 'copy the key to your agent config manually'}`
                  : 'Click Connect to issue an API key and point the agent at this workspace.'}
              </div>
            </div>
          </div>
          <button
            onClick={() => provision.mutate()}
            disabled={provision.isPending}
            className="rounded-md bg-[var(--accent,#6c63ff)] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
          >
            {provision.isPending ? 'Working…' : connected ? 'Rotate key' : 'Connect Desktop Agent'}
          </button>
        </div>

        {revealedKey && (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
            <div className="text-[12px] font-medium text-amber-900">
              Copy this key now — it will not be shown again.
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-white px-2 py-1.5 font-mono text-[11px] text-[var(--n800)]">
                {revealedKey}
              </code>
              <button
                onClick={copyKey}
                className="rounded bg-[var(--n950)] px-3 py-1.5 text-[12px] text-white"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {launcherUp && (
              <div className="mt-2 text-[11px] text-amber-800">
                ✓ Written to <code>apps/desktop-agent/follow-agent.config.json</code>. Restart the
                agent to pick it up.
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Watched sources ──────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[15px] font-medium text-[var(--n950)]">Watched sources</h2>
          <span className="text-[12px] text-[var(--n500)]">
            {folders.length} source{folders.length === 1 ? '' : 's'}
          </span>
        </div>

        {!launcherUp ? (
          <div className="rounded-md border border-[var(--n200)] bg-[var(--n50)] p-4 text-[12px] text-[var(--n500)]">
            Start the launcher (<code>start-and-open.cmd</code>) to manage watched folders.
          </div>
        ) : (
          <>
            {/* Add by path — row with folder path + index picker + Add button */}
            <div className="mb-3 flex gap-2">
              <input
                type="text"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addFolderByPath()}
                placeholder="Paste a folder path (e.g. C:\Users\you\Documents\Projects)"
                className="flex-1 rounded-md border border-[var(--n200)] bg-white px-3 py-2 text-[13px] text-[var(--n950)] placeholder:text-[var(--n400)]"
              />
              <select
                value={newIndexId}
                onChange={(e) => setNewIndexId(e.target.value)}
                className="rounded-md border border-[var(--n200)] bg-white px-2 py-2 text-[13px] text-[var(--n800)]"
                title="Bind this folder's files to a project index"
              >
                <option value="">No index (workspace only)</option>
                {indexOptions.map((i) => (
                  <option key={i.id} value={i.id}>
                    → {i.name}
                  </option>
                ))}
              </select>
              <button
                onClick={addFolderByPath}
                className="rounded-md border border-[var(--n200)] bg-white px-4 py-2 text-[13px] text-[var(--n800)] hover:bg-[var(--n50)]"
              >
                Add folder
              </button>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`mb-4 rounded-md border-2 border-dashed p-6 text-center text-[12px] transition-colors ${
                dragOver
                  ? 'bg-[var(--accent,#6c63ff)]/5 border-[var(--accent,#6c63ff)] text-[var(--accent,#6c63ff)]'
                  : 'border-[var(--n200)] text-[var(--n500)]'
              }`}
            >
              {uploading.length > 0 ? (
                <div>
                  Uploading {uploading.length} file{uploading.length === 1 ? '' : 's'}…
                  <div className="mt-1 text-[11px] text-[var(--n400)]">
                    {uploading.slice(0, 3).join(', ')}
                    {uploading.length > 3 ? ` +${uploading.length - 3} more` : ''}
                  </div>
                </div>
              ) : (
                <>
                  Drop files here to add as cloud copies (indexed and stored in S3).
                  <div className="mt-1 text-[11px] text-[var(--n400)]">
                    For pure-local references, paste a path above — files never leave your machine.
                  </div>
                </>
              )}
            </div>

            {/* Source list */}
            {folders.length === 0 ? (
              <div className="rounded-md border border-[var(--n200)] bg-white p-6 text-center text-[13px] text-[var(--n500)]">
                No sources yet. Add a folder path or drop files above.
              </div>
            ) : (
              <div className="divide-y divide-[var(--n200)] rounded-md border border-[var(--n200)] bg-white">
                {folders.map((f, idx) => {
                  const isCloud = f.path.startsWith('cloud://')
                  return (
                    <div key={`${f.path}-${idx}`} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <code className="truncate font-mono text-[12px] text-[var(--n900)]">
                              {isCloud ? f.path.replace('cloud://', '☁ ') : f.path}
                            </code>
                            {f.cloudCopy && (
                              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-800">
                                cloud copy
                              </span>
                            )}
                            {f.indexId && indexName(f.indexId) && (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">
                                → {indexName(f.indexId)}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--n500)]">
                            <span>
                              preset: {f.preset} · {f.recursive ? 'recursive' : 'flat'}
                            </span>
                            <select
                              value={f.indexId ?? ''}
                              onChange={(e) => changeFolderIndex(idx, e.target.value)}
                              className="rounded border border-[var(--n200)] bg-white px-1.5 py-0.5 text-[10px] text-[var(--n700)]"
                              title="Change index binding"
                            >
                              <option value="">— no index —</option>
                              {indexOptions.map((i) => (
                                <option key={i.id} value={i.id}>
                                  {i.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 pt-1">
                          {!isCloud && (
                            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--n600)]">
                              <input
                                type="checkbox"
                                checked={!!f.cloudCopy}
                                onChange={() => toggleCloud(idx)}
                              />
                              Keep cloud copy
                            </label>
                          )}
                          <button
                            onClick={() => setAdvancedOpen(advancedOpen === idx ? null : idx)}
                            className="text-[11px] text-[var(--n500)] hover:text-[var(--n900)]"
                          >
                            {advancedOpen === idx ? 'Hide' : 'Advanced'}
                          </button>
                          <button
                            onClick={() => removeFolder(idx)}
                            className="text-[11px] text-red-600 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      {advancedOpen === idx && (
                        <div className="mt-3 grid grid-cols-2 gap-3 rounded bg-[var(--n50)] p-3 text-[11px]">
                          <div>
                            <div className="mb-1 font-medium text-[var(--n700)]">Include</div>
                            <div className="space-y-0.5 font-mono text-[var(--n600)]">
                              {(f.includePatterns ?? []).map((p) => <div key={p}>{p}</div>) || (
                                <div className="text-[var(--n400)]">(all files)</div>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 font-medium text-[var(--n700)]">Exclude</div>
                            <div className="space-y-0.5 font-mono text-[var(--n600)]">
                              {(f.excludePatterns ?? []).map((p) => <div key={p}>{p}</div>) || (
                                <div className="text-[var(--n400)]">(default excludes)</div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Manual setup fallback ────────────────────────────────── */}
      {!launcherUp && connected && (
        <section className="rounded-md border border-[var(--n200)] bg-[var(--n50)] p-4 text-[12px] text-[var(--n600)]">
          <div className="font-medium text-[var(--n800)]">Launcher not detected on :4000</div>
          <div className="mt-1">
            You can paste the rotated key into{' '}
            <code>apps/desktop-agent/follow-agent.config.json</code> manually and run the agent.
          </div>
        </section>
      )}
    </div>
  )
}

export default AgentSettingsBody
