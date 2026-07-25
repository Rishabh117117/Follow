/**
 * Google Sheets signal capture.
 * Monitor cell edits, formula changes, sheet tab switches.
 */

import { signalEmitter } from './signal-emitter'
import { sendToBackground } from '@/lib/message-passing'

const CONTENT_SYNC_INTERVAL_MS = 30_000
const MAX_SHEET_CHARS = 10_000

export class SheetsTracker {
  private observer: MutationObserver | null = null
  private previousActiveCell: string | null = null
  private cellCheckTimer: ReturnType<typeof setInterval> | null = null
  private contentSyncTimer: ReturnType<typeof setInterval> | null = null
  private followDocId: string
  private googleDocId: string

  constructor(followDocId: string, googleDocId: string) {
    this.followDocId = followDocId
    this.googleDocId = googleDocId
  }

  start(): void {
    // 1. Monitor formula bar for edit completions
    //    Sheets formula bar: .waffle-formulabar-input
    const formulaBar = document.querySelector(
      '.waffle-formulabar-input, [class*="formula-bar"]'
    )
    if (formulaBar) {
      formulaBar.addEventListener('focusout', () => {
        const value = (formulaBar as HTMLElement).textContent?.trim() || ''
        const activeCell = this.getActiveCellRef()
        if (value && activeCell) {
          const isFormula = value.startsWith('=')
          signalEmitter.emit(isFormula ? 'gws_formula_change' : 'gws_cell_edit', {
            googleDocId: this.googleDocId,
            followDocId: this.followDocId,
            docType: 'sheets',
            cellRef: activeCell,
            newValue: value.substring(0, 200),
          })
        }
      })
    }

    // 2. Monitor active cell changes (selection)
    //    Check every 2 seconds (Sheets don't fire reliable DOM events for cell focus)
    this.cellCheckTimer = setInterval(() => {
      const cellRef = this.getActiveCellRef()
      if (cellRef && cellRef !== this.previousActiveCell) {
        if (this.previousActiveCell) {
          signalEmitter.emit('gws_cell_select', {
            googleDocId: this.googleDocId,
            followDocId: this.followDocId,
            docType: 'sheets',
            cellRef,
          })
        }
        this.previousActiveCell = cellRef
      }
    }, 2000)

    // 3. Monitor sheet tab switches
    document.addEventListener('click', this.handleTabClick)

    signalEmitter.emit('gws_doc_open', {
      googleDocId: this.googleDocId,
      followDocId: this.followDocId,
      docType: 'sheets',
    })

    // 4. Periodic content sync — send visible cell grid for AI context
    this.contentSyncTimer = setInterval(() => this.syncContent(), CONTENT_SYNC_INTERVAL_MS)
    // Fire once shortly after startup so AI has context quickly
    setTimeout(() => this.syncContent(), 3000)
  }

  /**
   * Extract visible cell data from the DOM and send to backend for AI context.
   * Strategy: read rendered cell text from .cell-input / .waffle-cell elements.
   */
  private async syncContent(): Promise<void> {
    try {
      const grid: Record<string, string> = {}
      const activeSheetName = this.getActiveSheetName() || 'Sheet1'

      // Prefer explicit cell elements; fall back to generic grid scraping.
      const cells = document.querySelectorAll<HTMLElement>(
        '.cell-input[data-cell-ref], [data-sheets-value], .waffle-cell'
      )
      let count = 0
      for (const el of Array.from(cells)) {
        const ref = el.getAttribute('data-cell-ref') || el.getAttribute('data-sheets-row-range')
        const value = (el.textContent || '').trim()
        if (!ref || !value) continue
        grid[ref] = value.slice(0, 200)
        if (++count >= 400) break
      }

      const content = this.serializeGrid(activeSheetName, grid).slice(0, MAX_SHEET_CHARS)
      if (!content.trim()) return

      await sendToBackground({
        type: 'CONTENT_SYNC',
        payload: {
          externalDocId: this.googleDocId,
          content,
          paragraphCount: Object.keys(grid).length,
          docType: 'sheets',
          sheetName: activeSheetName,
        } as unknown as Record<string, unknown>,
      })
    } catch (err) {
      console.warn('[SheetsTracker] syncContent failed:', err)
    }
  }

  private getActiveSheetName(): string | null {
    const activeTab = document.querySelector(
      '.docs-sheet-tab-selected, [aria-selected="true"][class*="sheet-tab"]'
    )
    return activeTab?.textContent?.trim() || null
  }

  private serializeGrid(sheetName: string, grid: Record<string, string>): string {
    const lines = [`[Active sheet: ${sheetName}]`]
    // Group by row prefix letter → number for deterministic output
    const keys = Object.keys(grid).sort((a, b) => {
      const [, la = '', na = '0'] = a.match(/^([A-Z]+)(\d+)/) ?? []
      const [, lb = '', nb = '0'] = b.match(/^([A-Z]+)(\d+)/) ?? []
      if (la !== lb) return la.localeCompare(lb)
      return Number(na) - Number(nb)
    })
    for (const ref of keys) {
      lines.push(`${ref}: ${grid[ref]}`)
    }
    return lines.join('\n')
  }

  private handleTabClick = (e: MouseEvent): void => {
    const tab = (e.target as HTMLElement).closest(
      '.docs-sheet-tab, [class*="sheet-tab"]'
    )
    if (tab) {
      const tabName = tab.textContent?.trim() || ''
      signalEmitter.emit('gws_sheet_switch', {
        googleDocId: this.googleDocId,
        followDocId: this.followDocId,
        docType: 'sheets',
        sheetName: tabName,
      })
    }
  }

  private getActiveCellRef(): string | null {
    // Name box (top-left cell reference display)
    const nameBox = document.querySelector(
      '.waffle-name-box input, [class*="name-box"] input'
    ) as HTMLInputElement | null
    return nameBox?.value || null
  }

  stop(): void {
    if (this.observer) this.observer.disconnect()
    if (this.cellCheckTimer) clearInterval(this.cellCheckTimer)
    if (this.contentSyncTimer) clearInterval(this.contentSyncTimer)
    document.removeEventListener('click', this.handleTabClick)
    signalEmitter.emit('gws_doc_close', {
      googleDocId: this.googleDocId,
      followDocId: this.followDocId,
      docType: 'sheets',
    })
  }
}
