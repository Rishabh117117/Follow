import type { UnifiedItem } from '../_shared'

// ─── File tree (MCP-FIX-4) ─────────────────────────────────────────────────
// Raw files uploaded via the Desktop Agent or via `<input webkitdirectory>`
// carry a `filePath` relative to the folder the user selected. We build a
// nested folder tree from that so the Files view can render folders with
// expand/collapse instead of flattening 1000+ files into one scroll list.

export interface FileTreeFolder {
  kind: 'folder'
  /** Display name ("src", "components") — last segment of path. */
  name: string
  /** Full slash-joined path from tree root ("apps/web/src"). Unique key. */
  path: string
  /** Folders first, then files. Each level sorted alphabetically. */
  children: FileTreeNode[]
  /** Recursive count of descendant FILE leaves. */
  fileCount: number
  /** Aggregated index status across descendants. Keys may be missing. */
  statusSummary: {
    indexed: number
    queued: number
    notIndexed: number
    failed: number
  }
}

export interface FileTreeLeaf {
  kind: 'file'
  item: UnifiedItem
}

export type FileTreeNode = FileTreeFolder | FileTreeLeaf

/**
 * Split a filePath into folder segments. Normalizes `\` (Windows) to `/`,
 * drops empty segments from leading/trailing/double slashes, and strips the
 * trailing filename — the file is added under the returned parent chain.
 */
function splitParentSegments(filePath: string, fileName: string): string[] {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const parts = normalized.split('/').filter((p) => p.length > 0)
  // Drop the last segment only when it matches the fileName — some callers
  // pass a path that's already parent-only (desktop agent passes the full
  // absolute path including filename; webkitRelativePath also does).
  if (parts.length > 0 && parts[parts.length - 1] === fileName) parts.pop()
  return parts
}

export type IndexStatusKey = 'indexed' | 'queued' | 'notIndexed' | 'failed'
function classifyIndexStatus(status: string | undefined): IndexStatusKey {
  if (!status) return 'notIndexed'
  if (status === 'indexed') return 'indexed'
  if (status === 'queued' || status === 'indexing') return 'queued'
  if (status === 'failed' || status === 'cancelled') return 'failed'
  return 'notIndexed'
}

/**
 * Build a nested folder tree from a flat UnifiedItem[] array. Files without
 * a `filePath` (or with one that lacks a separator) land at the tree root.
 * Chat artifacts go under a synthetic `Chat artifacts/` folder so they
 * don't pollute the user's real directory structure.
 *
 * @param items flat list of file-type items (facts/conversations filtered
 *              out by caller)
 * @param indexStatus optional map of rawFileId → { index: status } used to
 *              roll up per-folder counts
 */
export function buildFileTree(
  items: UnifiedItem[],
  indexStatus: Record<string, { index?: string }> = {}
): FileTreeNode[] {
  const root: FileTreeFolder = {
    kind: 'folder',
    name: '',
    path: '',
    children: [],
    fileCount: 0,
    statusSummary: { indexed: 0, queued: 0, notIndexed: 0, failed: 0 },
  }
  const foldersByPath = new Map<string, FileTreeFolder>()
  foldersByPath.set('', root)

  const ensureFolder = (segments: string[]): FileTreeFolder => {
    let parent = root
    let pathSoFar = ''
    for (const seg of segments) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${seg}` : seg
      let folder = foldersByPath.get(pathSoFar)
      if (!folder) {
        folder = {
          kind: 'folder',
          name: seg,
          path: pathSoFar,
          children: [],
          fileCount: 0,
          statusSummary: { indexed: 0, queued: 0, notIndexed: 0, failed: 0 },
        }
        foldersByPath.set(pathSoFar, folder)
        parent.children.push(folder)
      }
      parent = folder
    }
    return parent
  }

  for (const item of items) {
    const rawFilePath = (item.raw as { filePath?: string | null }).filePath ?? null
    const fileName = (item.raw as { fileName?: string; name?: string }).fileName
      ?? (item.raw as { name?: string }).name
      ?? item.title
    const sourceType = (item.raw as { sourceType?: string }).sourceType ?? ''

    let parent = root
    if (rawFilePath && (rawFilePath.includes('/') || rawFilePath.includes('\\'))) {
      const segments = splitParentSegments(rawFilePath, fileName)
      if (segments.length > 0) parent = ensureFolder(segments)
    } else if (sourceType === 'chat_artifact') {
      parent = ensureFolder(['Chat artifacts'])
    }

    parent.children.push({ kind: 'file', item })

    // Roll up stats into this file's ancestors. We walk back up through
    // pathSoFar prefixes — each ancestor is already in `foldersByPath`.
    const bucket = classifyIndexStatus(indexStatus[item.id]?.index)
    const pathParts =
      parent === root ? [] : parent.path.split('/').filter((p) => p.length > 0)
    let prefix = ''
    // Root counts everything.
    root.fileCount++
    root.statusSummary[bucket]++
    for (const seg of pathParts) {
      prefix = prefix ? `${prefix}/${seg}` : seg
      const f = foldersByPath.get(prefix)
      if (!f) continue
      f.fileCount++
      f.statusSummary[bucket]++
    }
  }

  // Sort every level: folders first (alpha), then files (alpha).
  const sortChildren = (folder: FileTreeFolder) => {
    folder.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      const aName = a.kind === 'folder' ? a.name : a.item.title
      const bName = b.kind === 'folder' ? b.name : b.item.title
      return aName.toLowerCase().localeCompare(bName.toLowerCase())
    })
    for (const c of folder.children) if (c.kind === 'folder') sortChildren(c)
  }
  sortChildren(root)

  return root.children
}

/**
 * Walk `roots` (the output of buildFileTree) and return the FileTreeFolder at
 * the given slash-joined path, or `null` for the synthetic root. Returns
 * `undefined` when the path doesn't exist in the current tree — the folder
 * view uses that to fall back to the top level after a rename/move leaves a
 * stale breadcrumb in localStorage.
 */
export function findFolderByPath(
  roots: FileTreeNode[],
  path: string
): FileTreeFolder | null | undefined {
  if (!path) return null // sentinel: render the roots themselves
  const segs = path.split('/').filter(Boolean)
  let currentChildren: FileTreeNode[] = roots
  let found: FileTreeFolder | undefined
  for (const seg of segs) {
    const next = currentChildren.find(
      (c): c is FileTreeFolder => c.kind === 'folder' && c.name === seg
    )
    if (!next) return undefined
    found = next
    currentChildren = next.children
  }
  return found ?? undefined
}

/**
 * Folders-only skeleton used by the sidebar tree in the Folder view. We
 * deliberately drop the file leaves so the sidebar stays compact; files go
 * in the main pane.
 */
export interface FolderSkeleton {
  name: string
  path: string
  fileCount: number
  children: FolderSkeleton[]
}
export function folderSkeleton(roots: FileTreeNode[]): FolderSkeleton[] {
  const out: FolderSkeleton[] = []
  for (const n of roots) {
    if (n.kind !== 'folder') continue
    out.push({
      name: n.name,
      path: n.path,
      fileCount: n.fileCount,
      children: folderSkeleton(n.children),
    })
  }
  return out
}

/**
 * Returns true if at least one item carries a multi-segment filePath — used
 * to decide whether the tree view is meaningful. Purely flat uploads would
 * render as one giant root-level list, which is worse than the flat view.
 */
export function hasAnyFolderStructure(items: UnifiedItem[]): boolean {
  for (const i of items) {
    const p = (i.raw as { filePath?: string | null }).filePath
    if (p && (p.includes('/') || p.includes('\\'))) {
      // Ensure there's at least one path separator BEFORE the filename.
      const parts = p.replace(/\\/g, '/').split('/').filter((s) => s.length > 0)
      if (parts.length >= 2) return true
    }
  }
  return false
}
