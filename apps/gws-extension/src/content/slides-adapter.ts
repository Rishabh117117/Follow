/**
 * Google Slides Adapter — shape text selection and speaker notes reading.
 *
 * Google Slides renders slides in `.punch-viewer-content` with
 * editable text in `.punch-viewer-svgpage-textbox` elements.
 * Speaker notes are in `.punch-viewer-speakernotes-text`.
 */

export interface SlideSelection {
  slideIndex: number    // Current slide index (0-based)
  selectedText: string  // Text in the selected shape
  speakerNotes: string  // Speaker notes for current slide
}

/**
 * Check if the current page is in Google Slides editing mode.
 */
export function isSlidesActive(): boolean {
  return !!document.querySelector('.punch-viewer-content, [class*="punch-viewer"]')
}

/**
 * Get the current slide index (0-based).
 */
export function getCurrentSlideIndex(): number {
  // The filmstrip shows the active slide
  const activeThumb = document.querySelector('.punch-filmstrip-thumbnail[aria-selected="true"]')
  if (!activeThumb) return 0

  const thumbs = document.querySelectorAll('.punch-filmstrip-thumbnail')
  for (let i = 0; i < thumbs.length; i++) {
    if (thumbs[i] === activeThumb) return i
  }
  return 0
}

/**
 * Get the total slide count.
 */
export function getSlideCount(): number {
  return document.querySelectorAll('.punch-filmstrip-thumbnail').length
}

/**
 * Get text from the currently selected shape/textbox.
 */
export function getSelectedShapeText(): string {
  // When a text box is selected and being edited, its content is in a contenteditable
  const activeEditor = document.querySelector<HTMLElement>(
    '.punch-viewer-svgpage-textbox [contenteditable="true"]'
  )
  if (activeEditor) {
    return activeEditor.textContent?.trim() ?? ''
  }

  // Check for selected text via window selection
  const selection = window.getSelection()
  if (selection && selection.toString().trim()) {
    return selection.toString().trim()
  }

  return ''
}

/**
 * Get all text from the current slide.
 */
export function getCurrentSlideText(): string {
  const textBoxes = document.querySelectorAll('.punch-viewer-svgpage-textbox')
  const texts: string[] = []

  for (const box of textBoxes) {
    const text = box.textContent?.trim()
    if (text) texts.push(text)
  }

  return texts.join('\n\n')
}

/**
 * Get the speaker notes for the current slide.
 */
export function getSpeakerNotes(): string {
  const notesEl = document.querySelector('.punch-viewer-speakernotes-text')
  return notesEl?.textContent?.trim() ?? ''
}

/**
 * Get the current slide selection info.
 */
export function getSlideSelection(): SlideSelection | null {
  if (!isSlidesActive()) return null

  return {
    slideIndex: getCurrentSlideIndex(),
    selectedText: getSelectedShapeText() || getCurrentSlideText(),
    speakerNotes: getSpeakerNotes(),
  }
}
