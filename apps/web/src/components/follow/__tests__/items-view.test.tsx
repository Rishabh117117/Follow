import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { useFollowDashboardStore } from '@/stores/follow-dashboard-store'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '..', 'items', 'items-view.tsx'), 'utf-8')

// Sprint UI-SPLIT-1: items-view.tsx was split into sub-files under
// ./items/. These tests previously grepped a single monolith; now they grep
// the sub-files where each extracted component lives.
const sub = (rel: string) => readFileSync(resolve(__dirname, '..', 'items', rel), 'utf-8')
const detailToggleSrc = sub('detail/detail-view-toggle.tsx')
const sharedSrc = sub('_shared.ts')
const convoGroupSrc = sub('detail/conversation-group-detail.tsx')
const convoDetailSrc = sub('detail/conversation-detail.tsx')
const buildFileTreeSrc = sub('file-tree/build-file-tree.ts')
const folderRowSrc = sub('file-tree/folder-row.tsx')

describe('ItemsView (WIRE-2)', () => {
  beforeEach(() => {
    useFollowDashboardStore.setState({
      sectionFilter: 'all',
      selectedItem: null,
      detailViewMode: 'original',
      sidebarView: 'items',
    })
  })

  it('fetches conversations, files, and facts in parallel', () => {
    expect(source).toContain('/api/chat/conversations')
    expect(source).toContain('/api/files')
    expect(source).toContain('/api/index/query')
  })

  it('merges items into a unified list with discriminator "it"', () => {
    expect(source).toContain("it: 'conv'")
    expect(source).toContain("it: 'file'")
    expect(source).toContain("it: 'fact'")
  })

  it('filters items by sectionFilter from store', () => {
    expect(source).toContain('sectionFilter')
    useFollowDashboardStore.getState().setSectionFilter('file')
    expect(useFollowDashboardStore.getState().sectionFilter).toBe('file')
    expect(source).toContain('filtered')
  })

  it('clicking item calls setSelectedItem with {id, type}', () => {
    expect(source).toContain('setSelectedItem')
    useFollowDashboardStore.getState().setSelectedItem({ id: 'x', type: 'conv' })
    const sel = useFollowDashboardStore.getState().selectedItem
    expect(sel?.id).toBe('x')
    expect(sel?.type).toBe('conv')
  })

  it('renders correct detail component by type', () => {
    expect(source).toContain('ConversationDetail')
    expect(source).toContain('FileDetail')
    expect(source).toContain('FactDetail')
    expect(source).toContain('conversation-detail')
    expect(source).toContain('file-detail')
    expect(source).toContain('fact-detail')
  })

  it('shows empty state when no items', () => {
    expect(source).toContain('items-empty')
    expect(source).toContain('No items in this index yet')
  })

  it('shows loading state while fetching', () => {
    expect(source).toContain('items-loading')
    expect(source).toContain('Loading items')
  })

  it('detail view toggle renders Original / Intelligence / Both', () => {
    expect(detailToggleSrc).toContain('detail-toggle')
    expect(detailToggleSrc).toContain('detail-toggle-${m}')
    expect(detailToggleSrc).toContain(
      "modes: DetailViewMode[] = ['original', 'intelligence', 'both']"
    )
  })

  it('Intelligence and Both panes show placeholder', () => {
    expect(source).toContain('detail-placeholder')
    expect(source).toContain('Intelligence view coming soon')
    expect(source).toContain('Both view (original + intelligence) coming soon')
  })

  // ── MCP-FIX-3: conversation grouping + section dividers ────────────────────
  // Duplicate-title conversations (re-saves where the first user turn differs,
  // so threadHash doesn't merge them) are clubbed into one sidebar row with
  // an "×N updates" badge. Selecting the row renders each member's messages
  // stacked with a divider above each section.

  it('defines a normalizeGroupTitle helper that strips (v2) suffixes', () => {
    expect(sharedSrc).toContain('function normalizeGroupTitle')
    expect(sharedSrc).toContain('\\(v\\d+\\)')
  })

  it('groups conversations by normalized title + source', () => {
    expect(source).toContain('_groupMemberIds')
    expect(source).toContain('_groupCount')
    expect(source).toContain('_groupMembers')
    expect(source).toContain('normalizeGroupTitle')
  })

  it('shows an ×N updates badge in the list row when a group has multiple members', () => {
    expect(source).toContain('item-group-badge-')
    expect(source).toContain('updates')
  })

  it('renders a ConversationGroupDetail component with section dividers', () => {
    expect(convoGroupSrc).toContain('function ConversationGroupDetail')
    expect(convoGroupSrc).toContain('function GroupSectionDivider')
    expect(convoGroupSrc).toContain('Initial save')
    expect(convoGroupSrc).toContain('Update ')
    expect(convoGroupSrc).toContain('group-section-divider-')
  })

  it('routes selection to ConversationGroupDetail when _groupMemberIds is set', () => {
    expect(source).toContain('_groupMemberIds')
    expect(source).toContain('<ConversationGroupDetail')
  })

  it('suppresses the per-conversation version chip inside a group (compact mode)', () => {
    expect(convoDetailSrc).toContain('compact?: boolean')
    // The version bar must be gated on !compact so stacking N members inside a
    // group doesn't render N duplicate version chips.
    expect(convoDetailSrc).toContain('!compact && (currentVersion > 1 || history.length > 0)')
  })

  // ── MCP-FIX-4: folder tree view for Files ─────────────────────────────────
  // Users uploading a whole codebase want to see it as nested folders, not a
  // flat 1000-item scroll. Files with `filePath` populated feed a tree; the
  // old flat view stays available as a toggle.

  it('exports buildFileTree and hasAnyFolderStructure for runtime testing', () => {
    expect(buildFileTreeSrc).toContain('export function buildFileTree')
    expect(buildFileTreeSrc).toContain('export function hasAnyFolderStructure')
  })

  it('defines FileTreeFolder / FileTreeLeaf / FileTreeNode types', () => {
    expect(buildFileTreeSrc).toContain('interface FileTreeFolder')
    expect(buildFileTreeSrc).toContain('interface FileTreeLeaf')
    expect(buildFileTreeSrc).toContain('type FileTreeNode')
  })

  it('renders a FolderRow component with caret + file count + status pills', () => {
    expect(folderRowSrc).toContain('function FolderRow')
    expect(folderRowSrc).toContain('folder-caret-')
    expect(folderRowSrc).toContain('folder-count-')
    expect(folderRowSrc).toContain('folder-status-')
  })

  it('renders a tree/flat toggle in the Files header', () => {
    expect(source).toContain('files-view-mode-toggle')
    expect(source).toContain('files-view-mode-${m}')
    // Sprint D-era added a 'folder' mode alongside 'tree' and 'flat'.
    expect(source).toContain("(['folder', 'tree', 'flat'] as const)")
  })

  it('persists the chosen view mode per workspace to localStorage', () => {
    expect(source).toContain('follow:files-view-mode:')
  })

  it('branches the list render between tree and flat using showTree gate', () => {
    expect(source).toContain('const showTree =')
    expect(source).toContain("sectionFilter === 'file'")
    expect(source).toContain("fileViewMode === 'tree'")
    expect(source).toContain('hasAnyFolderStructure(visibleItems)')
  })

  it('sends filePaths[] alongside files[] when uploading via drag-drop', () => {
    // The root drop handler must fan out walked-folder entries into both
    // `files` and `filePaths` form fields so the backend can preserve tree
    // structure.
    expect(source).toContain("form.append('files', file)")
    expect(source).toContain("form.append('filePaths', path)")
  })

  it('drop handler walks webkitGetAsEntry directory trees', () => {
    expect(source).toContain('webkitGetAsEntry')
    expect(source).toContain('readEntries')
    expect(source).toContain('FileSystemDirectoryEntry')
  })
})
