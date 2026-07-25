/**
 * Google Sheets Adapter — cell selection detection and text reading.
 *
 * Google Sheets renders cells in a `<table class="waffle">` element.
 * Selected cells have `.cell-input` active or highlighted cells via `.selection-indicator`.
 */

export interface SheetSelection {
  cellRef: string       // e.g., 'A1', 'B2:D5'
  cellText: string      // Text content of selected cell(s)
  formulaText: string   // Formula bar content
  sheetName: string     // Active sheet name
}

/**
 * Check if the current page is in Google Sheets editing mode.
 */
export function isSheetsActive(): boolean {
  return !!document.querySelector('.waffle, [id="waffle-grid-container"]')
}

/**
 * Get the active sheet name.
 */
export function getActiveSheetName(): string {
  const tab = document.querySelector('.docs-sheet-active-tab .docs-sheet-tab-name')
  return tab?.textContent?.trim() ?? 'Sheet1'
}

/**
 * Get the currently selected cell reference from the Name Box.
 */
export function getSelectedCellRef(): string {
  // Name box shows current cell reference (e.g., "A1")
  const nameBox = document.querySelector<HTMLInputElement>('#t-name-box')
  return nameBox?.value?.trim() ?? ''
}

/**
 * Get the formula bar content (shows formula or value of selected cell).
 */
export function getFormulaBarText(): string {
  const formulaBar = document.querySelector('.cell-input')
  return formulaBar?.textContent?.trim() ?? ''
}

/**
 * Get the text content of the active cell.
 */
export function getActiveCellText(): string {
  // The active cell content is shown in the formula bar
  return getFormulaBarText()
}

/**
 * Get the current sheet selection info.
 */
export function getSheetSelection(): SheetSelection | null {
  if (!isSheetsActive()) return null

  const cellRef = getSelectedCellRef()
  if (!cellRef) return null

  return {
    cellRef,
    cellText: getActiveCellText(),
    formulaText: getFormulaBarText(),
    sheetName: getActiveSheetName(),
  }
}

/**
 * Get all visible cell values from the active sheet.
 * Returns a 2D array of strings.
 */
export function getVisibleCellValues(): string[][] {
  const rows = document.querySelectorAll('.waffle tr')
  const result: string[][] = []

  for (const row of rows) {
    const cells = row.querySelectorAll('td, th')
    const rowData: string[] = []
    for (const cell of cells) {
      rowData.push(cell.textContent?.trim() ?? '')
    }
    if (rowData.some((c) => c.length > 0)) {
      result.push(rowData)
    }
  }

  return result
}
