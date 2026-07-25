/**
 * Insertion Service (Sprint E-2)
 *
 * Central fallback chain for writing text into a Google Doc:
 *
 *   1. Clipboard paste  (~100ms, in-tab, requires content-editable focus)
 *   2. Apps Script      (~2-5s, server-queued via addon-actions)
 *   3. Manual           (copies to clipboard + shows toast)
 *
 * The service is called from GhostDraft commit and HighlightRevision accept
 * handlers. It also plays the settle animation and broadcasts provenance
 * signals via signalEmitter.
 */

import { sendToBackground } from '@/lib/message-passing'
import { useOverlayStore } from '@/stores/overlay-store'
import { getDocumentText } from '@/content/dom-bridge'

export type InsertionMode = 'insert_after' | 'replace_range'
export type InsertionMethod = 'clipboard' | 'apps_script' | 'manual'

export interface InsertOptions {
  content: string
  mode: InsertionMode
  /** for insert_after — index into .kix-paragraphrenderer list */
  paragraphIndex?: number
  /** for replace_range — character offsets into the document text */
  startIndex?: number
  endIndex?: number
  /** for replace_range — guard against stale positions */
  expectedText?: string
}

export interface InsertResult {
  success: boolean
  method: InsertionMethod
  error?: string
}

const MUTATION_TIMEOUT_MS = 500
const APPS_SCRIPT_MAX_WAIT_MS = 15_000
const APPS_SCRIPT_POLL_MS = 500

/**
 * Try to insert text into the current Google Doc. Walks the fallback chain
 * until one method succeeds, or falls back to "manual" (clipboard + toast).
 */
export async function insertText(options: InsertOptions): Promise<InsertResult> {
  const positionValid = validatePosition(options)

  // TRY 1 — Clipboard paste. Skip if position validation failed,
  //         because clipboard path uses DOM positioning which is already stale.
  if (positionValid) {
    try {
      const result = await clipboardInsert(options)
      if (result.verified) {
        triggerSettleAnimation(options.paragraphIndex)
        return { success: true, method: 'clipboard' }
      }
    } catch (err) {
      console.warn('[insertion-service] clipboard insert failed:', err)
    }
  }

  // TRY 2 — Apps Script via backend queue.
  try {
    const result = await appsScriptInsert(options)
    if (result.success) {
      triggerSettleAnimation(options.paragraphIndex)
      return { success: true, method: 'apps_script' }
    }
  } catch (err) {
    console.warn('[insertion-service] apps_script insert failed:', err)
  }

  // TRY 3 — Manual fallback. Write to clipboard and surface a toast.
  try {
    await navigator.clipboard.writeText(options.content)
  } catch {
    // best effort — clipboard may be blocked
  }
  showInsertionFailureToast(options.content)
  return { success: false, method: 'manual' }
}

// ─── Position validation ─────────────────────────────────────────────────

function validatePosition(options: InsertOptions): boolean {
  if (options.mode !== 'replace_range' || !options.expectedText) return true
  if (options.startIndex == null || options.endIndex == null) return true
  try {
    const fullText = getDocumentText()
    const actual = fullText.substring(options.startIndex, options.endIndex)
    return actual === options.expectedText
  } catch {
    // If we can't read the doc text, let clipboard try anyway
    return true
  }
}

// ─── TRY 1: clipboard paste ──────────────────────────────────────────────

async function clipboardInsert(options: InsertOptions): Promise<{ verified: boolean }> {
  const { content, mode, paragraphIndex } = options

  // 1. Write content to clipboard
  await navigator.clipboard.writeText(content)

  // 2. Focus the editor
  const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')
  if (!editor) throw new Error('Editor not found')
  editor.focus()

  // 3. Position cursor (insert_after case)
  if (mode === 'insert_after' && paragraphIndex !== undefined) {
    const paras = document.querySelectorAll('.kix-paragraphrenderer')
    const targetPara = paras[paragraphIndex] as HTMLElement | undefined
    if (targetPara) {
      try {
        const range = document.createRange()
        range.selectNodeContents(targetPara)
        range.collapse(false) // move to end
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      } catch {
        // Selection API may refuse inside Kix — proceed with current cursor.
      }
    }
  }

  // 4. Wait for mutations to confirm the paste landed
  const verified = await waitForMutation(editor, MUTATION_TIMEOUT_MS, () => {
    try {
      document.execCommand('paste')
    } catch {
      // paste may fail if clipboard permissions not granted
    }
  })

  return { verified }
}

function waitForMutation(
  target: HTMLElement,
  timeoutMs: number,
  triggerFn: () => void
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const observer = new MutationObserver(() => {
      if (settled) return
      settled = true
      observer.disconnect()
      resolve(true)
    })
    try {
      observer.observe(target, { childList: true, subtree: true, characterData: true })
    } catch {
      resolve(false)
      return
    }

    // Fire the trigger AFTER observer is in place
    try {
      triggerFn()
    } catch {
      // swallow
    }

    setTimeout(() => {
      if (settled) return
      settled = true
      observer.disconnect()
      resolve(false)
    }, timeoutMs)
  })
}

// ─── TRY 2: Apps Script bridge ───────────────────────────────────────────

async function appsScriptInsert(options: InsertOptions): Promise<{ success: boolean }> {
  const { content, mode, paragraphIndex, startIndex, endIndex } = options

  const action = {
    type: mode === 'insert_after' ? 'INSERT_AFTER_PARAGRAPH' : 'REPLACE_TEXT_RANGE',
    content,
    paragraphIndex,
    startIndex,
    endIndex,
    timestamp: Date.now(),
  }

  const queued = await sendToBackground<{ actionId?: string; queued?: boolean }>({
    type: 'QUEUE_ADDON_ACTION',
    payload: { action } as unknown as Record<string, unknown>,
  })
  if (!queued.success || !queued.data?.queued || !queued.data.actionId) {
    throw new Error(queued.error || 'Failed to queue addon action')
  }
  const actionId = queued.data.actionId

  // Poll for completion
  const start = Date.now()
  while (Date.now() - start < APPS_SCRIPT_MAX_WAIT_MS) {
    const status = await sendToBackground<{
      completed?: boolean
      failed?: boolean
      success?: boolean
      error?: string
    }>({
      type: 'CHECK_ADDON_ACTION_STATUS',
      payload: { actionId } as unknown as Record<string, unknown>,
    })

    if (status.success && status.data?.completed) {
      return { success: status.data.success !== false }
    }
    if (status.success && status.data?.failed) {
      throw new Error(status.data.error || 'Apps Script action failed')
    }

    await new Promise((r) => setTimeout(r, APPS_SCRIPT_POLL_MS))
  }

  throw new Error('Apps Script action timed out')
}

// ─── TRY 3: manual toast ─────────────────────────────────────────────────

function showInsertionFailureToast(content: string): void {
  try {
    useOverlayStore.getState().showInsertionToast(content)
  } catch {
    // store not available — noop
  }
}

// ─── Settle animation ────────────────────────────────────────────────────

function triggerSettleAnimation(paragraphIndex: number | undefined): void {
  if (paragraphIndex === undefined) return
  try {
    useOverlayStore.getState().addSettleAnchor(paragraphIndex)
  } catch {
    // ignore
  }
}
