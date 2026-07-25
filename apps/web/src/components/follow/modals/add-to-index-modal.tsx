'use client'

/**
 * AddToIndexModal (STABILIZE-3)
 *
 * Rebuilt as a floating modal matching the user's reference flow:
 *   Step "choose" — big Upload dropzone + list of other sources
 *     (Google Drive, Paste text/URL, Capture from web, Save conversation,
 *      Create folder)
 *   Step "paste" — paste text/URL, submit
 *   Step "chat-import" — paste chat text, pick source pill (Claude/ChatGPT/…)
 *   Step "gdrive" — Drive picker (mock list for now; full picker is Google OAuth
 *     follow-up — the integration point exists at /api/gws)
 *   Step "uploading" — progress spinner
 *   Step "done" — success + "Add more" / "Done"
 */

import { useEffect, useRef, useState } from 'react'
import { authFetch } from '@/lib/api-client'

type Step = 'choose' | 'paste' | 'chat-import' | 'gdrive' | 'uploading' | 'done'

interface GwsDoc {
  id: string
  externalDocId: string
  docType: 'google_docs' | 'google_sheets' | 'google_slides'
  title: string | null
  isActive: boolean
  updatedAt: string
}

/**
 * Parse a Google Drive / Docs / Sheets / Slides URL into a docId + docType.
 * Returns null if the URL doesn't match a recognised pattern. We only support
 * native G-Suite URLs here — generic /file/d/<id> Drive URLs need a metadata
 * lookup to determine the docType, which the backend will own when the full
 * Picker integration ships.
 */
function parseGwsUrl(
  url: string
): { externalDocId: string; docType: GwsDoc['docType']; titleHint?: string } | null {
  const trimmed = url.trim()
  const patterns: Array<{ re: RegExp; docType: GwsDoc['docType'] }> = [
    { re: /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/, docType: 'google_docs' },
    { re: /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/, docType: 'google_sheets' },
    { re: /docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/, docType: 'google_slides' },
  ]
  for (const { re, docType } of patterns) {
    const m = trimmed.match(re)
    if (m && m[1]) return { externalDocId: m[1], docType }
  }
  return null
}

const T = {
  accent: '#6C63FF',
  bg: 'rgba(0,0,0,0.35)',
  card: '#ffffff',
  n50: '#f5f4f2',
  n100: '#f0eeeb',
  n150: '#e5e2de',
  n200: '#d4d0ca',
  n300: '#b8b3ab',
  n400: '#9c968d',
  n500: '#807a70',
  n600: '#666054',
  n700: '#4d473c',
  n800: '#332e25',
  n950: '#111',
  green: '#2d8a4e',
  cyan: '#0e7490',
}

export interface AddToIndexModalProps {
  indexLabel?: string // e.g. "Personal" or project name
  /**
   * The active project's space UUID, or `'personal'` for the personal index.
   * Forwarded as `x-space-id` on every upload/paste/import call so the new
   * raw_files / chat_conversations rows land tagged with the right project.
   * `'personal'` is treated server-side as "no space" (NULL filter).
   */
  spaceId?: string
  onClose: () => void
  /**
   * Called after at least one successful add, so the parent can refetch
   * items/facts/files queries.
   */
  onAdded?: () => void
}

export function AddToIndexModal({ indexLabel, spaceId, onClose, onAdded }: AddToIndexModalProps) {
  const [step, setStep] = useState<Step>('choose')
  const [pasteContent, setPasteContent] = useState('')
  const [pasteTitle, setPasteTitle] = useState('')
  const [chatSource, setChatSource] = useState<'claude' | 'chatgpt' | 'cursor' | 'other'>('claude')
  const [chatContent, setChatContent] = useState('')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  // GWS step state — list of workspace's tracked Drive docs + per-row selection,
  // plus a paste-link input as a fallback when the doc isn't tracked yet.
  const [gwsDocs, setGwsDocs] = useState<GwsDoc[]>([])
  const [gwsLoading, setGwsLoading] = useState(false)
  const [gwsSelected, setGwsSelected] = useState<Set<string>>(new Set())
  const [gwsLink, setGwsLink] = useState('')
  const [gwsLinkErr, setGwsLinkErr] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // MCP-FIX-4: separate input for directory picker — `webkitdirectory` hides
  // the files picker entirely, so we need two inputs and two buttons.
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // ─── Uploads ────────────────────────────────────────────────────────
  // MCP-FIX-4: the backend now accepts a parallel `filePaths[]` array so
  // folder uploads (via `<input webkitdirectory>` or DataTransferItem.entries
  // drag-drop) land with their on-disk relative path preserved. Pass either:
  //  - File[] (the classic flow — no paths)
  //  - Array<{ file, path }> (folder flow — paths line up 1:1 with files)
  type UploadEntry = File | { file: File; path: string }
  const uploadFiles = async (entries: UploadEntry[]) => {
    if (entries.length === 0) return
    setErrMsg(null)
    setStep('uploading')
    const fd = new FormData()
    for (const e of entries) {
      if (e instanceof File) {
        // Browsers populate webkitRelativePath automatically when the user
        // picks a folder; empty string means they picked individual files.
        fd.append('files', e)
        fd.append(
          'filePaths',
          (e as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
        )
      } else {
        fd.append('files', e.file)
        fd.append('filePaths', e.path)
      }
    }
    try {
      const res = await authFetch('/api/index/items/upload', {
        method: 'POST',
        body: fd,
        headers: spaceId ? { 'x-space-id': spaceId } : undefined,
      })
      if (!res.ok) {
        setErrMsg(`Upload failed: ${res.status}`)
        setStep('choose')
        return
      }
      onAdded?.()
      setStep('done')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Upload failed')
      setStep('choose')
    }
  }

  // Walk a DataTransferItemList (drag-drop) and collect every file with its
  // relative path under the dropped folder. Resolves to `{file, path}[]`.
  // Files dropped at top level get `path = file.name` (treated as rootless).
  const collectDroppedEntries = async (
    items: DataTransferItem[]
  ): Promise<Array<{ file: File; path: string }>> => {
    const out: Array<{ file: File; path: string }> = []
    const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry
        await new Promise<void>((resolve) => {
          fileEntry.file(
            (f) => {
              out.push({ file: f, path: prefix ? `${prefix}/${entry.name}` : entry.name })
              resolve()
            },
            () => resolve()
          )
        })
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry
        const reader = dirEntry.createReader()
        await new Promise<void>((resolve) => {
          const readBatch = () => {
            reader.readEntries(async (batch) => {
              if (batch.length === 0) return resolve()
              for (const child of batch) {
                await walk(child, prefix ? `${prefix}/${entry.name}` : entry.name)
              }
              readBatch() // readEntries is paginated — keep going until empty
            })
          }
          readBatch()
        })
      }
    }
    const walks: Promise<void>[] = []
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.()
      if (entry) walks.push(walk(entry, ''))
    }
    await Promise.all(walks)
    return out
  }

  const submitPaste = async () => {
    if (!pasteContent.trim()) return
    setErrMsg(null)
    setStep('uploading')
    try {
      const type: 'text' | 'url' = /^https?:\/\//i.test(pasteContent.trim()) ? 'url' : 'text'
      const res = await authFetch('/api/index/items/paste', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(spaceId ? { 'x-space-id': spaceId } : {}),
        },
        body: JSON.stringify({ content: pasteContent, title: pasteTitle || undefined, type }),
      })
      if (!res.ok) {
        setErrMsg(`Paste failed: ${res.status}`)
        setStep('paste')
        return
      }
      onAdded?.()
      setStep('done')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Paste failed')
      setStep('paste')
    }
  }

  const submitConversation = async () => {
    if (!chatContent.trim()) return
    setErrMsg(null)
    setStep('uploading')
    // naive parser: each [role] block separated by blank line
    const blocks = chatContent.split(/\n\n+/)
    const messages = blocks
      .map((b) => {
        const m = b.match(/^\s*\[?(user|assistant|system)\]?:?\s*([\s\S]*)$/i)
        if (m) return { role: m[1]!.toLowerCase(), content: (m[2] ?? '').trim() }
        return { role: 'user', content: b.trim() }
      })
      .filter((m) => m.content)
    try {
      const res = await authFetch('/api/index/items/import-conversation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(spaceId ? { 'x-space-id': spaceId } : {}),
        },
        body: JSON.stringify({ messages, source: chatSource }),
      })
      if (!res.ok) {
        setErrMsg(`Import failed: ${res.status}`)
        setStep('chat-import')
        return
      }
      onAdded?.()
      setStep('done')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Import failed')
      setStep('chat-import')
    }
  }

  // ─── GWS (Google Workspace) ─────────────────────────────────────────
  // The doc list is the workspace's tracked + recent external_documents from
  // /api/gws/documents. These are docs the user has previously touched via the
  // browser extension or Google Workspace add-on — NOT a full Drive browser.
  // For arbitrary Drive URLs the user pastes a link below and we hand the
  // (docId, docType) to POST /api/gws/documents to activate it.
  useEffect(() => {
    if (step !== 'gdrive') return
    let cancelled = false
    setGwsLoading(true)
    setGwsLink('')
    setGwsLinkErr(null)
    setGwsSelected(new Set())
    void (async () => {
      try {
        const res = await authFetch('/api/gws/documents?filter=all')
        const json = (await res.json()) as { data?: GwsDoc[] }
        if (!cancelled) setGwsDocs(json.data ?? [])
      } catch {
        if (!cancelled) setGwsDocs([])
      } finally {
        if (!cancelled) setGwsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [step])

  const addGwsDocs = async (
    docs: Array<{ externalDocId: string; docType: GwsDoc['docType']; title: string }>
  ) => {
    setErrMsg(null)
    setStep('uploading')
    let added = 0
    try {
      // Some docs may not be activated yet (e.g. just-pasted link) — POST
      // /api/gws/documents activates them and creates the strand. Then we
      // attach to the project via POST /api/spaces/:id/documents when a
      // project context exists.
      for (const d of docs) {
        const activate = await authFetch('/api/gws/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            externalDocId: d.externalDocId,
            docType: d.docType,
            title: d.title,
            workspaceId: '',
          }),
        })
        if (!activate.ok) continue
        const activated = (await activate.json()) as {
          data?: { id: string }
        }
        const externalDocumentId = activated.data?.id
        if (!externalDocumentId) continue

        if (spaceId && spaceId !== 'personal') {
          await authFetch(`/api/spaces/${spaceId}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ externalDocumentId }),
          })
        }
        added++
      }
      if (added > 0) onAdded?.()
      setStep(added > 0 ? 'done' : 'gdrive')
      if (added === 0) setErrMsg('Nothing was added — check the URL or selection.')
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'GWS add failed')
      setStep('gdrive')
    }
  }

  const submitGwsSelection = () => {
    const picked = gwsDocs.filter((d) => gwsSelected.has(d.id))
    if (picked.length === 0) return
    void addGwsDocs(
      picked.map((d) => ({
        externalDocId: d.externalDocId,
        docType: d.docType,
        title: d.title ?? 'Untitled',
      }))
    )
  }

  const submitGwsLink = () => {
    setGwsLinkErr(null)
    const parsed = parseGwsUrl(gwsLink)
    if (!parsed) {
      setGwsLinkErr(
        'Paste a Google Docs / Sheets / Slides URL (e.g. https://docs.google.com/document/d/…)'
      )
      return
    }
    const titleHint = parsed.titleHint ?? 'Untitled'
    void addGwsDocs([{ ...parsed, title: titleHint }])
  }

  // ─── Drag & drop ────────────────────────────────────────────────────
  // When the user drops one or more folders, `dataTransfer.items` carries
  // directory entries we can walk to preserve relative paths. When they
  // drop loose files, we fall back to `dataTransfer.files` (no paths).
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const items = e.dataTransfer.items
    const hasEntries = items && items.length > 0 && typeof items[0]?.webkitGetAsEntry === 'function'
    if (hasEntries) {
      // Detach a copy of the list before any awaited work — DataTransfer is
      // zeroed out once the drop event handler returns.
      const copied: DataTransferItem[] = []
      for (let i = 0; i < items.length; i++) copied.push(items[i]!)
      const entries = await collectDroppedEntries(copied)
      if (entries.length) void uploadFiles(entries)
      return
    }
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length) void uploadFiles(files)
  }

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div
      onClick={onClose}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: T.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        fontFamily: 'Inter, sans-serif',
      }}
    >
      {/* Fullscreen drop overlay */}
      {dragOver && (
        <div
          style={{
            position: 'absolute',
            inset: 8,
            background: T.accent + '15',
            border: `3px dashed ${T.accent}`,
            borderRadius: 18,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>📂</div>
            <div style={{ fontSize: 16, color: T.accent, fontWeight: 500 }}>
              Drop anywhere to add to index
            </div>
          </div>
        </div>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: '100%',
          background: T.card,
          borderRadius: 12,
          boxShadow: '0 20px 50px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          zIndex: 2,
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.n150}` }}>
          <div style={{ fontSize: 16, fontWeight: 500, color: T.n950 }}>Add to Index</div>
          <div style={{ fontSize: 12, color: T.n500, marginTop: 2 }}>
            {indexLabel
              ? `Adding to the "${indexLabel}" index.`
              : 'Choose how you want to add content.'}
          </div>
        </div>

        <div style={{ padding: 20 }}>
          {errMsg && (
            <div
              style={{
                marginBottom: 12,
                padding: 8,
                borderRadius: 6,
                background: '#fee',
                color: '#c53030',
                fontSize: 12,
              }}
            >
              {errMsg}
            </div>
          )}

          {step === 'choose' && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  void uploadFiles(files)
                }}
              />
              {/* MCP-FIX-4: directory picker — `webkitdirectory` is the
                  Chrome/Edge/Safari convention; Firefox supports it too now.
                  Each selected file carries `webkitRelativePath`. */}
              <input
                ref={folderInputRef}
                type="file"
                multiple
                // @ts-expect-error — `webkitdirectory` is non-standard but
                // supported by all Chromium browsers, Safari 11.1+, and
                // Firefox 50+. React's HTMLInputElement typings omit it.
                webkitdirectory=""
                style={{ display: 'none' }}
                data-testid="folder-upload-input"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  void uploadFiles(files)
                }}
              />

              {/* Upload dropzone (clickable) */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: '100%',
                  padding: 28,
                  border: `2px dashed ${T.n200}`,
                  borderRadius: 10,
                  textAlign: 'center',
                  cursor: 'pointer',
                  marginBottom: 10,
                  background: T.n50,
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 6 }}>📂</div>
                <div style={{ fontSize: 14, color: T.n700, fontWeight: 500 }}>Upload files</div>
                <div style={{ fontSize: 11, color: T.n400, marginTop: 4 }}>
                  Drag and drop here or click to browse
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontFamily: 'monospace',
                    color: T.n300,
                    marginTop: 6,
                  }}
                >
                  docs, PDFs, images, code, spreadsheets, presentations
                </div>
              </button>

              {/* MCP-FIX-4: folder picker — preserves the on-disk directory
                  structure so the Files view can render a proper tree. */}
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                data-testid="upload-folder-btn"
                style={{
                  width: '100%',
                  padding: 14,
                  border: `1px solid ${T.n200}`,
                  borderRadius: 10,
                  textAlign: 'center',
                  cursor: 'pointer',
                  marginBottom: 16,
                  background: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 18 }}>🗂️</span>
                <span style={{ fontSize: 13, color: T.n700, fontWeight: 500 }}>
                  Upload a folder
                </span>
                <span style={{ fontSize: 11, color: T.n400 }}>preserves folder structure</span>
              </button>

              {/* Other sources */}
              <div
                style={{
                  fontSize: 10,
                  fontFamily: 'monospace',
                  color: T.n400,
                  letterSpacing: 1.5,
                  marginBottom: 8,
                }}
              >
                OTHER SOURCES
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SourceRow
                  icon="🌐"
                  label="Import from Google Drive"
                  desc="Select files from your connected Google Drive"
                  onClick={() => setStep('gdrive')}
                />
                <SourceRow
                  icon="📋"
                  label="Paste text or URL"
                  desc="Paste content directly into the index"
                  onClick={() => setStep('paste')}
                />
                <SourceRow
                  icon="💬"
                  label="Save a conversation"
                  desc="Import a chat from Claude, ChatGPT, Cursor, or other tools"
                  onClick={() => setStep('chat-import')}
                />
                <SourceRow
                  icon="📸"
                  label="Capture from web"
                  desc="Install the Follow extension to capture browsing"
                  disabled
                />
                <SourceRow
                  icon="📁"
                  label="Create a folder"
                  desc="Organise your index with folders (coming soon)"
                  disabled
                />
              </div>
            </div>
          )}

          {step === 'paste' && (
            <div>
              <input
                value={pasteTitle}
                onChange={(e) => setPasteTitle(e.target.value)}
                placeholder="Title (optional)"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: `1px solid ${T.n200}`,
                  borderRadius: 6,
                  fontSize: 12,
                  marginBottom: 8,
                  background: T.card,
                  color: T.n800,
                }}
              />
              <textarea
                autoFocus
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                placeholder="Paste text or a URL here…"
                style={{
                  width: '100%',
                  minHeight: 180,
                  padding: 14,
                  border: `1px solid ${T.n200}`,
                  borderRadius: 8,
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: T.n700,
                  resize: 'vertical',
                  background: T.card,
                }}
              />
              <Footer
                primaryLabel="Add to Index"
                onPrimary={submitPaste}
                primaryDisabled={!pasteContent.trim()}
                onBack={() => setStep('choose')}
              />
            </div>
          )}

          {step === 'chat-import' && (
            <div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {(['claude', 'chatgpt', 'cursor', 'other'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setChatSource(s)}
                    style={{
                      padding: '6px 14px',
                      border: `1px solid ${chatSource === s ? T.accent : T.n200}`,
                      borderRadius: 6,
                      background: chatSource === s ? T.accent + '10' : T.card,
                      color: chatSource === s ? T.accent : T.n600,
                      fontSize: 11,
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {s === 'chatgpt' ? 'ChatGPT' : s[0]!.toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              <textarea
                value={chatContent}
                onChange={(e) => setChatContent(e.target.value)}
                placeholder="Paste the conversation. Use blank lines between turns. Optionally prefix with [user] / [assistant]."
                style={{
                  width: '100%',
                  minHeight: 180,
                  padding: 14,
                  border: `1px solid ${T.n200}`,
                  borderRadius: 8,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: T.n700,
                  resize: 'vertical',
                  background: T.card,
                }}
              />
              <Footer
                primaryLabel="Import"
                onPrimary={submitConversation}
                primaryDisabled={!chatContent.trim()}
                onBack={() => setStep('choose')}
              />
            </div>
          )}

          {step === 'gdrive' && (
            <div data-testid="gws-step">
              <div style={{ marginBottom: 10, fontSize: 12, color: T.n500 }}>
                Pick from Google Workspace docs already known to this workspace, or paste a Drive
                link to add a new one.
              </div>

              {/* Tracked / recent doc list */}
              <div
                style={{
                  border: `1px solid ${T.n150}`,
                  borderRadius: 8,
                  background: T.card,
                  marginBottom: 12,
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
                data-testid="gws-doc-list"
              >
                {gwsLoading ? (
                  <div style={{ padding: 16, fontSize: 12, color: T.n500, textAlign: 'center' }}>
                    Loading Google Workspace docs…
                  </div>
                ) : gwsDocs.length === 0 ? (
                  <div style={{ padding: 16, fontSize: 12, color: T.n500, textAlign: 'center' }}>
                    No tracked Google Workspace docs yet. Paste a Drive link below to add one.
                  </div>
                ) : (
                  gwsDocs.map((d) => {
                    const checked = gwsSelected.has(d.id)
                    return (
                      <label
                        key={d.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 12px',
                          borderBottom: `1px solid ${T.n100}`,
                          cursor: 'pointer',
                          fontSize: 12,
                          background: checked ? 'rgba(108,99,255,0.06)' : 'transparent',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setGwsSelected((s) => {
                              const next = new Set(s)
                              if (e.target.checked) next.add(d.id)
                              else next.delete(d.id)
                              return next
                            })
                          }}
                        />
                        <span
                          style={{
                            display: 'inline-flex',
                            width: 20,
                            height: 24,
                            background:
                              d.docType === 'google_docs'
                                ? '#1A73E8'
                                : d.docType === 'google_sheets'
                                  ? '#0F9D58'
                                  : '#F4B400',
                            color: 'white',
                            fontSize: 9,
                            fontWeight: 700,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: 3,
                          }}
                        >
                          G
                        </span>
                        <span style={{ flex: 1, color: T.n800 }}>
                          {d.title ?? 'Untitled'}
                          {d.isActive ? null : (
                            <span style={{ marginLeft: 8, fontSize: 10, color: T.n400 }}>
                              recent
                            </span>
                          )}
                        </span>
                      </label>
                    )
                  })
                )}
              </div>

              {/* Paste-link fallback */}
              <div style={{ marginBottom: 6, fontSize: 11, color: T.n500, fontWeight: 500 }}>
                Or paste a link
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="url"
                  value={gwsLink}
                  onChange={(e) => {
                    setGwsLink(e.target.value)
                    setGwsLinkErr(null)
                  }}
                  placeholder="https://docs.google.com/document/d/…"
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    border: `1px solid ${T.n150}`,
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <button
                  onClick={submitGwsLink}
                  disabled={!gwsLink.trim()}
                  style={{
                    padding: '8px 14px',
                    background: T.accent,
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    cursor: 'pointer',
                    opacity: gwsLink.trim() ? 1 : 0.4,
                  }}
                >
                  Add
                </button>
              </div>
              {gwsLinkErr ? (
                <div style={{ marginTop: 6, fontSize: 11, color: '#B45309' }}>{gwsLinkErr}</div>
              ) : null}

              <Footer
                primaryLabel={gwsSelected.size > 0 ? `Add selected (${gwsSelected.size})` : 'Done'}
                onPrimary={gwsSelected.size > 0 ? submitGwsSelection : () => setStep('choose')}
                onBack={() => setStep('choose')}
              />
            </div>
          )}

          {step === 'uploading' && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4, color: T.n800 }}>
                Processing…
              </div>
              <div style={{ fontSize: 12, color: T.n400 }}>
                Extracting text, computing hashes, queueing for indexing
              </div>
              <div
                style={{
                  width: 200,
                  height: 4,
                  background: T.n100,
                  borderRadius: 2,
                  margin: '16px auto 0',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: '60%',
                    height: '100%',
                    background: T.accent,
                    borderRadius: 2,
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                />
              </div>
            </div>
          )}

          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: 30 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>✓</div>
              <div style={{ fontSize: 15, fontWeight: 500, color: T.green, marginBottom: 4 }}>
                Added to index
              </div>
              <div style={{ fontSize: 12, color: T.n500, marginBottom: 20 }}>
                Files processed. Facts will appear once the indexing pipeline completes.
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: '8px 16px',
                    background: T.accent,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPasteContent('')
                    setPasteTitle('')
                    setChatContent('')
                    setErrMsg(null)
                    setStep('choose')
                  }}
                  style={{
                    padding: '8px 16px',
                    background: T.n100,
                    border: 'none',
                    borderRadius: 6,
                    color: T.n600,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Add more
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SourceRow({
  icon,
  label,
  desc,
  onClick,
  disabled,
}: {
  icon: string
  label: string
  desc: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: T.card,
        border: `1px solid ${T.n150}`,
        borderRadius: 8,
        cursor: disabled ? 'default' : 'pointer',
        textAlign: 'left',
        opacity: disabled ? 0.5 : 1,
        width: '100%',
      }}
    >
      <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 13, color: T.n700, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11, color: T.n400, marginTop: 1 }}>{desc}</div>
      </div>
    </button>
  )
}

function Footer({
  primaryLabel,
  onPrimary,
  primaryDisabled,
  onBack,
}: {
  primaryLabel: string
  onPrimary: () => void
  primaryDisabled?: boolean
  onBack: () => void
}) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          padding: '8px 16px',
          background: T.n100,
          border: 'none',
          borderRadius: 6,
          color: T.n600,
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        Back
      </button>
      <button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled}
        style={{
          padding: '8px 16px',
          background: T.accent,
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontSize: 12,
          cursor: primaryDisabled ? 'default' : 'pointer',
          opacity: primaryDisabled ? 0.5 : 1,
        }}
      >
        {primaryLabel}
      </button>
    </div>
  )
}
