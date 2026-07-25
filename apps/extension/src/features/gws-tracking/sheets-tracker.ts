/**
 * Sheets Tracker — monitors cell edits, formula changes, sheet tab switches.
 *
 * Cell selection polling now registered with coordinator instead of own setInterval.
 * Formula bar focusout and tab clicks remain event-driven (no timer needed).
 */

import { signalPipeline } from '@/core/signal-pipeline'
import { coordinator } from '@/core/coordinator'
import { getActiveCellRef } from '@/content/dom-bridge'

const CELL_CHECK_INTERVAL = 2000

export class SheetsTracker {
  private previousActiveCell: string | null = null
  private followDocId: string
  private googleDocId: string
  private handleTabClick: ((e: MouseEvent) => void) | null = null

  constructor(followDocId: string, googleDocId: string) {
    this.followDocId = followDocId
    this.googleDocId = googleDocId
  }

  start(): void {
    // Formula bar edit completion (event-driven)
    const formulaBar = document.querySelector('.waffle-formulabar-input, [class*="formula-bar"]')
    if (formulaBar) {
      formulaBar.addEventListener('focusout', () => {
        const value = (formulaBar as HTMLElement).textContent?.trim() || ''
        const activeCell = getActiveCellRef()
        if (value && activeCell) {
          const isFormula = value.startsWith('=')
          signalPipeline.emit(isFormula ? 'gws_formula_change' : 'gws_cell_edit', {
            googleDocId: this.googleDocId,
            followDocId: this.followDocId,
            docType: 'sheets',
            cellRef: activeCell,
            newValue: value.substring(0, 200),
          }, this.followDocId, 'sheets')
        }
      })
    }

    // Cell selection via coordinator (replaces own setInterval)
    coordinator.register({
      id: 'sheets-cell-check',
      interval: CELL_CHECK_INTERVAL,
      visibilityRequired: true,
      execute: () => this.checkCell(),
    })

    // Sheet tab switches (event-driven)
    this.handleTabClick = (e: MouseEvent) => {
      const tab = (e.target as HTMLElement).closest('.docs-sheet-tab, [class*="sheet-tab"]')
      if (tab) {
        signalPipeline.emit('gws_sheet_switch', {
          googleDocId: this.googleDocId,
          followDocId: this.followDocId,
          docType: 'sheets',
          sheetName: tab.textContent?.trim() || '',
        }, this.followDocId, 'sheets')
      }
    }
    document.addEventListener('click', this.handleTabClick)

    signalPipeline.emit('gws_doc_open', {
      googleDocId: this.googleDocId,
      followDocId: this.followDocId,
      docType: 'sheets',
    }, this.followDocId, 'sheets')
  }

  private checkCell(): void {
    const cellRef = getActiveCellRef()
    if (cellRef && cellRef !== this.previousActiveCell) {
      if (this.previousActiveCell) {
        signalPipeline.emit('gws_cell_select', {
          googleDocId: this.googleDocId,
          followDocId: this.followDocId,
          docType: 'sheets',
          cellRef,
        }, this.followDocId, 'sheets')
      }
      this.previousActiveCell = cellRef
    }
  }

  stop(): void {
    coordinator.unregister('sheets-cell-check')
    if (this.handleTabClick) document.removeEventListener('click', this.handleTabClick)
    signalPipeline.emit('gws_doc_close', {
      googleDocId: this.googleDocId,
      followDocId: this.followDocId,
      docType: 'sheets',
    }, this.followDocId, 'sheets')
  }
}
