/**
 * MCP-FIX-4: runtime tests for the file-tree helpers exported from
 * items-view.tsx. These don't need a DOM — they're pure data transforms.
 */
import { describe, it, expect } from 'vitest'
import { buildFileTree, hasAnyFolderStructure } from '@/components/follow/items/items-view'

// Minimal UnifiedItem factory so tests aren't noisy.
function mkItem(args: {
  id: string
  fileName: string
  filePath?: string | null
  source?: string
  sourceType?: string
  hidden?: boolean
}) {
  return {
    id: args.id,
    it: 'file' as const,
    title: args.fileName,
    source: args.source ?? 'local',
    time: '1d ago',
    raw: {
      id: args.id,
      fileName: args.fileName,
      filePath: args.filePath ?? null,
      sourceType: args.sourceType ?? 'upload',
      hidden: args.hidden ?? false,
      _kind: 'rawfile' as const,
    } as Record<string, unknown>,
  }
}

describe('hasAnyFolderStructure', () => {
  it('returns false when no item has a multi-segment path', () => {
    expect(
      hasAnyFolderStructure([
        mkItem({ id: 'a', fileName: 'a.txt' }),
        mkItem({ id: 'b', fileName: 'b.txt', filePath: null }),
        mkItem({ id: 'c', fileName: 'c.txt', filePath: 'c.txt' }),
      ])
    ).toBe(false)
  })

  it('returns true as soon as one item has a parent folder', () => {
    expect(
      hasAnyFolderStructure([
        mkItem({ id: 'a', fileName: 'a.txt' }),
        mkItem({ id: 'b', fileName: 'b.tsx', filePath: 'apps/web/b.tsx' }),
      ])
    ).toBe(true)
  })

  it('handles Windows backslash paths', () => {
    expect(
      hasAnyFolderStructure([
        mkItem({ id: 'a', fileName: 'foo.ts', filePath: 'apps\\web\\foo.ts' }),
      ])
    ).toBe(true)
  })
})

describe('buildFileTree', () => {
  it('returns an empty array for an empty input', () => {
    expect(buildFileTree([])).toEqual([])
  })

  it('puts files without a filePath at the root', () => {
    const tree = buildFileTree([
      mkItem({ id: 'a', fileName: 'a.txt' }),
      mkItem({ id: 'b', fileName: 'b.txt' }),
    ])
    expect(tree).toHaveLength(2)
    expect(tree.every((n) => n.kind === 'file')).toBe(true)
  })

  it('nests files under their folder structure', () => {
    const items = [
      mkItem({ id: '1', fileName: 'page.tsx', filePath: 'apps/web/src/app/page.tsx' }),
      mkItem({ id: '2', fileName: 'layout.tsx', filePath: 'apps/web/src/app/layout.tsx' }),
      mkItem({ id: '3', fileName: 'utils.ts', filePath: 'apps/web/src/lib/utils.ts' }),
    ]
    const tree = buildFileTree(items)
    expect(tree).toHaveLength(1)
    const apps = tree[0]!
    expect(apps.kind).toBe('folder')
    if (apps.kind !== 'folder') throw new Error('impossible')
    expect(apps.name).toBe('apps')
    expect(apps.fileCount).toBe(3)

    // apps → web → src → [app, lib]
    const web = apps.children[0]!
    if (web.kind !== 'folder') throw new Error('expected folder')
    const src = web.children[0]!
    if (src.kind !== 'folder') throw new Error('expected folder')
    expect(src.children).toHaveLength(2) // app, lib
    expect(src.fileCount).toBe(3)
  })

  it('sorts folders first, then files, alphabetically', () => {
    const items = [
      mkItem({ id: 'z', fileName: 'zeta.ts', filePath: 'root/zeta.ts' }),
      mkItem({ id: 'a', fileName: 'alpha.ts', filePath: 'root/alpha.ts' }),
      mkItem({ id: 'folderB', fileName: 'f.ts', filePath: 'root/bears/f.ts' }),
      mkItem({ id: 'folderA', fileName: 'f.ts', filePath: 'root/apples/f.ts' }),
    ]
    const tree = buildFileTree(items)
    const root = tree[0]!
    if (root.kind !== 'folder') throw new Error('expected folder')
    // Folders first (apples, bears), then files (alpha, zeta).
    expect(
      root.children.map((c) => (c.kind === 'folder' ? `F:${c.name}` : `f:${c.item.title}`))
    ).toEqual(['F:apples', 'F:bears', 'f:alpha.ts', 'f:zeta.ts'])
  })

  it('normalizes Windows backslash separators', () => {
    const tree = buildFileTree([
      mkItem({ id: '1', fileName: 'app.tsx', filePath: 'apps\\web\\app.tsx' }),
    ])
    const apps = tree[0]!
    if (apps.kind !== 'folder') throw new Error('expected folder')
    expect(apps.name).toBe('apps')
    const web = apps.children[0]!
    if (web.kind !== 'folder') throw new Error('expected folder')
    expect(web.name).toBe('web')
  })

  it('groups chat_artifact files under a synthetic folder', () => {
    const tree = buildFileTree([
      mkItem({ id: '1', fileName: 'code-ts.txt', sourceType: 'chat_artifact' }),
      mkItem({ id: '2', fileName: 'snippet.txt', sourceType: 'chat_artifact' }),
    ])
    expect(tree).toHaveLength(1)
    const folder = tree[0]!
    if (folder.kind !== 'folder') throw new Error('expected folder')
    expect(folder.name).toBe('Chat artifacts')
    expect(folder.fileCount).toBe(2)
  })

  it('rolls up index status counts at every ancestor level', () => {
    const items = [
      mkItem({ id: 'f1', fileName: 'a.ts', filePath: 'src/a.ts' }),
      mkItem({ id: 'f2', fileName: 'b.ts', filePath: 'src/b.ts' }),
      mkItem({ id: 'f3', fileName: 'c.ts', filePath: 'src/deep/c.ts' }),
    ]
    const indexStatus = {
      f1: { index: 'indexed' },
      f2: { index: 'queued' },
      f3: { index: 'failed' },
    }
    const tree = buildFileTree(items, indexStatus)
    const src = tree[0]!
    if (src.kind !== 'folder') throw new Error('expected folder')
    expect(src.statusSummary).toEqual({
      indexed: 1,
      queued: 1,
      notIndexed: 0,
      failed: 1,
    })
    const deep = src.children.find((c) => c.kind === 'folder' && c.name === 'deep')!
    if (deep.kind !== 'folder') throw new Error('expected folder')
    expect(deep.statusSummary.failed).toBe(1)
    expect(deep.fileCount).toBe(1)
  })

  it('drops filename-only "paths" from the parent chain', () => {
    // Desktop Agent passes the full on-disk path including the filename.
    // webkitRelativePath does the same. Ensure the last segment isn't
    // treated as a folder when it matches fileName.
    const tree = buildFileTree([
      mkItem({ id: '1', fileName: 'page.tsx', filePath: 'apps/page.tsx' }),
    ])
    const apps = tree[0]!
    if (apps.kind !== 'folder') throw new Error('expected folder')
    // apps should contain the file directly, not a nested `page.tsx` folder.
    expect(apps.children).toHaveLength(1)
    expect(apps.children[0]!.kind).toBe('file')
  })

  it('treats single-segment filePaths as rootless (same as no path)', () => {
    const tree = buildFileTree([mkItem({ id: '1', fileName: 'bare.txt', filePath: 'bare.txt' })])
    expect(tree).toHaveLength(1)
    expect(tree[0]!.kind).toBe('file')
  })
})
