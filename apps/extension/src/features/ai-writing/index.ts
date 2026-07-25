/**
 * AI Writing — self-initializing feature module.
 *
 * Mounts SelectionMenu, GhostDraft, and HighlightRevision overlays
 * inside Shadow DOM. Only active on Google Docs/Sheets/Slides pages.
 */

import { createShadowHost, getMountPoint } from '@/content/shadow-host'

let root: { unmount: () => void } | null = null

async function init(): Promise<void> {
  if (root) return

  const ctx = (window as unknown as Record<string, unknown>).__followContext as {
    gwsPage?: { googleDocId: string; docType: 'docs' | 'sheets' | 'slides' }
  } | undefined

  if (!ctx?.gwsPage) return

  const shadow = createShadowHost()
  const mountPoint = getMountPoint()
  if (!mountPoint) return

  const container = document.createElement('div')
  container.id = 'follow-ai-writing'
  mountPoint.appendChild(container)

  const { createRoot } = await import('react-dom/client')
  const { createElement, useState, useCallback, useEffect } = await import('react')
  const { SelectionMenu } = await import('./selection-menu')
  const { GhostDraft } = await import('./ghost-draft')
  const { HighlightRevision } = await import('./highlight-revision')

  const { googleDocId, docType } = ctx.gwsPage

  // Wrapper component that manages ghost drafts and revisions
  function AIWritingOverlays() {
    const [ghostDrafts, setGhostDrafts] = useState<Array<{
      id: string; anchorIndex: number; content: string; status: 'streaming' | 'ready' | 'editing';
      findText?: string | null; action?: string
    }>>([])
    const [revisions, setRevisions] = useState<Array<{
      id: string; originalText: string; proposedText: string; type: string;
      wordDelta: number; status: 'pending' | 'ready'; selectionBounds: DOMRect | null
    }>>([])

    // Listen for ghost draft creation events from the chat panel
    useEffect(() => {
      const handleCreateGhost = (e: Event) => {
        const detail = (e as CustomEvent).detail as {
          id: string; anchorIndex: number; content: string; status: 'ready';
          findText?: string | null; action?: string
        }
        if (detail?.content) {
          setGhostDrafts(prev => [...prev, {
            id: detail.id,
            anchorIndex: detail.anchorIndex,
            content: detail.content,
            status: detail.status || 'ready',
            findText: detail.findText,
            action: detail.action,
          }])
        }
      }
      document.addEventListener('follow-create-ghost-draft', handleCreateGhost)
      return () => document.removeEventListener('follow-create-ghost-draft', handleCreateGhost)
    }, [])

    const handleRevisionCreated = useCallback((data: {
      originalText: string; proposedText: string; type: string;
      wordDelta: number; selectionBounds: DOMRect | null
    }) => {
      setRevisions(prev => [...prev, {
        id: `rev-${Date.now()}`,
        ...data,
        status: 'ready' as const,
      }])
    }, [])

    return createElement('div', null,
      createElement(SelectionMenu, {
        googleDocId,
        docType,
        onRevisionCreated: handleRevisionCreated,
      }),
      ...ghostDrafts.map(d => createElement(GhostDraft, {
        key: d.id,
        draft: { ...d, googleDocId, docType, findText: d.findText, action: d.action },
        onDismiss: (id: string) => setGhostDrafts(prev => prev.filter(g => g.id !== id)),
        onCommit: (id: string) => setGhostDrafts(prev => prev.filter(g => g.id !== id)),
      })),
      ...revisions.map(r => createElement(HighlightRevision, {
        key: r.id,
        revision: { ...r, googleDocId, docType },
        onAccept: (id: string) => setRevisions(prev => prev.filter(v => v.id !== id)),
        onReject: (id: string) => setRevisions(prev => prev.filter(v => v.id !== id)),
      })),
    )
  }

  const reactRoot = createRoot(container)
  reactRoot.render(createElement(AIWritingOverlays))
  root = reactRoot
}

function cleanup(): void {
  root?.unmount()
  root = null
}

init()
document.addEventListener('follow-unload-ai-writing', cleanup)
