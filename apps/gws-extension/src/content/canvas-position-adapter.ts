/**
 * Canvas Position Adapter
 *
 * Parses the SVG annotation layer that Google Docs renders when
 * `_docs_annotate_canvas_by_ext` is set. Each `.kix-canvas-tile-text svg`
 * contains `<g>` groups (one per paragraph/line) with `<rect>` elements
 * (one per text run) that have precise bounding boxes.
 *
 * This module maps paragraph indices to screen-space DOMRects so that
 * Follow overlays (GhostDraft, HighlightRevision, SelectionMenu) can
 * be positioned correctly over canvas-rendered text.
 */

export interface TextRunRect {
  /** Paragraph/group index within the tile */
  groupIndex: number
  /** Rect index within the group */
  rectIndex: number
  /** Bounding box in page-relative coords */
  bounds: DOMRect
  /** Font CSS from data-font-css attribute */
  fontCss: string
}

export interface ParagraphInfo {
  /** Global paragraph index across all tiles */
  globalIndex: number
  /** Tile index this paragraph belongs to */
  tileIndex: number
  /** Group index within the tile */
  localGroupIndex: number
  /** Bounding box encompassing all rects in this group */
  bounds: DOMRect
  /** Individual text run rects */
  textRuns: TextRunRect[]
}

// Cached paragraph data
let _paragraphs: ParagraphInfo[] = []
let _lastRefreshTime = 0
const REFRESH_INTERVAL = 500 // ms

/**
 * Check if annotated canvas mode is active
 */
export function isAnnotatedCanvasActive(): boolean {
  return document.querySelectorAll('.kix-canvas-tile-text svg g').length > 0
}

/**
 * Check if we're in canvas mode (no DOM text nodes)
 */
export function isCanvasMode(): boolean {
  return document.querySelectorAll('.kix-paragraphrenderer').length === 0
}

/**
 * Refresh the paragraph position cache by parsing SVG rects.
 * Call this on scroll, resize, or document changes.
 */
export function refreshPositionCache(): ParagraphInfo[] {
  const now = Date.now()
  if (now - _lastRefreshTime < REFRESH_INTERVAL && _paragraphs.length > 0) {
    return _paragraphs
  }
  _lastRefreshTime = now

  const tiles = document.querySelectorAll('.kix-canvas-tile-text')
  const paragraphs: ParagraphInfo[] = []
  let globalIndex = 0

  tiles.forEach((tile, tileIndex) => {
    const svg = tile.querySelector('svg')
    if (!svg) return

    // Get the tile's position relative to viewport
    const tileRect = tile.getBoundingClientRect()

    const groups = svg.querySelectorAll(':scope > g')
    groups.forEach((g, localGroupIndex) => {
      const rects = g.querySelectorAll('rect')
      if (rects.length === 0) return

      const textRuns: TextRunRect[] = []
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity

      rects.forEach((rect, rectIndex) => {
        const x = parseFloat(rect.getAttribute('x') || '0')
        const y = parseFloat(rect.getAttribute('y') || '0')
        const w = parseFloat(rect.getAttribute('width') || '0')
        const h = parseFloat(rect.getAttribute('height') || '0')
        const fontCss = rect.getAttribute('data-font-css') || ''

        // Convert SVG-local coords to viewport coords
        const viewportX = tileRect.left + x
        const viewportY = tileRect.top + y
        const bounds = new DOMRect(viewportX, viewportY, w, h)

        textRuns.push({ groupIndex: localGroupIndex, rectIndex, bounds, fontCss })

        minX = Math.min(minX, viewportX)
        minY = Math.min(minY, viewportY)
        maxX = Math.max(maxX, viewportX + w)
        maxY = Math.max(maxY, viewportY + h)
      })

      paragraphs.push({
        globalIndex,
        tileIndex,
        localGroupIndex,
        bounds: new DOMRect(minX, minY, maxX - minX, maxY - minY),
        textRuns,
      })
      globalIndex++
    })
  })

  _paragraphs = paragraphs
  return paragraphs
}

/**
 * Get bounding rect for a paragraph by global index.
 * Returns viewport-relative DOMRect or null if not found.
 */
export function getParagraphBounds(paragraphIndex: number): DOMRect | null {
  const paragraphs = refreshPositionCache()
  const para = paragraphs[paragraphIndex]
  return para?.bounds ?? null
}

/**
 * Get the insertion point BELOW a paragraph (for ghost drafts).
 * Returns { top, left, width } in viewport coords.
 */
export function getInsertionPointAfterParagraph(
  paragraphIndex: number
): { top: number; left: number; width: number } | null {
  const paragraphs = refreshPositionCache()
  const para = paragraphs[paragraphIndex]
  if (!para) return null

  return {
    top: para.bounds.bottom + 4, // 4px gap below paragraph
    left: para.bounds.left,
    width: para.bounds.width,
  }
}

/**
 * Get text run bounds within a paragraph.
 * Useful for positioning highlights over specific text ranges.
 */
export function getTextRunBounds(
  paragraphIndex: number,
  runIndex?: number
): DOMRect | null {
  const paragraphs = refreshPositionCache()
  const para = paragraphs[paragraphIndex]
  if (!para) return null

  if (runIndex !== undefined) {
    return para.textRuns[runIndex]?.bounds ?? null
  }

  // Return combined bounds of all runs
  return para.bounds
}

/**
 * Get all paragraphs in the visible viewport.
 * Useful for limiting overlay rendering to visible content.
 */
export function getVisibleParagraphs(): ParagraphInfo[] {
  const paragraphs = refreshPositionCache()
  const vh = window.innerHeight
  return paragraphs.filter(
    (p) => p.bounds.bottom > 0 && p.bounds.top < vh
  )
}

/**
 * Get total paragraph count.
 */
export function getParagraphCount(): number {
  return refreshPositionCache().length
}

/**
 * Find the paragraph closest to a viewport Y coordinate.
 * Useful for mapping click/cursor position to paragraph index.
 */
export function findParagraphAtY(viewportY: number): ParagraphInfo | null {
  const paragraphs = refreshPositionCache()
  let closest: ParagraphInfo | null = null
  let closestDist = Infinity

  for (const para of paragraphs) {
    const centerY = para.bounds.top + para.bounds.height / 2
    const dist = Math.abs(centerY - viewportY)
    if (dist < closestDist) {
      closestDist = dist
      closest = para
    }
  }

  return closest
}

/**
 * Start observing for position changes (scroll, resize, DOM mutations).
 * Returns a cleanup function.
 */
export function observePositionChanges(
  onUpdate: (paragraphs: ParagraphInfo[]) => void
): () => void {
  let rafId: number | null = null

  const refresh = () => {
    const updated = refreshPositionCache()
    onUpdate(updated)
  }

  // Scroll handler
  const editorContainer =
    document.querySelector('.kix-appview-editor') ||
    document.querySelector('.docs-editor-container')

  const scrollHandler = () => {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(refresh)
  }

  editorContainer?.addEventListener('scroll', scrollHandler, { passive: true })
  window.addEventListener('scroll', scrollHandler, { passive: true })
  window.addEventListener('resize', scrollHandler, { passive: true })

  // MutationObserver for tile changes
  const observer = new MutationObserver(scrollHandler)
  const tileContainer = document.querySelector('.kix-appview-editor')
  if (tileContainer) {
    observer.observe(tileContainer, { childList: true, subtree: true })
  }

  // Initial refresh
  refresh()

  return () => {
    editorContainer?.removeEventListener('scroll', scrollHandler)
    window.removeEventListener('scroll', scrollHandler)
    window.removeEventListener('resize', scrollHandler)
    observer.disconnect()
    if (rafId) cancelAnimationFrame(rafId)
  }
}
