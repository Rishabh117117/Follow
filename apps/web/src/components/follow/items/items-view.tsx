'use client'

/**
 * ItemsView — v3 unified list + detail view (Sprint WIRE-2)
 *
 * Shows a unified feed of conversations, files, and facts across the active
 * index, filterable by `sectionFilter` from the dashboard store.
 *
 * Layout:
 *   - Left column (300px when an item is selected, full-width otherwise):
 *     scrollable list of filtered items.
 *   - Right column: detail view that switches by item type.
 *
 * Data sources (WIRE-1 endpoints):
 *   - Conversations: GET /api/chat/conversations?workspaceId={id}
 *   - Files:         GET /api/files?workspaceId={id}
 *   - Facts:         POST /api/index/query (returns index_records)
 */

import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { authFetch } from '@/lib/api-client'
import { useFollowDashboardStore, type ItemType } from '@/stores/follow-dashboard-store'
import { useUnifiedItems } from './use-unified-items'
import { useItemManageStore } from '@/stores/item-manage-store'
import { ItemActionMenu } from './item-action-menu'
import { ConfirmDialog } from '@/components/follow/modals/confirm-dialog'
import { DragDropOverlay } from '@/components/follow/common/drag-drop-overlay'
import { RecentlyForgottenBin } from '@/components/follow/memory/recently-forgotten'

import { type UnifiedItem, useIndexStatus, headerSecondaryBtn } from './_shared'
import {
  buildFileTree,
  hasAnyFolderStructure,
  type FileTreeNode,
} from './file-tree/build-file-tree'

// Re-exports for back-compat with __tests__/file-tree.test.ts and other
// callers that imported these from items-view before the Phase 1 split.
export { buildFileTree, hasAnyFolderStructure } from './file-tree/build-file-tree'
export type {
  FileTreeFolder,
  FileTreeLeaf,
  FileTreeNode,
  FolderSkeleton,
} from './file-tree/build-file-tree'
import { FolderRow } from './file-tree/folder-row'
import { FolderView } from './file-tree/folder-view'
import { SourcePill } from './badges/source-pill'
import { ConfidenceDot } from './badges/confidence-dot'
import { IndexStatusBadge } from './badges/index-status-badge'
import { ConversationDetail } from './detail/conversation-detail'
import { ConversationGroupDetail } from './detail/conversation-group-detail'
import { FileDetail } from './detail/file-detail'
import { FactDetail } from './detail/fact-detail'
import { DetailViewToggle } from './detail/detail-view-toggle'
import { AutoIndexHeaderToggle } from './toggles/auto-index-header-toggle'
import { AddToIndexButton, AddToIndexModalMount } from './add-to-index-button'

// ─── Main component ────────────────────────────────────────────────────────

export function ItemsView() {
  const params = useParams<{ id?: string }>()
  const workspaceId = params?.id ?? ''
  const { sectionFilter, selectedItem, detailViewMode, setSelectedItem } = useFollowDashboardStore()
  const queryClient = useQueryClient()

  // Cross-source feed (conversations + files + raw uploads + facts). Hook
  // owns query invalidation on follow:items-changed events.
  const {
    items: allItems,
    isLoading: isLoadingItems,
    invalidate: invalidateItemsHook,
  } = useUnifiedItems(workspaceId)

  const filtered = useMemo(() => {
    if (sectionFilter === 'all') return allItems
    const target: ItemType =
      sectionFilter === 'conversation' ? 'conv' : sectionFilter === 'file' ? 'file' : 'fact'
    return allItems.filter((i) => i.it === target)
  }, [allItems, sectionFilter])

  const selected = selectedItem ? filtered.find((i) => i.id === selectedItem.id) : null

  const isLoading = isLoadingItems

  // ── Sprint CTX-1: management state ────────────────────────────────────────
  const {
    selectMode,
    selectedIds,
    showHidden,
    addPanelOpen,
    confirmDialog,
    toggleSelectMode,
    toggleSelected,
    selectAll,
    clearSelection,
    toggleShowHidden,
    openAddPanel,
    closeAddPanel,
    openConfirmDialog,
    closeConfirmDialog,
  } = useItemManageStore()
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  // Anchor for shift-click range selection. Null until the user makes a
  // first anchored selection (ctrl-click or checkbox click).
  const selectionAnchorRef = useRef<string | null>(null)

  // ─── MCP-FIX-4: tree-view state ────────────────────────────────────────
  // Persisted per-workspace so users who keep the Files view in tree mode
  // don't have to re-toggle every reload. We deliberately DON'T persist
  // expanded-folder state — re-opening the workspace with the whole tree
  // remembered from last session tends to feel stale once new files arrive.
  const [fileViewMode, setFileViewMode] = useState<'folder' | 'tree' | 'flat'>(() => {
    if (typeof window === 'undefined') return 'folder'
    const saved = window.localStorage.getItem(`follow:files-view-mode:${workspaceId}`)
    if (saved === 'tree' || saved === 'flat' || saved === 'folder') return saved
    return 'folder'
  })
  useEffect(() => {
    if (typeof window === 'undefined' || !workspaceId) return
    window.localStorage.setItem(`follow:files-view-mode:${workspaceId}`, fileViewMode)
  }, [fileViewMode, workspaceId])

  // Google-Docs-style breadcrumb navigation. Persisted so you come back to
  // where you were after a reload. Empty string = tree root.
  const [currentFolderPath, setCurrentFolderPath] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    return window.localStorage.getItem(`follow:files-current-folder:${workspaceId}`) ?? ''
  })
  useEffect(() => {
    if (typeof window === 'undefined' || !workspaceId) return
    window.localStorage.setItem(`follow:files-current-folder:${workspaceId}`, currentFolderPath)
  }, [currentFolderPath, workspaceId])

  // Sidebar folders-only tree is an optional auxiliary nav within the Folder
  // view. Defaults to ON (that's the Google Docs pattern) but can be collapsed.
  const [showSideTree, setShowSideTree] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem(`follow:files-side-tree`) !== '0'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(`follow:files-side-tree`, showSideTree ? '1' : '0')
  }, [showSideTree])

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set())
  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  // Keyboard delete handler is wired below after `runBulk` is defined so it
  // can dispatch through the same type-aware path used by the toolbar.

  const hiddenCount = useMemo(
    () => filtered.filter((i) => (i.raw as { hidden?: boolean }).hidden).length,
    [filtered]
  )

  const visibleItems = useMemo(
    () => (showHidden ? filtered : filtered.filter((i) => !(i.raw as { hidden?: boolean }).hidden)),
    [filtered, showHidden]
  )

  // Ids of every visible indexable item — raw files, conversations, and
  // workspace files all surface a status badge. The backend /status route
  // resolves conversation ids via their chat_artifact wrapper raw_file.
  // Facts are already indexed records, so we skip them.
  const statusIds = useMemo(
    () =>
      visibleItems
        .filter((i) => i.it !== 'fact')
        .map((i) => i.id)
        .sort(),
    [visibleItems]
  )
  const indexStatus = useIndexStatus(statusIds)

  const invalidateItems = useCallback(() => {
    invalidateItemsHook()
  }, [invalidateItemsHook])

  // Dispatch a single delete to the correct endpoint based on item type and
  // storage backend. Conversations → chat_conversations, workspace files →
  // files table, uploaded raw files → rawFiles table, facts → index_records.
  const deleteOne = useCallback(async (id: string, type: ItemType, isRawFile: boolean) => {
    const url =
      type === 'conv'
        ? `/api/chat/conversations/${id}`
        : type === 'file'
          ? isRawFile
            ? `/api/raw-files/${id}`
            : `/api/files/${id}`
          : `/api/index/items/${id}`
    try {
      await authFetch(url, { method: 'DELETE' })
    } catch {
      /* noop */
    }
  }, [])

  const runBulk = useCallback(
    async (action: 'hide' | 'unhide' | 'delete') => {
      if (selectedIds.length === 0) return
      // Group ids by their item type + storage backend so each goes to the
      // correct endpoint. Raw files (uploaded, possibly unindexed) live in
      // the rawFiles table and delete via /api/raw-files/:id.
      const byType: { conv: string[]; file: string[]; rawfile: string[]; fact: string[] } = {
        conv: [],
        file: [],
        rawfile: [],
        fact: [],
      }
      for (const id of selectedIds) {
        const item = allItems.find((i) => i.id === id)
        if (!item) continue
        if (item.it === 'file' && (item.raw as { _kind?: string })._kind === 'rawfile') {
          byType.rawfile.push(id)
        } else if (item.it === 'file') byType.file.push(id)
        else if (item.it === 'conv') byType.conv.push(id)
        else byType.fact.push(id)
      }

      const tasks: Array<Promise<unknown>> = []

      if (action === 'delete') {
        for (const id of byType.conv) {
          tasks.push(
            authFetch(`/api/chat/conversations/${id}`, { method: 'DELETE' }).catch(() => {})
          )
        }
        for (const id of byType.file) {
          tasks.push(authFetch(`/api/files/${id}`, { method: 'DELETE' }).catch(() => {}))
        }
        for (const id of byType.rawfile) {
          tasks.push(authFetch(`/api/raw-files/${id}`, { method: 'DELETE' }).catch(() => {}))
        }
        if (byType.fact.length > 0) {
          tasks.push(
            authFetch('/api/index/items/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'delete', ids: byType.fact }),
            }).catch(() => {})
          )
        }
      } else {
        // hide/unhide is only meaningful for facts (index_records). Conversations
        // and files don't carry a `hidden` flag — silently skip those.
        if (byType.fact.length > 0) {
          tasks.push(
            authFetch('/api/index/items/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action, ids: byType.fact }),
            }).catch(() => {})
          )
        }
      }

      await Promise.all(tasks)
      clearSelection()
      toggleSelectMode()
      invalidateItems()
    },
    [selectedIds, allItems, clearSelection, toggleSelectMode, invalidateItems]
  )

  const confirmSingleDelete = useCallback(async () => {
    if (!confirmDialog) return
    const item = allItems.find((i) => i.id === confirmDialog.id)
    const isRawFile = (item?.raw as { _kind?: string } | undefined)?._kind === 'rawfile'
    await deleteOne(confirmDialog.id, item?.it ?? 'fact', isRawFile)
    closeConfirmDialog()
    invalidateItems()
  }, [confirmDialog, allItems, deleteOne, closeConfirmDialog, invalidateItems])

  // Bulk-delete via Delete/Backspace while in select mode (skips when typing
  // in inputs, textareas, or contenteditable elements). Dispatches via
  // `runBulk` so the type-aware routing applies.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return
      }
      if (!selectMode || selectedIds.length === 0) return
      e.preventDefault()
      void runBulk('delete')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectMode, selectedIds, runBulk])

  // Shared upload path used by both the drop handler and the OS file picker.
  // Posts to the same /api/index/items/upload endpoint with filePaths[] so
  // browse-uploaded folders preserve structure identically to drag-dropped
  // folders.
  const uploadCollected = useCallback(
    async (collected: Array<{ file: File; path: string }>) => {
      if (collected.length === 0) return
      const form = new FormData()
      for (const { file, path } of collected) {
        form.append('files', file)
        form.append('filePaths', path)
      }
      try {
        await authFetch('/api/index/items/upload', { method: 'POST', body: form })
      } catch {
        /* noop */
      }
      invalidateItems()
    },
    [invalidateItems]
  )

  const fileInputRef = useRef<HTMLInputElement>(null)
  const onFilesPicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files
      if (!fileList || fileList.length === 0) return
      const collected = Array.from(fileList).map((f) => ({
        file: f,
        path: (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? '',
      }))
      await uploadCollected(collected)
      // Reset the input so re-selecting the same file still fires change.
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [uploadCollected]
  )
  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(false)

      // MCP-FIX-4: walk folder drops via webkitGetAsEntry so the on-disk
      // structure reaches the backend as `filePaths[]`. Falls back to
      // `dataTransfer.files` for loose-file drops (no paths).
      const items = e.dataTransfer.items
      const hasEntries =
        items && items.length > 0 && typeof items[0]?.webkitGetAsEntry === 'function'

      const collected: Array<{ file: File; path: string }> = []
      if (hasEntries) {
        const copied: DataTransferItem[] = []
        for (let i = 0; i < items.length; i++) copied.push(items[i]!)
        const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
          if (entry.isFile) {
            const fe = entry as FileSystemFileEntry
            await new Promise<void>((resolve) => {
              fe.file(
                (f) => {
                  collected.push({
                    file: f,
                    path: prefix ? `${prefix}/${entry.name}` : entry.name,
                  })
                  resolve()
                },
                () => resolve()
              )
            })
          } else if (entry.isDirectory) {
            const de = entry as FileSystemDirectoryEntry
            const reader = de.createReader()
            await new Promise<void>((resolve) => {
              const readBatch = () => {
                reader.readEntries(async (batch) => {
                  if (batch.length === 0) return resolve()
                  for (const child of batch) {
                    await walk(child, prefix ? `${prefix}/${entry.name}` : entry.name)
                  }
                  readBatch()
                })
              }
              readBatch()
            })
          }
        }
        await Promise.all(
          copied.map(async (item) => {
            const entry = item.webkitGetAsEntry?.()
            if (entry) await walk(entry, '')
          })
        )
      } else {
        for (const f of Array.from(e.dataTransfer.files ?? [])) {
          collected.push({
            file: f,
            path: (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? '',
          })
        }
      }

      await uploadCollected(collected)
    },
    [uploadCollected]
  )

  // Sprint MCP-3: trigger indexing for a specific uploaded raw file.
  // Clicked from the per-row IndexStatusBadge. Invalidates the status query
  // immediately so the badge flips to "queued" without waiting for the next
  // poll interval.
  const indexFileNow = useCallback(
    async (fileId: string) => {
      try {
        const res = await authFetch(`/api/index/items/${fileId}/index`, { method: 'POST' })
        if (!res.ok) {
          const body = await res.text()
          // Surface backend errors so failures don't look silent from the UI.
          // eslint-disable-next-line no-console
          console.error('[index] enqueue failed', res.status, body)
          alert(`Couldn't start indexing (${res.status}): ${body}`)
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[index] network error', err)
        alert(`Indexing request failed: ${(err as Error).message ?? err}`)
      }
      queryClient.invalidateQueries({ queryKey: ['index-status'] })
    },
    [queryClient]
  )

  // Cancel an in-flight index job for a specific item. The badge popover
  // exposes this whenever status.jobId is present and the job is active.
  const cancelIndexJob = useCallback(
    async (jobId: string) => {
      try {
        await authFetch(`/api/index-queue/jobs/${jobId}/cancel`, { method: 'POST' })
      } catch {
        /* noop */
      }
      queryClient.invalidateQueries({ queryKey: ['index-status'] })
    },
    [queryClient]
  )

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      data-testid="items-view"
      onDragOver={(e) => {
        e.preventDefault()
        setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={onDrop}
    >
      <style jsx>{`
        :global(.items-view-row:hover .item-row-actions [data-testid^='item-delete-btn']) {
          opacity: 1 !important;
        }
        :global(.items-view-row .item-row-actions [data-testid^='item-delete-btn']:hover) {
          background: rgba(197, 48, 48, 0.1);
        }
        :global(.items-view-row .item-row-actions [data-testid^='item-delete-btn']:focus-visible) {
          opacity: 1 !important;
          outline: 1px solid #c53030;
          outline-offset: 1px;
        }
      `}</style>
      {dragActive && <DragDropOverlay />}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        data-testid="items-view-file-input"
        onChange={onFilesPicked}
        style={{ display: 'none' }}
      />

      {/* Header bar */}
      <div
        className="flex h-14 flex-shrink-0 items-center justify-between px-6"
        style={{ borderBottom: '1px solid var(--n150, #e5e2de)', background: '#fff' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{ fontSize: 15, fontWeight: 500, color: 'var(--n800, #332e25)' }}
            data-testid="items-title"
          >
            {selected
              ? selected.title
              : sectionFilter === 'all'
                ? 'All Items'
                : sectionFilter === 'conversation'
                  ? 'Conversations'
                  : sectionFilter === 'file'
                    ? 'Files'
                    : 'Facts'}
          </span>
          {selected && <SourcePill source={selected.source} />}
          {!selected && (
            <span style={{ fontSize: 11, color: 'var(--n400, #9c968d)' }}>
              · {visibleItems.length} items
            </span>
          )}
          {!selected && hiddenCount > 0 && (
            <button
              data-testid="hidden-toggle"
              onClick={toggleShowHidden}
              style={{
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 10,
                border: '1px solid #d97706',
                background: showHidden ? '#d97706' : 'rgba(217,119,6,0.12)',
                color: showHidden ? '#fff' : '#d97706',
                cursor: 'pointer',
                fontFamily: 'monospace',
              }}
            >
              {hiddenCount} hidden
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {selected && <DetailViewToggle current={detailViewMode} />}
          {!selected && !selectMode && !addPanelOpen && (
            <>
              <AutoIndexHeaderToggle />
              {/* MCP-FIX-4: tree/flat toggle for the Files section. Hidden
                  in All/Conversations/Facts views where it doesn't apply. */}
              {sectionFilter === 'file' && (
                <div
                  data-testid="files-view-mode-toggle"
                  style={{
                    display: 'flex',
                    background: 'var(--n100, #f0eeeb)',
                    borderRadius: 8,
                    padding: 3,
                  }}
                >
                  {(['folder', 'tree', 'flat'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setFileViewMode(m)}
                      data-testid={`files-view-mode-${m}`}
                      style={{
                        padding: '4px 11px',
                        border: 'none',
                        borderRadius: 6,
                        fontSize: 10,
                        background: fileViewMode === m ? '#fff' : 'transparent',
                        color: fileViewMode === m ? 'var(--n800, #332e25)' : 'var(--n500, #807a70)',
                        cursor: 'pointer',
                        fontFamily: 'monospace',
                        textTransform: 'capitalize',
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
              <button
                data-testid="select-toggle"
                onClick={toggleSelectMode}
                style={headerSecondaryBtn}
              >
                Select
              </button>
              <AddToIndexButton onClick={openAddPanel} />
              <button
                type="button"
                data-testid="upload-files-btn"
                onClick={openFilePicker}
                title="Upload files — or drag & drop them anywhere on the dashboard. Folders preserve their structure."
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px',
                  border: '1.5px dashed var(--n300, #c7c3bd)',
                  borderRadius: 8,
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: 'var(--n600, #6b6358)',
                  transition: 'border-color 120ms, color 120ms, background 120ms',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#6C63FF'
                  e.currentTarget.style.color = '#6C63FF'
                  e.currentTarget.style.background = 'rgba(108,99,255,0.05)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--n300, #c7c3bd)'
                  e.currentTarget.style.color = 'var(--n600, #6b6358)'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <span
                  aria-hidden
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    border: '1px solid currentColor',
                    fontSize: 11,
                    lineHeight: 1,
                  }}
                >
                  +
                </span>
                <span>Drop files or browse</span>
              </button>
            </>
          )}
          {selectMode && (
            <>
              <span
                data-testid="select-count"
                style={{ fontSize: 11, color: 'var(--n600, #6b6358)', fontFamily: 'monospace' }}
              >
                {selectedIds.length} selected
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--n400, #9c968d)',
                  fontFamily: 'monospace',
                }}
                title="Ctrl/⌘-click to toggle, Shift-click to extend range"
              >
                ⌘-click · ⇧-click
              </span>
              <button
                data-testid="bulk-select-all"
                onClick={() => selectAll(visibleItems.map((i) => i.id))}
                style={headerSecondaryBtn}
              >
                Select all
              </button>
              <button
                data-testid="bulk-hide"
                onClick={() => runBulk('hide')}
                style={{ ...headerSecondaryBtn, color: '#d97706', borderColor: '#d97706' }}
              >
                Hide
              </button>
              <button
                data-testid="bulk-remove"
                onClick={() => runBulk('delete')}
                style={{ ...headerSecondaryBtn, color: '#c53030', borderColor: '#c53030' }}
              >
                Remove
              </button>
              <button
                data-testid="bulk-cancel"
                onClick={() => {
                  clearSelection()
                  toggleSelectMode()
                  selectionAnchorRef.current = null
                }}
                style={headerSecondaryBtn}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <div
          style={{
            width: selected ? 320 : '100%',
            borderRight: selected ? '1px solid var(--n150, #e5e2de)' : 'none',
            overflow: 'auto',
            flexShrink: 0,
          }}
          data-testid="items-list"
        >
          {/* Persistent drop affordance — sits above the list so users can
              upload even when there are already items. Sized compact when
              items exist, more prominent when the list is empty. */}
          <div style={{ padding: '12px 16px 0' }}>
            <div
              data-testid="items-list-dropzone"
              role="button"
              tabIndex={0}
              onClick={openFilePicker}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openFilePicker()
                }
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#6C63FF'
                e.currentTarget.style.background = 'rgba(108,99,255,0.05)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--n200, #d9d5cf)'
                e.currentTarget.style.background = 'var(--n50, #faf9f7)'
              }}
              style={{
                border: '1.5px dashed var(--n200, #d9d5cf)',
                borderRadius: 10,
                padding: filtered.length === 0 && !isLoading ? '28px 16px' : '12px 16px',
                cursor: 'pointer',
                background: 'var(--n50, #faf9f7)',
                transition: 'border-color 120ms, background 120ms, padding 120ms',
                outline: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: filtered.length === 0 && !isLoading ? 32 : 22,
                  height: filtered.length === 0 && !isLoading ? 32 : 22,
                  borderRadius: 6,
                  border: '1.5px solid #6C63FF',
                  color: '#6C63FF',
                  fontSize: filtered.length === 0 && !isLoading ? 18 : 14,
                  fontWeight: 500,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                +
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--n800, #332e25)',
                    marginBottom: 2,
                  }}
                >
                  Drop files here or click to browse
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--n500, #807a70)',
                    fontFamily: 'monospace',
                  }}
                >
                  Documents, images, code, PDFs — any file type
                </div>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div
              style={{
                padding: 24,
                color: 'var(--n400, #9c968d)',
                fontSize: 12,
              }}
              data-testid="items-loading"
            >
              Loading items...
            </div>
          ) : filtered.length === 0 ? (
            <div
              style={{
                padding: '16px 24px 24px',
                color: 'var(--n400, #9c968d)',
                fontSize: 11,
                fontFamily: 'monospace',
              }}
              data-testid="items-empty"
            >
              No items in this section yet.
            </div>
          ) : (
            (() => {
              // MCP-FIX-4: when the Files section is active and tree mode is
              // selected, render a folder tree built from `raw.filePath`.
              // Fallback to the flat list when no file has a multi-segment
              // path (otherwise every file lands at root and tree mode is
              // pointless). Conversations / facts always render flat.
              const renderItemRow = (item: UnifiedItem, indent = 0) => {
                const isSel = selected?.id === item.id
                const itemHidden = Boolean((item.raw as { hidden?: boolean }).hidden)
                const checked = selectedIds.includes(item.id)
                // Modifier-aware click: ctrl/meta to add, shift to extend a
                // range from the last anchor, plain click opens the item.
                // Auto-enters selectMode the moment the user modifier-clicks.
                const handleRowClick = (e: React.MouseEvent) => {
                  const isCtrl = e.ctrlKey || e.metaKey
                  const isShift = e.shiftKey
                  if (!selectMode && !isCtrl && !isShift) {
                    setSelectedItem({ id: item.id, type: item.it })
                    return
                  }
                  if (!selectMode) toggleSelectMode()
                  if (isShift && selectionAnchorRef.current) {
                    const orderedIds = visibleItems.map((v) => v.id)
                    const a = orderedIds.indexOf(selectionAnchorRef.current)
                    const b = orderedIds.indexOf(item.id)
                    if (a >= 0 && b >= 0) {
                      const [lo, hi] = a <= b ? [a, b] : [b, a]
                      const range = orderedIds.slice(lo, hi + 1)
                      const merged = Array.from(new Set([...selectedIds, ...range]))
                      selectAll(merged)
                      return
                    }
                  }
                  toggleSelected(item.id)
                  selectionAnchorRef.current = item.id
                }
                return (
                  <div
                    key={item.id}
                    className="items-view-row"
                    onClick={handleRowClick}
                    style={{
                      padding: '12px 18px',
                      paddingLeft: 18 + indent,
                      borderBottom: '1px solid var(--n100, #f0eeeb)',
                      cursor: 'pointer',
                      background: isSel ? 'rgba(108,99,255,0.08)' : 'transparent',
                      borderLeft: isSel ? '3px solid #6C63FF' : '3px solid transparent',
                      opacity: itemHidden ? 0.55 : 1,
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                    }}
                    data-testid={`item-${item.id}`}
                  >
                    {selectMode && (
                      <input
                        type="checkbox"
                        data-testid={`item-checkbox-${item.id}`}
                        checked={checked}
                        onChange={() => toggleSelected(item.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: 18, height: 18, accentColor: '#6C63FF', marginTop: 2 }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          color: isSel ? '#6C63FF' : 'var(--n800, #332e25)',
                          fontWeight: 500,
                          marginBottom: 3,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.title}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          flexWrap: 'wrap',
                        }}
                      >
                        <SourcePill source={item.source} small />
                        {typeof (item.raw as { _groupCount?: number })._groupCount === 'number' &&
                          (item.raw as { _groupCount: number })._groupCount > 1 && (
                            <span
                              data-testid={`item-group-badge-${item.id}`}
                              title={`${(item.raw as { _groupCount: number })._groupCount} saved updates of this conversation`}
                              style={{
                                fontSize: 9,
                                fontFamily: 'monospace',
                                color: '#6C63FF',
                                background: 'rgba(108,99,255,0.12)',
                                padding: '1px 6px',
                                borderRadius: 4,
                              }}
                            >
                              ×{(item.raw as { _groupCount: number })._groupCount} updates
                            </span>
                          )}
                        {item.time && (
                          <span style={{ fontSize: 10, color: 'var(--n400, #9c968d)' }}>
                            {item.time}
                          </span>
                        )}
                        {typeof item.confidence === 'number' && (
                          <ConfidenceDot value={item.confidence} />
                        )}
                        {item.it !== 'fact' && (
                          <IndexStatusBadge
                            fileId={item.id}
                            status={
                              indexStatus[item.id] ?? {
                                upload: 'uploaded',
                                index: 'not_indexed',
                              }
                            }
                            onIndex={indexFileNow}
                            onCancel={cancelIndexJob}
                          />
                        )}
                        {itemHidden && (
                          <span
                            data-testid={`item-hidden-badge-${item.id}`}
                            style={{
                              fontSize: 9,
                              fontFamily: 'monospace',
                              color: '#d97706',
                              background: 'rgba(217,119,6,0.12)',
                              padding: '1px 6px',
                              borderRadius: 4,
                            }}
                          >
                            hidden
                          </span>
                        )}
                      </div>
                    </div>
                    {!selectMode && (
                      <div
                        className="item-row-actions"
                        style={{ display: 'flex', alignItems: 'center', gap: 2 }}
                      >
                        <button
                          data-testid={`item-delete-btn-${item.id}`}
                          title="Remove from index"
                          aria-label={`Remove ${item.title} from index`}
                          onClick={(e) => {
                            e.stopPropagation()
                            openConfirmDialog(item.id, item.title)
                          }}
                          style={{
                            padding: 4,
                            border: 'none',
                            background: 'transparent',
                            color: '#c53030',
                            cursor: 'pointer',
                            borderRadius: 4,
                            opacity: 0,
                            transition: 'opacity 120ms ease, background 120ms ease',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M3 6h18" />
                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                          </svg>
                        </button>
                        <button
                          data-testid={`item-menu-btn-${item.id}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpenMenuId(openMenuId === item.id ? null : item.id)
                          }}
                          style={{
                            padding: '2px 8px',
                            fontSize: 14,
                            lineHeight: 1,
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--n400, #9c968d)',
                            cursor: 'pointer',
                            borderRadius: 4,
                          }}
                        >
                          ⋯
                        </button>
                      </div>
                    )}
                    {openMenuId === item.id && (
                      <ItemActionMenu
                        item={{
                          id: item.id,
                          name: item.title,
                          hidden: itemHidden,
                          type: item.it,
                          kind:
                            item.it === 'conv'
                              ? 'conv'
                              : item.it === 'fact'
                                ? 'fact'
                                : (item.raw as { _kind?: string })._kind === 'rawfile'
                                  ? 'rawfile'
                                  : 'file',
                        }}
                        onClose={() => setOpenMenuId(null)}
                        onAfterAction={invalidateItems}
                      />
                    )}
                  </div>
                )
              }

              const isFileSection = sectionFilter === 'file'
              const hasFolders = isFileSection && hasAnyFolderStructure(visibleItems)

              // Google-Docs-style folder view: breadcrumb + optional sidebar
              // tree + flat list of the current folder's immediate children.
              // Folders click to navigate, files click to open. Falls back to
              // the flat list when nothing has a real folder path (otherwise
              // the whole drive would collapse to "empty root").
              const showFolder = isFileSection && fileViewMode === 'folder' && hasFolders
              if (showFolder) {
                const tree = buildFileTree(visibleItems, indexStatus)
                return (
                  <FolderView
                    tree={tree}
                    currentPath={currentFolderPath}
                    setCurrentPath={setCurrentFolderPath}
                    showSideTree={showSideTree}
                    setShowSideTree={setShowSideTree}
                    renderItemRow={renderItemRow}
                    onInvalidateItems={invalidateItems}
                  />
                )
              }

              // Decide whether to render a tree. Only for Files, only when
              // tree mode is toggled on, and only when there's actual folder
              // structure to show.
              const showTree = isFileSection && fileViewMode === 'tree' && hasFolders

              if (!showTree) {
                return visibleItems.map((item) => renderItemRow(item))
              }

              const tree = buildFileTree(visibleItems, indexStatus)

              const renderTreeNodes = (nodes: FileTreeNode[], depth: number): React.ReactNode[] => {
                const out: React.ReactNode[] = []
                for (const node of nodes) {
                  if (node.kind === 'file') {
                    out.push(renderItemRow(node.item, depth * 18))
                  } else {
                    const expanded = expandedFolders.has(node.path)
                    out.push(
                      <FolderRow
                        key={`folder:${node.path}`}
                        folder={node}
                        depth={depth}
                        expanded={expanded}
                        onToggle={() => toggleFolder(node.path)}
                      />
                    )
                    if (expanded) {
                      out.push(...renderTreeNodes(node.children, depth + 1))
                    }
                  }
                }
                return out
              }

              return renderTreeNodes(tree, 0)
            })()
          )}
          {/* 2026-04-29: Recently forgotten bin — restorable within 30 days. */}
          {!selected && <RecentlyForgottenBin />}
        </div>

        {selected && (
          <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
            {detailViewMode === 'original' ? (
              <>
                {selected.it === 'conv' &&
                  (() => {
                    const groupIds = (selected.raw as { _groupMemberIds?: string[] })
                      ._groupMemberIds
                    const groupMembers =
                      (
                        selected.raw as {
                          _groupMembers?: Array<{ id: string; title: string; createdAt?: string }>
                        }
                      )._groupMembers ?? []
                    if (groupIds && groupIds.length > 1) {
                      return (
                        <ConversationGroupDetail
                          memberIds={groupIds}
                          members={groupMembers}
                          source={selected.source}
                        />
                      )
                    }
                    return (
                      <ConversationDetail conversationId={selected.id} source={selected.source} />
                    )
                  })()}
                {selected.it === 'file' && <FileDetail item={selected} />}
                {selected.it === 'fact' && <FactDetail item={selected} />}
              </>
            ) : (
              <div
                style={{
                  padding: 32,
                  textAlign: 'center',
                  color: 'var(--n400, #9c968d)',
                  fontSize: 13,
                }}
                data-testid="detail-placeholder"
              >
                {detailViewMode === 'intelligence'
                  ? 'Intelligence view coming soon.'
                  : 'Both view (original + intelligence) coming soon.'}
              </div>
            )}
          </div>
        )}
      </div>

      {confirmDialog && (
        <ConfirmDialog
          name={confirmDialog.name}
          onConfirm={confirmSingleDelete}
          onCancel={closeConfirmDialog}
        />
      )}

      {/* STABILIZE-3: Add-to-Index is now a floating modal */}
      {addPanelOpen && <AddToIndexModalMount onClose={closeAddPanel} />}
    </div>
  )
}
